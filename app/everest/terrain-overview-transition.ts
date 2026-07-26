import type { TerrainHoleRectangle } from "./terrain-clipmap-topology";

export interface GeographicTerrainBounds {
  north: number;
  south: number;
  west: number;
  east: number;
}

export interface GeographicTerrainAnchor {
  latitude: number;
  longitude: number;
}

/**
 * Computes one activity footprint on a shared geographic grid. Every visual
 * resolution must resample inside this same rectangle; independently rounding
 * 30 m and 90 m footprints creates a thin strip where both layers own the
 * surface and fight in the depth buffer.
 */
export function alignedActivityTerrainBounds(
  coreBounds: GeographicTerrainBounds,
  anchors: readonly GeographicTerrainAnchor[],
  paddingDegrees: number,
  alignmentArcSeconds: number,
): GeographicTerrainBounds {
  if (alignmentArcSeconds <= 0) {
    throw new Error("Terrain boundary alignment must be positive.");
  }
  const samplesPerDegree = 3600 / alignmentArcSeconds;
  return {
    north:
      Math.ceil(
        Math.max(
          coreBounds.north,
          ...anchors.map(
            (anchor) => anchor.latitude + paddingDegrees,
          ),
        ) * samplesPerDegree,
      ) / samplesPerDegree,
    south:
      Math.floor(
        Math.min(
          coreBounds.south,
          ...anchors.map(
            (anchor) => anchor.latitude - paddingDegrees,
          ),
        ) * samplesPerDegree,
      ) / samplesPerDegree,
    west:
      Math.floor(
        Math.min(
          coreBounds.west,
          ...anchors.map(
            (anchor) => anchor.longitude - paddingDegrees,
          ),
        ) * samplesPerDegree,
      ) / samplesPerDegree,
    east:
      Math.ceil(
        Math.max(
          coreBounds.east,
          ...anchors.map(
            (anchor) => anchor.longitude + paddingDegrees,
          ),
        ) * samplesPerDegree,
      ) / samplesPerDegree,
  };
}

/**
 * Converts the exact geographic activity rectangle into the same world-space
 * edge coordinates used by the overview and activity voxel meshes.
 */
export function geographicBoundsToTerrainHole(
  bounds: GeographicTerrainBounds,
  originLatitude: number,
  originLongitude: number,
  worldUnitsPerArcSecond: number,
): TerrainHoleRectangle {
  return {
    minimumX:
      (bounds.west - originLongitude) *
      3600 *
      worldUnitsPerArcSecond,
    maximumX:
      (bounds.east - originLongitude) *
      3600 *
      worldUnitsPerArcSecond,
    minimumZ:
      (originLatitude - bounds.north) *
      3600 *
      worldUnitsPerArcSecond,
    maximumZ:
      (originLatitude - bounds.south) *
      3600 *
      worldUnitsPerArcSecond,
  };
}

/**
 * One at the inner layer's outermost cell and zero beyond the morph band.
 * Morphing only the inner owner preserves exact horizontal ownership while
 * making its boundary height identical to the outer overview surface.
 */
export function terrainOverviewMorphWeight(
  row: number,
  column: number,
  width: number,
  height: number,
  edgeCells: number,
) {
  if (edgeCells <= 0) return 0;
  const edgeDistance = Math.min(
    row,
    column,
    height - 1 - row,
    width - 1 - column,
  );
  if (edgeDistance >= edgeCells) return 0;
  const linear = (edgeCells - edgeDistance) / edgeCells;
  return linear * linear * (3 - 2 * linear);
}

/**
 * Projects a morph-band sample just outside its nearest activity edge. This
 * samples the outer cell that is actually visible after clipping, rather than
 * a hidden outer cell underneath the activity rectangle.
 */
export function terrainOverviewTargetPoint(
  row: number,
  column: number,
  width: number,
  height: number,
  centerX: number,
  centerZ: number,
  activityBounds: TerrainHoleRectangle,
  epsilon: number,
) {
  const northDistance = row;
  const southDistance = height - 1 - row;
  const westDistance = column;
  const eastDistance = width - 1 - column;
  const nearestEdge = Math.min(
    northDistance,
    southDistance,
    westDistance,
    eastDistance,
  );
  if (nearestEdge === northDistance) {
    return {
      x: centerX,
      z: activityBounds.minimumZ - epsilon,
    };
  }
  if (nearestEdge === southDistance) {
    return {
      x: centerX,
      z: activityBounds.maximumZ + epsilon,
    };
  }
  if (nearestEdge === westDistance) {
    return {
      x: activityBounds.minimumX - epsilon,
      z: centerZ,
    };
  }
  return {
    x: activityBounds.maximumX + epsilon,
    z: centerZ,
  };
}
