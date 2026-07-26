import { syntheticReliefM } from "../../engine/surface";
import type { ObservatorySurfaceDeltaChunk } from "../../lib/world";
import {
  MOUNTAIN_MATERIALS,
  TERRAIN_COLOR_SCRATCH,
  terrainColor,
} from "./terrain-palette";
import {
  canonicalWorldScale,
  worldToCanonical,
} from "./canonical-world";
import {
  fillTerrainRectangleEdgeIntervals,
  subdivideTerrainSeam,
  terrainCellRectangularRingGeometry,
  terrainSeamNormalSign,
  type TerrainCellRingGeometry,
  type TerrainHoleRectangle,
} from "./terrain-clipmap-topology";

export interface TerrainElevationSource {
  minimumCellM: number;
  metadata: {
    sampleSpacingArcSeconds: number;
    width: number;
    height: number;
    bounds: {
      north: number;
      south: number;
      west: number;
      east: number;
    };
  };
  elevations: Int16Array;
}

export interface TerrainMesherContext {
  metadata: {
    sampleSpacingArcSeconds: number;
    width: number;
    height: number;
    bounds: {
      north: number;
      south: number;
      west: number;
      east: number;
    };
  };
  elevations: Int16Array;
  elevationSources?: readonly TerrainElevationSource[];
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

export interface TerrainMeshRequest {
  centerWorldX: number;
  centerWorldZ: number;
  innerCenterWorldX?: number;
  innerCenterWorldZ?: number;
  cellM: number;
  gridCells: number;
  innerHoleM: number;
  innerCellM: number;
  sealOuterBoundary: boolean;
  terrainTint: string;
  horizonColor: string;
  delta: {
    voxelEdgeM: number;
    verticalDatumM: number;
    chunks: ObservatorySurfaceDeltaChunk[];
  };
}

export interface TerrainMeshResult {
  positions: Float32Array;
  /**
   * Normalized unsigned bytes. Terrain color only needs display precision;
   * keeping it as Float32 quadrupled both CPU cache and GPU attribute memory.
   */
  colors: Uint8Array;
  indices: Uint16Array | Uint32Array;
  centerCanonicalX: number;
  centerCanonicalZ: number;
  renderedTopCount: number;
  buildMs: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Circularly dissolves the sealed macro ring before its square data boundary.
 * The camera remains inside the fully visible 82% radius at maximum zoom.
 */
export function outerTerrainHorizonWeight(
  row: number,
  column: number,
  gridCells: number,
) {
  const halfGrid = Math.max(1, Math.floor(gridCells / 2));
  const normalizedRadius =
    Math.hypot(column - halfGrid, row - halfGrid) / halfGrid;
  const linear = clamp((1 - normalizedRadius) / 0.18, 0, 1);
  return linear * linear * (3 - 2 * linear);
}

function sampleDemElevation(
  elevations: Int16Array,
  width: number,
  height: number,
  column: number,
  row: number,
) {
  const safeColumn = clamp(column, 0, width - 1);
  const safeRow = clamp(row, 0, height - 1);
  const column0 = Math.floor(safeColumn);
  const row0 = Math.floor(safeRow);
  const column1 = Math.min(width - 1, column0 + 1);
  const row1 = Math.min(height - 1, row0 + 1);
  const tx = safeColumn - column0;
  const tz = safeRow - row0;
  const north =
    elevations[row0 * width + column0] * (1 - tx) +
    elevations[row0 * width + column1] * tx;
  const south =
    elevations[row1 * width + column0] * (1 - tx) +
    elevations[row1 * width + column1] * tx;
  return north * (1 - tz) + south * tz;
}

function sourceContainsCoordinate(
  metadata: TerrainElevationSource["metadata"],
  latitude: number,
  longitude: number,
) {
  const { bounds } = metadata;
  return (
    latitude <= bounds.north &&
    latitude >= bounds.south &&
    longitude >= bounds.west &&
    longitude <= bounds.east
  );
}

function sampleSourceAtCoordinate(
  metadata: TerrainElevationSource["metadata"],
  elevations: Int16Array,
  latitude: number,
  longitude: number,
) {
  const degreesPerSample = metadata.sampleSpacingArcSeconds / 3600;
  const column =
    (longitude - metadata.bounds.west) / degreesPerSample - 0.5;
  const row =
    (metadata.bounds.north - latitude) / degreesPerSample - 0.5;
  return sampleDemElevation(
    elevations,
    metadata.width,
    metadata.height,
    column,
    row,
  );
}

function sourceEdgeDistanceM(
  metadata: TerrainElevationSource["metadata"],
  latitude: number,
  longitude: number,
  metersPerDegreeLatitude: number,
  metersPerDegreeLongitude: number,
) {
  const { bounds } = metadata;
  return Math.max(
    0,
    Math.min(
      (bounds.north - latitude) * metersPerDegreeLatitude,
      (latitude - bounds.south) * metersPerDegreeLatitude,
      (longitude - bounds.west) * metersPerDegreeLongitude,
      (bounds.east - longitude) * metersPerDegreeLongitude,
    ),
  );
}

/**
 * Samples the DEM pyramid in canonical metres. Cell size chooses the intended
 * source resolution; if that source does not cover an outer-ring coordinate,
 * progressively coarser sources provide geographic coverage instead of
 * clamping a narrow DEM into a repeated wall.
 */
export function sampleTerrainElevation(
  context: TerrainMesherContext,
  canonicalX: number,
  canonicalZ: number,
  cellM: number,
) {
  const latitude =
    context.canonicalOriginLatitude -
    canonicalZ / context.metersPerDegreeLatitude;
  const longitude =
    context.canonicalOriginLongitude +
    canonicalX /
      (context.metersPerDegreeLatitude *
        Math.cos(
          (context.canonicalOriginLatitude * Math.PI) / 180,
        ));
  const metersPerDegreeLongitude =
    context.metersPerDegreeLatitude *
    Math.cos(
      (context.canonicalOriginLatitude * Math.PI) / 180,
    );
  const fallbackSources = context.elevationSources ?? [];
  let preferredIndex = -1;
  let sourceMetadata = context.metadata;
  let sourceElevations = context.elevations;
  for (let index = 0; index < fallbackSources.length; index += 1) {
    if (fallbackSources[index].minimumCellM <= cellM) {
      preferredIndex = index;
      sourceMetadata = fallbackSources[index].metadata;
      sourceElevations = fallbackSources[index].elevations;
    }
  }
  let selectedIndex = preferredIndex;
  if (
    !sourceContainsCoordinate(
      sourceMetadata,
      latitude,
      longitude,
    )
  ) {
    for (
      let index = preferredIndex + 1;
      index < fallbackSources.length;
      index += 1
    ) {
      if (
        sourceContainsCoordinate(
          fallbackSources[index].metadata,
          latitude,
          longitude,
        )
      ) {
        sourceMetadata = fallbackSources[index].metadata;
        sourceElevations = fallbackSources[index].elevations;
        selectedIndex = index;
        break;
      }
    }
  }
  const elevation = sampleSourceAtCoordinate(
    sourceMetadata,
    sourceElevations,
    latitude,
    longitude,
  );
  const coarserIndex = selectedIndex + 1;
  if (
    coarserIndex >= fallbackSources.length ||
    !sourceContainsCoordinate(
      fallbackSources[coarserIndex].metadata,
      latitude,
      longitude,
    )
  ) {
    return elevation;
  }
  const edgeDistanceM = sourceEdgeDistanceM(
    sourceMetadata,
    latitude,
    longitude,
    context.metersPerDegreeLatitude,
    metersPerDegreeLongitude,
  );
  const sourceSampleM =
    (sourceMetadata.sampleSpacingArcSeconds / 3600) *
    context.metersPerDegreeLatitude;
  const blendWidthM = Math.max(cellM * 4, sourceSampleM * 4);
  if (edgeDistanceM >= blendWidthM) return elevation;
  const coarseElevation = sampleSourceAtCoordinate(
    fallbackSources[coarserIndex].metadata,
    fallbackSources[coarserIndex].elevations,
    latitude,
    longitude,
  );
  const linear = Math.max(0, Math.min(1, edgeDistanceM / blendWidthM));
  const fineWeight = linear * linear * (3 - 2 * linear);
  return coarseElevation + (elevation - coarseElevation) * fineWeight;
}

export function buildTerrainMesh(
  context: TerrainMesherContext,
  request: TerrainMeshRequest,
): TerrainMeshResult {
  const startedAt = performance.now();
  const {
    centerWorldX,
    centerWorldZ,
    innerCenterWorldX = centerWorldX,
    innerCenterWorldZ = centerWorldZ,
    cellM,
    gridCells,
    innerHoleM,
    innerCellM,
    sealOuterBoundary,
    delta,
  } = request;
  if (innerHoleM > 0 && innerCellM <= 0) {
    throw new Error(
      "A clipmap ring with an inner hole requires its finer cell size.",
    );
  }
  const centerCanonical = worldToCanonical(
    context,
    centerWorldX,
    centerWorldZ,
  );
  const innerCenterCanonical = worldToCanonical(
    context,
    innerCenterWorldX,
    innerCenterWorldZ,
  );
  const innerCenterOffsetX =
    innerCenterCanonical.x - centerCanonical.x;
  const innerCenterOffsetZ =
    innerCenterCanonical.z - centerCanonical.z;
  const innerHole: TerrainHoleRectangle | null =
    innerHoleM > 0
      ? {
          minimumX: innerCenterOffsetX - innerHoleM / 2,
          maximumX: innerCenterOffsetX + innerHoleM / 2,
          minimumZ: innerCenterOffsetZ - innerHoleM / 2,
          maximumZ: innerCenterOffsetZ + innerHoleM / 2,
        }
      : null;
  const centerLatitude =
    context.canonicalOriginLatitude -
    centerCanonical.z / context.metersPerDegreeLatitude;
  const centerLongitude =
    context.canonicalOriginLongitude +
    centerCanonical.x /
      (context.metersPerDegreeLatitude *
        Math.cos(
          (context.canonicalOriginLatitude * Math.PI) / 180,
        ));
  const metersPerDegreeLongitude =
    context.metersPerDegreeLatitude *
    Math.cos((context.canonicalOriginLatitude * Math.PI) / 180);
  const centerCanonicalX = centerCanonical.x;
  const centerCanonicalZ = centerCanonical.z;
  const centerElevationM = sampleTerrainElevation(
    context,
    centerCanonicalX,
    centerCanonicalZ,
    cellM,
  );
  const centerTopVoxel = Math.floor(
    (centerElevationM +
      syntheticReliefM(centerCanonicalX, centerCanonicalZ)) /
      cellM,
  );
  const halfGrid = Math.floor(gridCells / 2);
  const topLevels = new Int32Array(gridCells * gridCells);
  const reliefValues = new Float32Array(topLevels.length);
  const elevationValues = new Float32Array(topLevels.length);
  const removedByColumn = new Map<string, Set<number>>();
  delta.chunks.forEach((chunk) => {
    chunk.removedTerrainVoxels.forEach((voxel) => {
      const key = `${voxel.x}:${voxel.z}`;
      const levels = removedByColumn.get(key) ?? new Set<number>();
      levels.add(voxel.y);
      removedByColumn.set(key, levels);
    });
  });
  const verticalDatumVoxels = Math.round(
    delta.verticalDatumM / delta.voxelEdgeM,
  );

  for (let row = 0; row < gridCells; row += 1) {
    for (let column = 0; column < gridCells; column += 1) {
      const index = row * gridCells + column;
      const localXM = (column - halfGrid) * cellM;
      const localZM = (row - halfGrid) * cellM;
      const canonicalX = centerCanonicalX + localXM;
      const canonicalZ = centerCanonicalZ + localZM;
      const elevationM = sampleTerrainElevation(
        context,
        canonicalX,
        canonicalZ,
        cellM,
      );
      const reliefM = syntheticReliefM(canonicalX, canonicalZ);
      let absoluteTopVoxel = Math.floor(
        (elevationM + reliefM) / cellM,
      );
      const removedLevels = removedByColumn.get(
        `${Math.floor(canonicalX / delta.voxelEdgeM)}:${Math.floor(
          canonicalZ / delta.voxelEdgeM,
        )}`,
      );
      if (removedLevels) {
        let fineTopVoxel = Math.floor(
          (elevationM + reliefM) / delta.voxelEdgeM,
        );
        let localTopVoxel = fineTopVoxel - verticalDatumVoxels;
        while (removedLevels.has(localTopVoxel)) localTopVoxel -= 1;
        fineTopVoxel = localTopVoxel + verticalDatumVoxels;
        const editedTopM = (fineTopVoxel + 1) * delta.voxelEdgeM;
        absoluteTopVoxel = Math.ceil(editedTopM / cellM) - 1;
      }
      topLevels[index] = absoluteTopVoxel - centerTopVoxel;
      reliefValues[index] = reliefM;
      elevationValues[index] = elevationM;
    }
  }

  const included = new Uint8Array(topLevels.length);
  const ringGeometry = new Array<TerrainCellRingGeometry | null>(
    topLevels.length,
  ).fill(null);
  let renderedTopCount = 0;
  let innerSeamCount = 0;
  for (let row = 0; row < gridCells; row += 1) {
    for (let column = 0; column < gridCells; column += 1) {
      const index = row * gridCells + column;
      const localXM = (column - halfGrid) * cellM;
      const localZM = (row - halfGrid) * cellM;
      const cellGeometry = terrainCellRectangularRingGeometry(
        localXM,
        localZM,
        cellM,
        innerHole,
        innerCellM,
        innerCenterOffsetX,
        innerCenterOffsetZ,
      );
      if (!cellGeometry) {
        included[index] = 1;
        renderedTopCount += 1;
        continue;
      }
      if (cellGeometry.tops.length > 0) {
        ringGeometry[index] = cellGeometry;
        included[index] = 1;
        renderedTopCount += cellGeometry.tops.length;
        cellGeometry.seams.forEach((seam) => {
          innerSeamCount += subdivideTerrainSeam(
            seam.minimum,
            seam.maximum,
            innerCellM,
            seam.axis === "x"
              ? innerCenterOffsetZ
              : innerCenterOffsetX,
          ).length;
        });
      }
    }
  }

  let minimumTopLevel = Number.POSITIVE_INFINITY;
  for (let index = 0; index < topLevels.length; index += 1) {
    if (included[index]) {
      minimumTopLevel = Math.min(minimumTopLevel, topLevels[index]);
    }
  }
  if (!Number.isFinite(minimumTopLevel)) minimumTopLevel = 0;
  if (sealOuterBoundary) {
    const horizonFloorLevel =
      minimumTopLevel - Math.max(6, Math.ceil(3_600 / cellM));
    for (let row = 0; row < gridCells; row += 1) {
      for (let column = 0; column < gridCells; column += 1) {
        const index = row * gridCells + column;
        if (!included[index]) continue;
        const horizonWeight = outerTerrainHorizonWeight(
          row,
          column,
          gridCells,
        );
        topLevels[index] = Math.round(
          horizonFloorLevel +
            (topLevels[index] - horizonFloorLevel) * horizonWeight,
        );
      }
    }
    minimumTopLevel = horizonFloorLevel;
  }
  const skirtDepthLevels = 6;
  const skirtBottomLevel = minimumTopLevel - skirtDepthLevels;

  let faceCount = renderedTopCount + innerSeamCount;
  const edgeIntervalScratch: number[] = [];
  for (let row = 0; row < gridCells; row += 1) {
    for (let column = 0; column < gridCells; column += 1) {
      const index = row * gridCells + column;
      if (!included[index]) continue;
      const level = topLevels[index];
      const localXM = (column - halfGrid) * cellM;
      const localZM = (row - halfGrid) * cellM;
      const minimumX = localXM - cellM / 2;
      const maximumX = localXM + cellM / 2;
      const minimumZ = localZM - cellM / 2;
      const maximumZ = localZM + cellM / 2;
      if (
        (column + 1 < gridCells &&
          included[index + 1] &&
          topLevels[index + 1] < level) ||
        (sealOuterBoundary && column + 1 >= gridCells)
      ) {
        faceCount += fillTerrainRectangleEdgeIntervals(
          minimumZ,
          maximumZ,
          maximumX,
          "z",
          innerHole,
          edgeIntervalScratch,
        );
      }
      if (
        (column > 0 &&
          included[index - 1] &&
          topLevels[index - 1] < level) ||
        (sealOuterBoundary && column === 0)
      ) {
        faceCount += fillTerrainRectangleEdgeIntervals(
          minimumZ,
          maximumZ,
          minimumX,
          "z",
          innerHole,
          edgeIntervalScratch,
        );
      }
      if (
        (row + 1 < gridCells &&
          included[index + gridCells] &&
          topLevels[index + gridCells] < level) ||
        (sealOuterBoundary && row + 1 >= gridCells)
      ) {
        faceCount += fillTerrainRectangleEdgeIntervals(
          minimumX,
          maximumX,
          maximumZ,
          "x",
          innerHole,
          edgeIntervalScratch,
        );
      }
      if (
        (row > 0 &&
          included[index - gridCells] &&
          topLevels[index - gridCells] < level) ||
        (sealOuterBoundary && row === 0)
      ) {
        faceCount += fillTerrainRectangleEdgeIntervals(
          minimumX,
          maximumX,
          minimumZ,
          "x",
          innerHole,
          edgeIntervalScratch,
        );
      }
    }
  }

  const positions = new Float32Array(faceCount * 12);
  const colors = new Uint8Array(faceCount * 12);
  const indices =
    faceCount * 4 > 65_535
      ? new Uint32Array(faceCount * 6)
      : new Uint16Array(faceCount * 6);
  let face = 0;
  const writeFace = (
    coordinates: readonly number[],
    red: number,
    green: number,
    blue: number,
  ) => {
    const positionOffset = face * 12;
    positions.set(coordinates, positionOffset);
    const vertexOffset = face * 4;
    const redByte = Math.round(clamp(red, 0, 1) * 255);
    const greenByte = Math.round(clamp(green, 0, 1) * 255);
    const blueByte = Math.round(clamp(blue, 0, 1) * 255);
    for (let vertex = 0; vertex < 4; vertex += 1) {
      const colorOffset = positionOffset + vertex * 3;
      colors[colorOffset] = redByte;
      colors[colorOffset + 1] = greenByte;
      colors[colorOffset + 2] = blueByte;
    }
    const indexOffset = face * 6;
    indices[indexOffset] = vertexOffset;
    indices[indexOffset + 1] = vertexOffset + 1;
    indices[indexOffset + 2] = vertexOffset + 2;
    indices[indexOffset + 3] = vertexOffset;
    indices[indexOffset + 4] = vertexOffset + 2;
    indices[indexOffset + 5] = vertexOffset + 3;
    face += 1;
  };
  const elevationAt = (
    column: number,
    row: number,
    fallback: number,
  ) =>
    column < 0 ||
    row < 0 ||
    column >= gridCells ||
    row >= gridCells
      ? fallback
      : elevationValues[row * gridCells + column];
  const detailTint = MOUNTAIN_MATERIALS.valleyRock
    .clone()
    .set(request.terrainTint);
  const horizonTint = MOUNTAIN_MATERIALS.valleyRock
    .clone()
    .set(request.horizonColor);
  const worldScale = canonicalWorldScale(context);
  const cellWorldX = cellM * worldScale.x;
  const cellWorldY = cellM * worldScale.y;
  const cellWorldZ = cellM * worldScale.z;
  const slopeSampleOffset = Math.max(1, Math.round(30 / cellM));
  const innerSurfaceTopY = (
    localXM: number,
    localZM: number,
  ) => {
    if (innerCellM <= 0) return 0;
    const canonicalX = centerCanonicalX + localXM;
    const canonicalZ = centerCanonicalZ + localZM;
    const elevationM = sampleTerrainElevation(
      context,
      canonicalX,
      canonicalZ,
      innerCellM,
    );
    const reliefM = syntheticReliefM(canonicalX, canonicalZ);
    let absoluteTopVoxel = Math.floor(
      (elevationM + reliefM) / innerCellM,
    );
    const removedLevels = removedByColumn.get(
      `${Math.floor(canonicalX / delta.voxelEdgeM)}:${Math.floor(
        canonicalZ / delta.voxelEdgeM,
      )}`,
    );
    if (removedLevels) {
      let fineTopVoxel = Math.floor(
        (elevationM + reliefM) / delta.voxelEdgeM,
      );
      let localTopVoxel = fineTopVoxel - verticalDatumVoxels;
      while (removedLevels.has(localTopVoxel)) localTopVoxel -= 1;
      fineTopVoxel = localTopVoxel + verticalDatumVoxels;
      const editedTopM = (fineTopVoxel + 1) * delta.voxelEdgeM;
      absoluteTopVoxel =
        Math.ceil(editedTopM / innerCellM) - 1;
    }
    return (absoluteTopVoxel + 1) * innerCellM * worldScale.y;
  };
  const writeTop = (
    rectangleMinimumX: number,
    rectangleMaximumX: number,
    rectangleMinimumZ: number,
    rectangleMaximumZ: number,
    yTop: number,
    red: number,
    green: number,
    blue: number,
  ) => {
    const rectangleX0 =
      centerWorldX + rectangleMinimumX * worldScale.x;
    const rectangleX1 =
      centerWorldX + rectangleMaximumX * worldScale.x;
    const rectangleZ0 =
      centerWorldZ + rectangleMinimumZ * worldScale.z;
    const rectangleZ1 =
      centerWorldZ + rectangleMaximumZ * worldScale.z;
    writeFace(
      [
        rectangleX0,
        yTop,
        rectangleZ0,
        rectangleX0,
        yTop,
        rectangleZ1,
        rectangleX1,
        yTop,
        rectangleZ1,
        rectangleX1,
        yTop,
        rectangleZ0,
      ],
      red,
      green,
      blue,
    );
  };

  for (let row = 0; row < gridCells; row += 1) {
    for (let column = 0; column < gridCells; column += 1) {
      const index = row * gridCells + column;
      if (!included[index]) continue;
      const localXM = (column - halfGrid) * cellM;
      const localZM = (row - halfGrid) * cellM;
      const worldX =
        centerWorldX + localXM * worldScale.x;
      const worldZ =
        centerWorldZ + localZM * worldScale.z;
      const topLevel = topLevels[index];
      const gradientX =
        (elevationAt(
          column + slopeSampleOffset,
          row,
          elevationValues[index],
        ) -
          elevationAt(
            column - slopeSampleOffset,
            row,
            elevationValues[index],
          )) /
        (2 * slopeSampleOffset * cellM);
      const gradientZ =
        (elevationAt(
          column,
          row + slopeSampleOffset,
          elevationValues[index],
        ) -
          elevationAt(
            column,
            row - slopeSampleOffset,
            elevationValues[index],
          )) /
        (2 * slopeSampleOffset * cellM);
      const slopeDegrees =
        (Math.atan(Math.hypot(gradientX, gradientZ)) * 180) / Math.PI;
      const normalLength = Math.hypot(gradientX, 1, gradientZ);
      const sunDot = clamp(
        (-gradientX * -0.38 + 0.86 + -gradientZ * -0.34) /
          normalLength,
        0,
        1,
      );
      const topShade = 0.76 + sunDot * 0.24;
      const sampleLongitude =
        centerLongitude + localXM / metersPerDegreeLongitude;
      const sampleLatitude =
        centerLatitude - localZM / context.metersPerDegreeLatitude;
      const horizonWeight = sealOuterBoundary
        ? outerTerrainHorizonWeight(row, column, gridCells)
        : 1;
      const color = terrainColor(
        elevationValues[index] + reliefValues[index],
        slopeDegrees,
        Math.round(sampleLongitude * 3600),
        Math.round(sampleLatitude * 3600),
        topShade,
      )
        .multiply(detailTint)
        .lerp(horizonTint, 1 - horizonWeight);
      const red = color.r;
      const green = color.g;
      const blue = color.b;
      const x0 = worldX - cellWorldX / 2;
      const x1 = worldX + cellWorldX / 2;
      const z0 = worldZ - cellWorldZ / 2;
      const z1 = worldZ + cellWorldZ / 2;
      const yTop = (centerTopVoxel + topLevel + 1) * cellWorldY;
      const cellRingGeometry = ringGeometry[index];
      if (cellRingGeometry) {
        cellRingGeometry.tops.forEach((rectangle) =>
          writeTop(
            rectangle.minimumX,
            rectangle.maximumX,
            rectangle.minimumZ,
            rectangle.maximumZ,
            yTop,
            red,
            green,
            blue,
          ),
        );
      } else {
        writeTop(
          localXM - cellM / 2,
          localXM + cellM / 2,
          localZM - cellM / 2,
          localZM + cellM / 2,
          yTop,
          red,
          green,
          blue,
        );
      }
      const writeSide = (
        coordinates: readonly number[],
        shade: number,
      ) => {
        TERRAIN_COLOR_SCRATCH.setRGB(
          (red * shade) / topShade,
          (green * shade) / topShade,
          (blue * shade) / topShade,
        ).lerp(horizonTint, 1 - horizonWeight);
        writeFace(
          coordinates,
          TERRAIN_COLOR_SCRATCH.r,
          TERRAIN_COLOR_SCRATCH.g,
          TERRAIN_COLOR_SCRATCH.b,
        );
      };
      if (
        (column + 1 < gridCells &&
          included[index + 1] &&
          topLevels[index + 1] < topLevel) ||
        (sealOuterBoundary && column + 1 >= gridCells)
      ) {
        const yBottom =
          (centerTopVoxel +
            (column + 1 < gridCells && included[index + 1]
              ? topLevels[index + 1]
              : skirtBottomLevel) +
            1) *
          cellWorldY;
        fillTerrainRectangleEdgeIntervals(
          localZM - cellM / 2,
          localZM + cellM / 2,
          localXM + cellM / 2,
          "z",
          innerHole,
          edgeIntervalScratch,
        );
        for (
          let edgeIndex = 0;
          edgeIndex < edgeIntervalScratch.length;
          edgeIndex += 2
        ) {
          const edgeZ0 =
            centerWorldZ +
            edgeIntervalScratch[edgeIndex] * worldScale.z;
          const edgeZ1 =
            centerWorldZ +
            edgeIntervalScratch[edgeIndex + 1] * worldScale.z;
          writeSide(
            [
              x1,
              yBottom,
              edgeZ0,
              x1,
              yTop,
              edgeZ0,
              x1,
              yTop,
              edgeZ1,
              x1,
              yBottom,
              edgeZ1,
            ],
            0.72,
          );
        }
      }
      if (
        (column > 0 &&
          included[index - 1] &&
          topLevels[index - 1] < topLevel) ||
        (sealOuterBoundary && column === 0)
      ) {
        const yBottom =
          (centerTopVoxel +
            (column > 0 && included[index - 1]
              ? topLevels[index - 1]
              : skirtBottomLevel) +
            1) *
          cellWorldY;
        fillTerrainRectangleEdgeIntervals(
          localZM - cellM / 2,
          localZM + cellM / 2,
          localXM - cellM / 2,
          "z",
          innerHole,
          edgeIntervalScratch,
        );
        for (
          let edgeIndex = 0;
          edgeIndex < edgeIntervalScratch.length;
          edgeIndex += 2
        ) {
          const edgeZ0 =
            centerWorldZ +
            edgeIntervalScratch[edgeIndex] * worldScale.z;
          const edgeZ1 =
            centerWorldZ +
            edgeIntervalScratch[edgeIndex + 1] * worldScale.z;
          writeSide(
            [
              x0,
              yBottom,
              edgeZ1,
              x0,
              yTop,
              edgeZ1,
              x0,
              yTop,
              edgeZ0,
              x0,
              yBottom,
              edgeZ0,
            ],
            0.56,
          );
        }
      }
      if (
        (row + 1 < gridCells &&
          included[index + gridCells] &&
          topLevels[index + gridCells] < topLevel) ||
        (sealOuterBoundary && row + 1 >= gridCells)
      ) {
        const yBottom =
          (centerTopVoxel +
            (row + 1 < gridCells && included[index + gridCells]
              ? topLevels[index + gridCells]
              : skirtBottomLevel) +
            1) *
          cellWorldY;
        fillTerrainRectangleEdgeIntervals(
          localXM - cellM / 2,
          localXM + cellM / 2,
          localZM + cellM / 2,
          "x",
          innerHole,
          edgeIntervalScratch,
        );
        for (
          let edgeIndex = 0;
          edgeIndex < edgeIntervalScratch.length;
          edgeIndex += 2
        ) {
          const edgeX0 =
            centerWorldX +
            edgeIntervalScratch[edgeIndex] * worldScale.x;
          const edgeX1 =
            centerWorldX +
            edgeIntervalScratch[edgeIndex + 1] * worldScale.x;
          writeSide(
            [
              edgeX0,
              yBottom,
              z1,
              edgeX1,
              yBottom,
              z1,
              edgeX1,
              yTop,
              z1,
              edgeX0,
              yTop,
              z1,
            ],
            0.64,
          );
        }
      }
      if (
        (row > 0 &&
          included[index - gridCells] &&
          topLevels[index - gridCells] < topLevel) ||
        (sealOuterBoundary && row === 0)
      ) {
        const yBottom =
          (centerTopVoxel +
            (row > 0 && included[index - gridCells]
              ? topLevels[index - gridCells]
              : skirtBottomLevel) +
            1) *
          cellWorldY;
        fillTerrainRectangleEdgeIntervals(
          localXM - cellM / 2,
          localXM + cellM / 2,
          localZM - cellM / 2,
          "x",
          innerHole,
          edgeIntervalScratch,
        );
        for (
          let edgeIndex = 0;
          edgeIndex < edgeIntervalScratch.length;
          edgeIndex += 2
        ) {
          const edgeX0 =
            centerWorldX +
            edgeIntervalScratch[edgeIndex] * worldScale.x;
          const edgeX1 =
            centerWorldX +
            edgeIntervalScratch[edgeIndex + 1] * worldScale.x;
          writeSide(
            [
              edgeX1,
              yBottom,
              z0,
              edgeX0,
              yBottom,
              z0,
              edgeX0,
              yTop,
              z0,
              edgeX1,
              yTop,
              z0,
            ],
            0.48,
          );
        }
      }
      cellRingGeometry?.seams.forEach((seam) => {
        const finerParallelGridOffset =
          seam.axis === "x"
            ? innerCenterOffsetZ
            : innerCenterOffsetX;
        subdivideTerrainSeam(
          seam.minimum,
          seam.maximum,
          innerCellM,
          finerParallelGridOffset,
        ).forEach((segment) => {
          const segmentMiddle =
            (segment.minimum + segment.maximum) / 2;
          const finerParallelCenter =
            finerParallelGridOffset +
            Math.round(
              (segmentMiddle - finerParallelGridOffset) /
                innerCellM,
            ) *
              innerCellM;
          const neighborTopY =
            seam.axis === "x"
              ? innerSurfaceTopY(
                  seam.coordinate -
                    seam.side * innerCellM / 2,
                  finerParallelCenter,
                )
              : innerSurfaceTopY(
                  finerParallelCenter,
                  seam.coordinate -
                    seam.side * innerCellM / 2,
                );
          const seamBottom = Math.min(yTop, neighborTopY);
          const seamTop = Math.max(yTop, neighborTopY);
          const normalSign = terrainSeamNormalSign(
            seam.side,
            yTop,
            neighborTopY,
          );
          if (seam.axis === "x") {
            const seamX =
              centerWorldX + seam.coordinate * worldScale.x;
            const seamZ0 =
              centerWorldZ + segment.minimum * worldScale.z;
            const seamZ1 =
              centerWorldZ + segment.maximum * worldScale.z;
            writeSide(
              normalSign > 0
                ? [
                    seamX,
                    seamBottom,
                    seamZ0,
                    seamX,
                    seamTop,
                    seamZ0,
                    seamX,
                    seamTop,
                    seamZ1,
                    seamX,
                    seamBottom,
                    seamZ1,
                  ]
                : [
                    seamX,
                    seamBottom,
                    seamZ1,
                    seamX,
                    seamTop,
                    seamZ1,
                    seamX,
                    seamTop,
                    seamZ0,
                    seamX,
                    seamBottom,
                    seamZ0,
                  ],
              normalSign > 0 ? 0.72 : 0.56,
            );
          } else {
            const seamZ =
              centerWorldZ + seam.coordinate * worldScale.z;
            const seamX0 =
              centerWorldX + segment.minimum * worldScale.x;
            const seamX1 =
              centerWorldX + segment.maximum * worldScale.x;
            writeSide(
              normalSign > 0
                ? [
                    seamX0,
                    seamBottom,
                    seamZ,
                    seamX1,
                    seamBottom,
                    seamZ,
                    seamX1,
                    seamTop,
                    seamZ,
                    seamX0,
                    seamTop,
                    seamZ,
                  ]
                : [
                    seamX1,
                    seamBottom,
                    seamZ,
                    seamX0,
                    seamBottom,
                    seamZ,
                    seamX0,
                    seamTop,
                    seamZ,
                    seamX1,
                    seamTop,
                    seamZ,
                  ],
              normalSign > 0 ? 0.64 : 0.48,
            );
          }
        });
      });
    }
  }

  if (face !== faceCount) {
    throw new Error(
      `Terrain topology mismatch: allocated ${faceCount} faces, wrote ${face}.`,
    );
  }
  return {
    positions,
    colors,
    indices,
    centerCanonicalX,
    centerCanonicalZ,
    renderedTopCount,
    buildMs: performance.now() - startedAt,
  };
}
