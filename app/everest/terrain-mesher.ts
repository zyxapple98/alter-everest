import { syntheticReliefM } from "../../engine/surface";
import type { ObservatorySurfaceDeltaChunk } from "../../lib/world";
import {
  MOUNTAIN_MATERIALS,
  TERRAIN_COLOR_SCRATCH,
  terrainColor,
} from "./terrain-palette";

export interface TerrainMesherContext {
  metadata: {
    sampleSpacingArcSeconds: number;
    width: number;
    height: number;
    bounds: {
      north: number;
      west: number;
    };
  };
  elevations: Int16Array;
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
  cellM: number;
  gridCells: number;
  innerHoleM: number;
  innerOverlapM: number;
  outerTransitionM: number;
  terrainTint: string;
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
  visibility: Uint8Array;
  indices: Uint16Array | Uint32Array;
  centerCanonicalX: number;
  centerCanonicalZ: number;
  renderedTopCount: number;
  buildMs: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp(
    (value - edge0) / Math.max(0.0001, edge1 - edge0),
    0,
    1,
  );
  return t * t * (3 - 2 * t);
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

export function buildTerrainMesh(
  context: TerrainMesherContext,
  request: TerrainMeshRequest,
): TerrainMeshResult {
  const startedAt = performance.now();
  const { metadata, elevations, terrain } = context;
  const {
    centerWorldX,
    centerWorldZ,
    cellM,
    gridCells,
    innerHoleM,
    innerOverlapM,
    outerTransitionM,
    delta,
  } = request;
  const degreesPerSample = metadata.sampleSpacingArcSeconds / 3600;
  const centerColumn = clamp(
    (centerWorldX - terrain.xOrigin) / terrain.blockSize - 0.5,
    1,
    metadata.width - 2,
  );
  const centerRow = clamp(
    (centerWorldZ - terrain.zOrigin) / terrain.blockSize - 0.5,
    1,
    metadata.height - 2,
  );
  const centerLatitude =
    metadata.bounds.north - (centerRow + 0.5) * degreesPerSample;
  const centerLongitude =
    metadata.bounds.west + (centerColumn + 0.5) * degreesPerSample;
  const latitudeRadians = (centerLatitude * Math.PI) / 180;
  const sampleWidthM =
    degreesPerSample *
    context.metersPerDegreeLatitude *
    Math.cos(latitudeRadians);
  const sampleHeightM =
    degreesPerSample * context.metersPerDegreeLatitude;
  const metersPerDegreeLongitude =
    context.metersPerDegreeLatitude *
    Math.cos((context.canonicalOriginLatitude * Math.PI) / 180);
  const centerCanonicalX =
    (centerLongitude - context.canonicalOriginLongitude) *
    metersPerDegreeLongitude;
  const centerCanonicalZ =
    (context.canonicalOriginLatitude - centerLatitude) *
    context.metersPerDegreeLatitude;
  const centerElevationM = sampleDemElevation(
    elevations,
    metadata.width,
    metadata.height,
    centerColumn,
    centerRow,
  );
  const centerTopVoxel = Math.floor(
    (centerElevationM +
      syntheticReliefM(centerCanonicalX, centerCanonicalZ)) /
      cellM,
  );
  const halfGrid = Math.floor(gridCells / 2);
  const halfWindowM = (gridCells * cellM) / 2;
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
      const elevationM = sampleDemElevation(
        elevations,
        metadata.width,
        metadata.height,
        centerColumn + localXM / sampleWidthM,
        centerRow + localZM / sampleHeightM,
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
  const cellVisibility = new Float32Array(topLevels.length);
  let renderedTopCount = 0;
  for (let row = 0; row < gridCells; row += 1) {
    for (let column = 0; column < gridCells; column += 1) {
      const index = row * gridCells + column;
      const localXM = (column - halfGrid) * cellM;
      const localZM = (row - halfGrid) * cellM;
      const inset = Math.max(Math.abs(localXM), Math.abs(localZM));
      const insideInnerHole =
        innerHoleM > 0 &&
        inset < Math.max(0, innerHoleM / 2 - innerOverlapM);
      if (!insideInnerHole) {
        included[index] = 1;
        renderedTopCount += 1;
        const edgeDistanceM = halfWindowM - inset;
        cellVisibility[index] =
          outerTransitionM > 0
            ? smoothstep(0, outerTransitionM, edgeDistanceM)
            : 1;
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
  const skirtDepthLevels = Math.max(
    2,
    Math.ceil(
      Math.max(innerOverlapM, outerTransitionM, cellM * 2) / cellM,
    ),
  );
  const skirtBottomLevel = minimumTopLevel - skirtDepthLevels;

  let faceCount = renderedTopCount;
  for (let row = 0; row < gridCells; row += 1) {
    for (let column = 0; column < gridCells; column += 1) {
      const index = row * gridCells + column;
      if (!included[index]) continue;
      const level = topLevels[index];
      if (
        column + 1 >= gridCells ||
        !included[index + 1] ||
        topLevels[index + 1] < level
      ) {
        faceCount += 1;
      }
      if (
        column === 0 ||
        !included[index - 1] ||
        topLevels[index - 1] < level
      ) {
        faceCount += 1;
      }
      if (
        row + 1 >= gridCells ||
        !included[index + gridCells] ||
        topLevels[index + gridCells] < level
      ) {
        faceCount += 1;
      }
      if (
        row === 0 ||
        !included[index - gridCells] ||
        topLevels[index - gridCells] < level
      ) {
        faceCount += 1;
      }
    }
  }

  const positions = new Float32Array(faceCount * 12);
  const colors = new Uint8Array(faceCount * 12);
  const visibility = new Uint8Array(faceCount * 4);
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
    faceVisibility: number,
  ) => {
    const positionOffset = face * 12;
    positions.set(coordinates, positionOffset);
    const vertexOffset = face * 4;
    const redByte = Math.round(clamp(red, 0, 1) * 255);
    const greenByte = Math.round(clamp(green, 0, 1) * 255);
    const blueByte = Math.round(clamp(blue, 0, 1) * 255);
    const visibilityByte = Math.round(
      clamp(faceVisibility, 0, 1) * 255,
    );
    for (let vertex = 0; vertex < 4; vertex += 1) {
      const colorOffset = positionOffset + vertex * 3;
      colors[colorOffset] = redByte;
      colors[colorOffset + 1] = greenByte;
      colors[colorOffset + 2] = blueByte;
      visibility[vertexOffset + vertex] = visibilityByte;
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
  const cellWorld = cellM * context.worldUnitsPerMeter;
  const slopeSampleOffset = Math.max(1, Math.round(30 / cellM));

  for (let row = 0; row < gridCells; row += 1) {
    for (let column = 0; column < gridCells; column += 1) {
      const index = row * gridCells + column;
      if (!included[index]) continue;
      const localXM = (column - halfGrid) * cellM;
      const localZM = (row - halfGrid) * cellM;
      const worldX =
        centerWorldX + localXM * context.worldUnitsPerMeter;
      const worldZ =
        centerWorldZ + localZM * context.worldUnitsPerMeter;
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
      const color = terrainColor(
        elevationValues[index] + reliefValues[index],
        slopeDegrees,
        Math.round(sampleLongitude * 3600),
        Math.round(sampleLatitude * 3600),
        topShade,
      ).multiply(detailTint);
      const red = color.r;
      const green = color.g;
      const blue = color.b;
      const x0 = worldX - cellWorld / 2;
      const x1 = worldX + cellWorld / 2;
      const z0 = worldZ - cellWorld / 2;
      const z1 = worldZ + cellWorld / 2;
      const yTop = (centerTopVoxel + topLevel + 1) * cellWorld;
      const faceVisibility = cellVisibility[index];
      writeFace(
        [x0, yTop, z0, x0, yTop, z1, x1, yTop, z1, x1, yTop, z0],
        red,
        green,
        blue,
        faceVisibility,
      );
      const writeSide = (
        coordinates: readonly number[],
        shade: number,
      ) => {
        TERRAIN_COLOR_SCRATCH.setRGB(
          (red * shade) / topShade,
          (green * shade) / topShade,
          (blue * shade) / topShade,
        );
        writeFace(
          coordinates,
          TERRAIN_COLOR_SCRATCH.r,
          TERRAIN_COLOR_SCRATCH.g,
          TERRAIN_COLOR_SCRATCH.b,
          // LOD dithering is safe on horizontal tops because the coarser
          // ring sits underneath them. Vertical faces are the closure between
          // different voxel heights; discarding pixels there exposes the
          // empty interior of the height field at grazing camera angles.
          1,
        );
      };
      if (
        column + 1 >= gridCells ||
        !included[index + 1] ||
        topLevels[index + 1] < topLevel
      ) {
        const yBottom =
          (centerTopVoxel +
            (column + 1 < gridCells && included[index + 1]
              ? topLevels[index + 1]
              : skirtBottomLevel) +
            1) *
          cellWorld;
        writeSide(
          [x1, yBottom, z0, x1, yTop, z0, x1, yTop, z1, x1, yBottom, z1],
          0.72,
        );
      }
      if (
        column === 0 ||
        !included[index - 1] ||
        topLevels[index - 1] < topLevel
      ) {
        const yBottom =
          (centerTopVoxel +
            (column > 0 && included[index - 1]
              ? topLevels[index - 1]
              : skirtBottomLevel) +
            1) *
          cellWorld;
        writeSide(
          [x0, yBottom, z1, x0, yTop, z1, x0, yTop, z0, x0, yBottom, z0],
          0.56,
        );
      }
      if (
        row + 1 >= gridCells ||
        !included[index + gridCells] ||
        topLevels[index + gridCells] < topLevel
      ) {
        const yBottom =
          (centerTopVoxel +
            (row + 1 < gridCells && included[index + gridCells]
              ? topLevels[index + gridCells]
              : skirtBottomLevel) +
            1) *
          cellWorld;
        writeSide(
          [x0, yBottom, z1, x1, yBottom, z1, x1, yTop, z1, x0, yTop, z1],
          0.64,
        );
      }
      if (
        row === 0 ||
        !included[index - gridCells] ||
        topLevels[index - gridCells] < topLevel
      ) {
        const yBottom =
          (centerTopVoxel +
            (row > 0 && included[index - gridCells]
              ? topLevels[index - gridCells]
              : skirtBottomLevel) +
            1) *
          cellWorld;
        writeSide(
          [x1, yBottom, z0, x0, yBottom, z0, x0, yTop, z0, x1, yTop, z0],
          0.48,
        );
      }
    }
  }

  return {
    positions,
    colors,
    visibility,
    indices,
    centerCanonicalX,
    centerCanonicalZ,
    renderedTopCount,
    buildMs: performance.now() - startedAt,
  };
}
