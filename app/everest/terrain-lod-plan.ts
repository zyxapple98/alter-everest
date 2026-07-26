export interface TerrainClipmapLevel {
  cellM: number;
  gridCells: number;
  label: string;
  selectable: boolean;
}

/**
 * The observatory is a mountain-scale experience, not a globe viewer.
 * Keeping the legal orbit inside 18 km still frames both Everest approaches,
 * while avoiding a camera/depth range that the terrain product does not need.
 */
export const MAX_TERRAIN_OVERVIEW_DISTANCE_M = 18_000;

/**
 * The public far DEM is about 100 km across. Its 300 m clipmap fills that
 * authority and extends beyond this visibility budget in every direction, so
 * the camera's far plane and atmospheric fade—not a mesh edge—end the view.
 */
export const TERRAIN_CAMERA_FAR_DISTANCE_M = 48_000;
export const TERRAIN_FAR_PLANE_TRANSMITTANCE = 0.0005;

/**
 * Three.js FogExp2 uses exp(-(density * distance)^2). Calibrating density from
 * the camera visibility budget guarantees terrain has faded into the matching
 * horizon colour before the far plane clips it.
 */
export function terrainFogDensity(worldUnitsPerMeter: number) {
  if (!Number.isFinite(worldUnitsPerMeter) || worldUnitsPerMeter <= 0) {
    throw new Error("Terrain fog requires a finite positive world scale.");
  }
  return (
    Math.sqrt(-Math.log(TERRAIN_FAR_PLANE_TRANSMITTANCE)) /
    (TERRAIN_CAMERA_FAR_DISTANCE_M * worldUnitsPerMeter)
  );
}

export function terrainFogTransmittance(
  distanceM: number,
  worldUnitsPerMeter: number,
) {
  const scaledDistance =
    terrainFogDensity(worldUnitsPerMeter) *
    Math.max(0, distanceM) *
    worldUnitsPerMeter;
  return Math.exp(-(scaledDistance * scaledDistance));
}

/**
 * One coarse-to-fine hierarchy owns every rendered terrain surface.
 *
 * The fine levels use the canonical 30 m authority plus deterministic
 * sub-grid relief. The regional cap stays at the far DEM's native 300 m
 * display resolution. Larger voxel sizes create kilometre-high quantization
 * walls on the horizon, so distance beyond this cap is handled by atmosphere
 * and the camera visibility budget rather than more voxel LODs.
 */
export const TERRAIN_CLIPMAP_LEVELS = [
  {
    cellM: 300,
    gridCells: 337,
    label: "300 M",
    selectable: false,
  },
  {
    cellM: 180,
    gridCells: 257,
    label: "180 M",
    selectable: false,
  },
  {
    cellM: 90,
    gridCells: 257,
    label: "90 M",
    selectable: true,
  },
  {
    cellM: 30,
    gridCells: 257,
    label: "30 M",
    selectable: true,
  },
  {
    cellM: 15,
    gridCells: 257,
    label: "15 M",
    selectable: true,
  },
  {
    cellM: 6.4,
    gridCells: 161,
    label: "6.4 M",
    selectable: true,
  },
  {
    cellM: 3.2,
    gridCells: 129,
    label: "3.2 M",
    selectable: true,
  },
  {
    cellM: 1.6,
    gridCells: 129,
    label: "1.6 M",
    selectable: true,
  },
  {
    cellM: 0.8,
    gridCells: 129,
    label: "80 CM",
    selectable: true,
  },
  {
    cellM: 0.4,
    gridCells: 129,
    label: "40 CM",
    selectable: true,
  },
  {
    cellM: 0.2,
    gridCells: 129,
    label: "20 CM",
    selectable: true,
  },
] as const satisfies readonly TerrainClipmapLevel[];

export interface TerrainClipmapRingPlan {
  levelIndex: number;
  cellM: number;
  gridCells: number;
  windowM: number;
  innerHoleM: number;
  innerCellM: number;
  sealOuterBoundary: boolean;
}

/**
 * Produces a single-owner stack from the selected center resolution to the
 * regional 300 m cap. Each coarse level cuts out the exact window owned by
 * the next finer level; no transition relies on depth order or overlapping
 * alpha surfaces. The cap fills the far DEM and ends beyond the camera's
 * visibility budget.
 */
export function planTerrainClipmap(
  levels: readonly TerrainClipmapLevel[],
  activeIndex: number,
): TerrainClipmapRingPlan[] {
  if (activeIndex < 0 || activeIndex >= levels.length) return [];
  const rings: TerrainClipmapRingPlan[] = [];
  for (let index = activeIndex; index >= 0; index -= 1) {
    const level = levels[index];
    const finerLevel = index === activeIndex ? null : levels[index + 1];
    rings.push({
      levelIndex: index,
      cellM: level.cellM,
      gridCells: level.gridCells,
      windowM: level.cellM * level.gridCells,
      innerHoleM: finerLevel
        ? finerLevel.cellM * finerLevel.gridCells
        : 0,
      innerCellM: finerLevel?.cellM ?? 0,
      sealOuterBoundary: index === 0,
    });
  }
  return rings;
}

export function terrainClipmapLevelIndex(label: string) {
  return TERRAIN_CLIPMAP_LEVELS.findIndex(
    (level) => level.label === label,
  );
}

export function terrainClipmapCellM(label: string) {
  return TERRAIN_CLIPMAP_LEVELS.find(
    (level) => level.label === label,
  )?.cellM;
}

export function snapCanonicalClipmapCoordinate(
  coordinateM: number,
  cellM: number,
) {
  if (!Number.isFinite(coordinateM) || cellM <= 0) {
    throw new Error("Clipmap grid snapping requires finite positive values.");
  }
  return (Math.floor(coordinateM / cellM) + 0.5) * cellM;
}
