export interface TerrainClipmapLevel {
  cellM: number;
  gridCells: number;
  label: string;
  selectable: boolean;
}

export const MAX_TERRAIN_OVERVIEW_DISTANCE_M = 24_000;
export const TERRAIN_CAMERA_FAR_DISTANCE_M = 175_000;

/**
 * One coarse-to-fine hierarchy owns every rendered terrain surface.
 *
 * The fine levels use the canonical 30 m authority plus deterministic
 * sub-grid relief. The macro levels select progressively coarser DEM sources
 * in the mesher, but they follow the same focus, grid, ownership, and
 * lifecycle rules as the local levels.
 */
export const TERRAIN_CLIPMAP_LEVELS = [
  {
    cellM: 2_400,
    gridCells: 177,
    label: "2.4 KM",
    selectable: false,
  },
  {
    cellM: 1_200,
    gridCells: 193,
    label: "1.2 KM",
    selectable: false,
  },
  {
    cellM: 600,
    gridCells: 193,
    label: "600 M",
    selectable: false,
  },
  {
    cellM: 300,
    gridCells: 257,
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
 * regional 2.4 km proxy cap. Each coarse level cuts out the exact window
 * owned by the next finer level; no transition relies on depth order or
 * overlapping alpha surfaces. The proxy cap extends far enough that its true
 * boundary is beyond the atmospheric visibility budget.
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
