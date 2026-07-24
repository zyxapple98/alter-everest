import { PHYSICS, TERRAIN } from "./constants";
import { currentTopVoxel } from "./surface";
import type { TerrainOracle } from "./terrain";
import type { StoneState, VoxelCoordinate } from "./types";

interface HighestPointDem {
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

interface HighestPointRegistration {
  originLatitude: number;
  originLongitude: number;
  verticalDatumM: number;
}

function stoneTopY(stone: StoneState) {
  const { x, y, z, w } = stone.pose.rotation;
  const half = PHYSICS.stoneEdgeM / 2;
  const matrixY = [
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
  ];
  return (
    stone.pose.translation.y +
    half * (Math.abs(matrixY[0]) + Math.abs(matrixY[1]) + Math.abs(matrixY[2]))
  );
}

export function currentHighestPoint(
  metadata: HighestPointDem,
  elevations: Int16Array,
  registration: HighestPointRegistration,
  oracle: TerrainOracle,
  removed: readonly VoxelCoordinate[],
  stones: readonly StoneState[],
) {
  let measuredMaximum = Number.NEGATIVE_INFINITY;
  for (const elevation of elevations) {
    measuredMaximum = Math.max(measuredMaximum, elevation);
  }
  const degrees = metadata.sampleSpacingArcSeconds / 3600;
  const metersPerDegreeLatitude = 111_320;
  const metersPerDegreeLongitude =
    metersPerDegreeLatitude *
    Math.cos((registration.originLatitude * Math.PI) / 180);
  const candidateThreshold =
    measuredMaximum - TERRAIN.maximumSyntheticReliefM - 1;
  let highest = {
    kind: "TERRAIN" as "TERRAIN" | "STONE",
    id: "terrain",
    x: 0,
    y: Number.NEGATIVE_INFINITY,
    z: 0,
    altitudeM: Number.NEGATIVE_INFINITY,
    latitude: 0,
    longitude: 0,
  };

  for (let row = 0; row < metadata.height; row += 1) {
    for (let column = 0; column < metadata.width; column += 1) {
      if (
        elevations[row * metadata.width + column] < candidateThreshold
      ) {
        continue;
      }
      const west = metadata.bounds.west + column * degrees;
      const east = west + degrees;
      const north = metadata.bounds.north - row * degrees;
      const south = north - degrees;
      const minX =
        (west - registration.originLongitude) * metersPerDegreeLongitude;
      const maxX =
        (east - registration.originLongitude) * metersPerDegreeLongitude;
      const minZ =
        (registration.originLatitude - north) * metersPerDegreeLatitude;
      const maxZ =
        (registration.originLatitude - south) * metersPerDegreeLatitude;
      const minColumnX = Math.floor(minX / TERRAIN.voxelEdgeM);
      const maxColumnX = Math.floor(maxX / TERRAIN.voxelEdgeM);
      const minColumnZ = Math.floor(minZ / TERRAIN.voxelEdgeM);
      const maxColumnZ = Math.floor(maxZ / TERRAIN.voxelEdgeM);

      for (
        let columnX = minColumnX;
        columnX <= maxColumnX;
        columnX += 1
      ) {
        for (
          let columnZ = minColumnZ;
          columnZ <= maxColumnZ;
          columnZ += 1
        ) {
          const top = currentTopVoxel(
            oracle,
            removed,
            columnX,
            columnZ,
          );
          if (top === null) continue;
          const x = (columnX + 0.5) * TERRAIN.voxelEdgeM;
          const z = (columnZ + 0.5) * TERRAIN.voxelEdgeM;
          const y = (top + 1) * TERRAIN.voxelEdgeM;
          if (y <= highest.y) continue;
          highest = {
            kind: "TERRAIN",
            id: "terrain",
            x,
            y,
            z,
            altitudeM: registration.verticalDatumM + y,
            latitude:
              registration.originLatitude - z / metersPerDegreeLatitude,
            longitude:
              registration.originLongitude + x / metersPerDegreeLongitude,
          };
        }
      }
    }
  }

  for (const stone of stones) {
    const y = stoneTopY(stone);
    if (y <= highest.y) continue;
    const { x, z } = stone.pose.translation;
    highest = {
      kind: "STONE",
      id: stone.id,
      x,
      y,
      z,
      altitudeM: registration.verticalDatumM + y,
      latitude:
        registration.originLatitude - z / metersPerDegreeLatitude,
      longitude:
        registration.originLongitude + x / metersPerDegreeLongitude,
    };
  }
  return highest;
}
