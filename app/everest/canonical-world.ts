export interface CanonicalWorldRegistration {
  metadata: {
    sampleSpacingArcSeconds: number;
    bounds: {
      north: number;
      west: number;
    };
  };
  terrain: {
    blockSize: number;
    xOrigin: number;
    zOrigin: number;
  };
  canonicalOriginLatitude: number;
  canonicalOriginLongitude: number;
  metersPerDegreeLatitude: number;
  worldUnitsPerMeter: number;
}

export interface CanonicalWorldScale {
  x: number;
  y: number;
  z: number;
}

export interface TerrainGridWorldBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface CanonicalWindowCell {
  x: number;
  z: number;
}

function metersPerDegreeLongitude(
  registration: CanonicalWorldRegistration,
) {
  return (
    registration.metersPerDegreeLatitude *
    Math.cos(
      (registration.canonicalOriginLatitude * Math.PI) / 180,
    )
  );
}

/**
 * The mountain DEM is stored on a latitude/longitude grid. A canonical metre
 * therefore has a different scene-space size on X and Z. Keeping this
 * transform in one place prevents a streamed patch from moving when its local
 * anchor changes.
 */
export function canonicalWorldScale(
  registration: CanonicalWorldRegistration,
): CanonicalWorldScale {
  const degreesPerSample =
    registration.metadata.sampleSpacingArcSeconds / 3600;
  return {
    x:
      registration.terrain.blockSize /
      (degreesPerSample * metersPerDegreeLongitude(registration)),
    y: registration.worldUnitsPerMeter,
    z:
      registration.terrain.blockSize /
      (degreesPerSample * registration.metersPerDegreeLatitude),
  };
}

export function worldToCanonical(
  registration: CanonicalWorldRegistration,
  worldX: number,
  worldZ: number,
) {
  const degreesPerSample =
    registration.metadata.sampleSpacingArcSeconds / 3600;
  const longitude =
    registration.metadata.bounds.west +
    ((worldX - registration.terrain.xOrigin) /
      registration.terrain.blockSize) *
      degreesPerSample;
  const latitude =
    registration.metadata.bounds.north -
    ((worldZ - registration.terrain.zOrigin) /
      registration.terrain.blockSize) *
      degreesPerSample;
  return {
    x:
      (longitude - registration.canonicalOriginLongitude) *
      metersPerDegreeLongitude(registration),
    z:
      (registration.canonicalOriginLatitude - latitude) *
      registration.metersPerDegreeLatitude,
  };
}

export function canonicalToWorld(
  registration: CanonicalWorldRegistration,
  canonicalX: number,
  canonicalZ: number,
) {
  const degreesPerSample =
    registration.metadata.sampleSpacingArcSeconds / 3600;
  const longitude =
    registration.canonicalOriginLongitude +
    canonicalX / metersPerDegreeLongitude(registration);
  const latitude =
    registration.canonicalOriginLatitude -
    canonicalZ / registration.metersPerDegreeLatitude;
  return {
    x:
      registration.terrain.xOrigin +
      ((longitude - registration.metadata.bounds.west) /
        degreesPerSample) *
        registration.terrain.blockSize,
    z:
      registration.terrain.zOrigin +
      ((registration.metadata.bounds.north - latitude) /
        degreesPerSample) *
        registration.terrain.blockSize,
  };
}

export function canonicalDistanceM(
  scale: CanonicalWorldScale,
  worldDeltaX: number,
  worldDeltaZ: number,
) {
  return Math.hypot(worldDeltaX / scale.x, worldDeltaZ / scale.z);
}

/**
 * Quantises a scene-space point on a canonical metre grid. Streaming keys
 * must use this conversion instead of dividing scene units by metre values.
 */
export function canonicalWindowCell(
  registration: CanonicalWorldRegistration,
  worldX: number,
  worldZ: number,
  cellM: number,
): CanonicalWindowCell {
  if (!Number.isFinite(cellM) || cellM <= 0) {
    throw new Error("Canonical window cells require a positive size.");
  }
  const canonical = worldToCanonical(registration, worldX, worldZ);
  return {
    x: Math.floor(canonical.x / cellM),
    z: Math.floor(canonical.z / cellM),
  };
}

/**
 * Returns the navigable scene-space rectangle for an elevation grid.
 *
 * Keeping this derived from the authority grid, rather than from an initial
 * landmark/activity crop, lets a moving observer follow any legal route while
 * retaining a small streamed detail working set.
 */
export function terrainGridWorldBounds(
  registration: CanonicalWorldRegistration,
  width: number,
  height: number,
  insetCells = 1,
): TerrainGridWorldBounds {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isInteger(insetCells) ||
    insetCells < 0 ||
    insetCells * 2 > Math.min(width, height)
  ) {
    throw new Error("Terrain grid bounds require valid dimensions and inset.");
  }
  const { blockSize, xOrigin, zOrigin } = registration.terrain;
  return {
    minX: xOrigin + insetCells * blockSize,
    maxX: xOrigin + (width - insetCells) * blockSize,
    minZ: zOrigin + insetCells * blockSize,
    maxZ: zOrigin + (height - insetCells) * blockSize,
  };
}
