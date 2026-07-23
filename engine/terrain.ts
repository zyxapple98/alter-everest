import type { RouteSample, SurfaceKind } from "./types";

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
): TerrainRouteVerdict {
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
    if (
      Math.abs(sample.y - expected.y) > 0.8 ||
      Math.abs(sample.altitudeM - expected.altitudeM) > 0.8 ||
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
