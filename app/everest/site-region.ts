export interface SiteRegionBoundaryOptions {
  centerX: number;
  centerZ: number;
  centerSurfaceY: number;
  radiusWorld: number;
  segments: number;
  sampleSurfaceY(worldX: number, worldZ: number): number;
}

export function siteRegionBoundaryPositions({
  centerX,
  centerZ,
  centerSurfaceY,
  radiusWorld,
  segments,
  sampleSurfaceY,
}: SiteRegionBoundaryOptions) {
  const segmentCount = Math.max(24, Math.floor(segments));
  const positions = new Float32Array(segmentCount * 3);

  for (let index = 0; index < segmentCount; index += 1) {
    const angle = (index / segmentCount) * Math.PI * 2;
    const offsetX = Math.cos(angle) * radiusWorld;
    const offsetZ = Math.sin(angle) * radiusWorld;
    positions[index * 3] = offsetX;
    positions[index * 3 + 1] =
      sampleSurfaceY(centerX + offsetX, centerZ + offsetZ) -
      centerSurfaceY;
    positions[index * 3 + 2] = offsetZ;
  }

  return positions;
}
