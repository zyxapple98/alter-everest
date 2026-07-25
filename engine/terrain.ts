import { TERRAIN } from "./constants";
import { voxelKey } from "./mutation";
import {
  baseTopVoxel,
  currentTopVoxel,
  isSolidTerrainVoxel,
} from "./surface";
import type {
  PhysicsSnapshot,
  RouteSample,
  SurfaceKind,
  VoxelCoordinate,
} from "./types";

const METERS_PER_DEGREE_LATITUDE = 111_320;

export interface DemMetadataLike {
  width: number;
  height: number;
  sampleSpacingArcSeconds: number;
  bounds: {
    north: number;
    south: number;
    west: number;
    east: number;
  };
}

export interface DemWorldRegistration {
  originLatitude: number;
  originLongitude: number;
  verticalDatumM: number;
}

export interface TerrainTruth {
  y: number;
  altitudeM: number;
  slopeDegrees: number;
  surface: SurfaceKind;
}

export interface TerrainOracle {
  sample(x: number, z: number): TerrainTruth | null;
}

export interface TerrainRouteVerdict {
  valid: boolean;
  code: "TERRAIN_BOUND" | "OUTSIDE_TERRAIN" | "TERRAIN_MISMATCH";
  sampleIndex: number | null;
  expected: TerrainTruth | null;
}

function surfaceAt(altitudeM: number, slopeDegrees: number): SurfaceKind {
  if (altitudeM >= 7_000 || (altitudeM >= 6_250 && slopeDegrees < 34)) {
    return "ICE";
  }
  if (altitudeM >= 5_700) return "SNOW";
  return "ROCK";
}

function bilinear(
  elevations: Int16Array,
  width: number,
  height: number,
  column: number,
  row: number,
) {
  if (
    column < 0 ||
    row < 0 ||
    column > width - 1 ||
    row > height - 1
  ) {
    return null;
  }
  const column0 = Math.floor(column);
  const row0 = Math.floor(row);
  const column1 = Math.min(width - 1, column0 + 1);
  const row1 = Math.min(height - 1, row0 + 1);
  const tx = column - column0;
  const tz = row - row0;
  const northWest = elevations[row0 * width + column0];
  const northEast = elevations[row0 * width + column1];
  const southWest = elevations[row1 * width + column0];
  const southEast = elevations[row1 * width + column1];
  const north = northWest + (northEast - northWest) * tx;
  const south = southWest + (southEast - southWest) * tx;
  return north + (south - north) * tz;
}

export function createDemTerrainOracle(
  metadata: DemMetadataLike,
  elevations: Int16Array,
  registration: DemWorldRegistration,
): TerrainOracle {
  if (elevations.length !== metadata.width * metadata.height) {
    throw new Error("DEM dimensions do not match the supplied elevation data.");
  }
  const degreesPerSample = metadata.sampleSpacingArcSeconds / 3600;
  const latitudeRadians =
    (registration.originLatitude * Math.PI) / 180;
  const metersPerDegreeLongitude =
    METERS_PER_DEGREE_LATITUDE * Math.cos(latitudeRadians);
  const sampleWidthM = degreesPerSample * metersPerDegreeLongitude;
  const sampleHeightM = degreesPerSample * METERS_PER_DEGREE_LATITUDE;

  const gridPosition = (x: number, z: number) => {
    const latitude =
      registration.originLatitude - z / METERS_PER_DEGREE_LATITUDE;
    const longitude =
      registration.originLongitude + x / metersPerDegreeLongitude;
    return {
      column:
        (longitude - metadata.bounds.west) / degreesPerSample - 0.5,
      row:
        (metadata.bounds.north - latitude) / degreesPerSample - 0.5,
    };
  };

  return {
    sample(x, z) {
      const { column, row } = gridPosition(x, z);
      const altitudeM = bilinear(
        elevations,
        metadata.width,
        metadata.height,
        column,
        row,
      );
      if (altitudeM === null) return null;

      const west = bilinear(
        elevations,
        metadata.width,
        metadata.height,
        column - 1,
        row,
      );
      const east = bilinear(
        elevations,
        metadata.width,
        metadata.height,
        column + 1,
        row,
      );
      const north = bilinear(
        elevations,
        metadata.width,
        metadata.height,
        column,
        row - 1,
      );
      const south = bilinear(
        elevations,
        metadata.width,
        metadata.height,
        column,
        row + 1,
      );
      if (west === null || east === null || north === null || south === null) {
        return null;
      }
      const eastGradient = (east - west) / (sampleWidthM * 2);
      const southGradient = (south - north) / (sampleHeightM * 2);
      const slopeDegrees =
        (Math.atan(Math.hypot(eastGradient, southGradient)) * 180) /
        Math.PI;
      return {
        y: altitudeM - registration.verticalDatumM,
        altitudeM,
        slopeDegrees,
        surface: surfaceAt(altitudeM, slopeDegrees),
      };
    },
  };
}

export function validateRouteTerrain(
  route: readonly RouteSample[],
  oracle: TerrainOracle,
  world?: Pick<PhysicsSnapshot, "stones" | "removedTerrainVoxels">,
): TerrainRouteVerdict {
  const removed = new Set((world?.removedTerrainVoxels ?? []).map(voxelKey));
  const stones = new Set((world?.stones ?? []).map((stone) => voxelKey(stone.cell)));
  for (let index = 0; index < route.length; index += 1) {
    const sample = route[index];
    const expected = oracle.sample(sample.x, sample.z);
    if (!expected) {
      return {
        valid: false,
        code: "OUTSIDE_TERRAIN",
        sampleIndex: index,
        expected: null,
      };
    }
    const columnX = Math.floor(sample.x / TERRAIN.voxelEdgeM);
    const columnZ = Math.floor(sample.z / TERRAIN.voxelEdgeM);
    const top = currentTopVoxel(
      oracle,
      world?.removedTerrainVoxels ?? [],
      columnX,
      columnZ,
    );
    const topY = top === null ? Number.NEGATIVE_INFINITY : (top + 1) * TERRAIN.voxelEdgeM;
    const supportY = Math.floor(
      (sample.y + TERRAIN.voxelEdgeM * 0.25) / TERRAIN.voxelEdgeM,
    ) - 1;
    const supportCell: VoxelCoordinate = {
      x: columnX,
      y: supportY,
      z: columnZ,
    };
    const exactVoxelSupport =
      Math.abs(sample.y - (supportY + 1) * TERRAIN.voxelEdgeM) <=
        TERRAIN.voxelEdgeM * 0.55 &&
      (stones.has(voxelKey(supportCell)) ||
        isSolidTerrainVoxel(oracle, removed, supportCell));
    const naturalSurfaceSupport =
      top !== null &&
      Math.abs(sample.y - expected.y) <= 0.8 &&
      Math.abs(sample.y - topY) <= 0.8;
    const nativeTop = baseTopVoxel(oracle, columnX, columnZ);
    const insideExcavation =
      nativeTop !== null &&
      exactVoxelSupport &&
      supportY < nativeTop &&
      removed.has(
        voxelKey({ x: columnX, y: supportY + 1, z: columnZ }),
      ) &&
      sample.y <= (nativeTop + 1) * TERRAIN.voxelEdgeM - 0.1;
    let bodyClear = true;
    if (insideExcavation) {
      const bodyBottom = supportY + 1;
      const bodyHeightCells = Math.ceil(1.72 / TERRAIN.voxelEdgeM);
      const bodyColumns = [
        { x: columnX, z: columnZ },
        { x: columnX + 1, z: columnZ },
        { x: columnX - 1, z: columnZ },
        { x: columnX, z: columnZ + 1 },
        { x: columnX, z: columnZ - 1 },
      ];
      bodyClear = bodyColumns.every((column) =>
        Array.from({ length: bodyHeightCells }, (_, offset) => ({
          x: column.x,
          y: bodyBottom + offset,
          z: column.z,
        })).every(
          (cell) =>
            !stones.has(voxelKey(cell)) &&
            !isSolidTerrainVoxel(oracle, removed, cell),
        ),
      );
    }
    const expectedAltitude =
      expected.altitudeM + (sample.y - expected.y);
    if (
      (!exactVoxelSupport && !naturalSurfaceSupport) ||
      !bodyClear ||
      Math.abs(sample.altitudeM - expectedAltitude) > 0.8 ||
      Math.abs(sample.slopeDegrees - expected.slopeDegrees) > 2.5 ||
      sample.surface !== expected.surface
    ) {
      return {
        valid: false,
        code: "TERRAIN_MISMATCH",
        sampleIndex: index,
        expected,
      };
    }
  }
  return {
    valid: true,
    code: "TERRAIN_BOUND",
    sampleIndex: null,
    expected: null,
  };
}
