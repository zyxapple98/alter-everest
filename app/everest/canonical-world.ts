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
