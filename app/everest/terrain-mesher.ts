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
  innerCellM: number;
  sealOuterBoundary: boolean;
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
  indices: Uint16Array | Uint32Array;
  centerCanonicalX: number;
  centerCanonicalZ: number;
  renderedTopCount: number;
  buildMs: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
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

interface TerrainTopRectangle {
  minimumX: number;
  maximumX: number;
  minimumZ: number;
  maximumZ: number;
}

interface TerrainInnerSeam {
  axis: "x" | "z";
  coordinate: number;
  minimum: number;
  maximum: number;
  side: -1 | 1;
}

interface TerrainCellRingGeometry {
  tops: TerrainTopRectangle[];
  seams: TerrainInnerSeam[];
}

const GEOMETRY_EPSILON = 1e-9;

function cellOverlapsInnerHole(
  minimumX: number,
  maximumX: number,
  minimumZ: number,
  maximumZ: number,
  halfHole: number,
) {
  return (
    maximumX > -halfHole + GEOMETRY_EPSILON &&
    minimumX < halfHole - GEOMETRY_EPSILON &&
    maximumZ > -halfHole + GEOMETRY_EPSILON &&
    minimumZ < halfHole - GEOMETRY_EPSILON
  );
}

/**
 * Subtracts the exact inner clipmap square from one terrain cell. No two LODs
 * own the same horizontal area, so depth order can never decide which height
 * is visible.
 */
export function clipTerrainCellToRing(
  localCenterX: number,
  localCenterZ: number,
  cellM: number,
  innerHoleM: number,
): TerrainCellRingGeometry {
  const minimumX = localCenterX - cellM / 2;
  const maximumX = localCenterX + cellM / 2;
  const minimumZ = localCenterZ - cellM / 2;
  const maximumZ = localCenterZ + cellM / 2;
  if (innerHoleM <= 0) {
    return {
      tops: [{ minimumX, maximumX, minimumZ, maximumZ }],
      seams: [],
    };
  }

  const halfHole = innerHoleM / 2;
  const overlapsHole = cellOverlapsInnerHole(
    minimumX,
    maximumX,
    minimumZ,
    maximumZ,
    halfHole,
  );
  if (!overlapsHole) {
    return {
      tops: [{ minimumX, maximumX, minimumZ, maximumZ }],
      seams: [],
    };
  }

  const tops: TerrainTopRectangle[] = [];
  const pushTop = (
    rectangleMinimumX: number,
    rectangleMaximumX: number,
    rectangleMinimumZ: number,
    rectangleMaximumZ: number,
  ) => {
    if (
      rectangleMaximumX - rectangleMinimumX > GEOMETRY_EPSILON &&
      rectangleMaximumZ - rectangleMinimumZ > GEOMETRY_EPSILON
    ) {
      tops.push({
        minimumX: rectangleMinimumX,
        maximumX: rectangleMaximumX,
        minimumZ: rectangleMinimumZ,
        maximumZ: rectangleMaximumZ,
      });
    }
  };

  pushTop(
    minimumX,
    Math.min(maximumX, -halfHole),
    minimumZ,
    maximumZ,
  );
  pushTop(
    Math.max(minimumX, halfHole),
    maximumX,
    minimumZ,
    maximumZ,
  );
  const centerMinimumX = Math.max(minimumX, -halfHole);
  const centerMaximumX = Math.min(maximumX, halfHole);
  pushTop(
    centerMinimumX,
    centerMaximumX,
    minimumZ,
    Math.min(maximumZ, -halfHole),
  );
  pushTop(
    centerMinimumX,
    centerMaximumX,
    Math.max(minimumZ, halfHole),
    maximumZ,
  );

  if (tops.length === 0) return { tops, seams: [] };
  const seams: TerrainInnerSeam[] = [];
  const seamMinimumZ = Math.max(minimumZ, -halfHole);
  const seamMaximumZ = Math.min(maximumZ, halfHole);
  const seamMinimumX = Math.max(minimumX, -halfHole);
  const seamMaximumX = Math.min(maximumX, halfHole);
  if (
    minimumX <= -halfHole + GEOMETRY_EPSILON &&
    maximumX >= -halfHole - GEOMETRY_EPSILON &&
    seamMaximumZ - seamMinimumZ > GEOMETRY_EPSILON
  ) {
    seams.push({
      axis: "x",
      coordinate: -halfHole,
      minimum: seamMinimumZ,
      maximum: seamMaximumZ,
      side: -1,
    });
  }
  if (
    minimumX <= halfHole + GEOMETRY_EPSILON &&
    maximumX >= halfHole - GEOMETRY_EPSILON &&
    seamMaximumZ - seamMinimumZ > GEOMETRY_EPSILON
  ) {
    seams.push({
      axis: "x",
      coordinate: halfHole,
      minimum: seamMinimumZ,
      maximum: seamMaximumZ,
      side: 1,
    });
  }
  if (
    minimumZ <= -halfHole + GEOMETRY_EPSILON &&
    maximumZ >= -halfHole - GEOMETRY_EPSILON &&
    seamMaximumX - seamMinimumX > GEOMETRY_EPSILON
  ) {
    seams.push({
      axis: "z",
      coordinate: -halfHole,
      minimum: seamMinimumX,
      maximum: seamMaximumX,
      side: -1,
    });
  }
  if (
    minimumZ <= halfHole + GEOMETRY_EPSILON &&
    maximumZ >= halfHole - GEOMETRY_EPSILON &&
    seamMaximumX - seamMinimumX > GEOMETRY_EPSILON
  ) {
    seams.push({
      axis: "z",
      coordinate: halfHole,
      minimum: seamMinimumX,
      maximum: seamMaximumX,
      side: 1,
    });
  }
  return { tops, seams };
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
    innerCellM,
    sealOuterBoundary,
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
  const centerCanonical = worldToCanonical(
    context,
    centerWorldX,
    centerWorldZ,
  );
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
  const centerCanonicalX = centerCanonical.x;
  const centerCanonicalZ = centerCanonical.z;
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
      const overlapsInnerHole =
        innerHoleM > 0 &&
        cellOverlapsInnerHole(
          localXM - cellM / 2,
          localXM + cellM / 2,
          localZM - cellM / 2,
          localZM + cellM / 2,
          innerHoleM / 2,
        );
      if (!overlapsInnerHole) {
        included[index] = 1;
        renderedTopCount += 1;
        continue;
      }
      const cellGeometry = clipTerrainCellToRing(
        localXM,
        localZM,
        cellM,
        innerHoleM,
      );
      if (cellGeometry.tops.length > 0) {
        ringGeometry[index] = cellGeometry;
        included[index] = 1;
        renderedTopCount += cellGeometry.tops.length;
        innerSeamCount += cellGeometry.seams.length;
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
  const skirtDepthLevels = 6;
  const skirtBottomLevel = minimumTopLevel - skirtDepthLevels;

  let faceCount = renderedTopCount + innerSeamCount;
  for (let row = 0; row < gridCells; row += 1) {
    for (let column = 0; column < gridCells; column += 1) {
      const index = row * gridCells + column;
      if (!included[index]) continue;
      const level = topLevels[index];
      if (
        (column + 1 < gridCells &&
          included[index + 1] &&
          topLevels[index + 1] < level) ||
        (sealOuterBoundary && column + 1 >= gridCells)
      ) {
        faceCount += 1;
      }
      if (
        (column > 0 &&
          included[index - 1] &&
          topLevels[index - 1] < level) ||
        (sealOuterBoundary && column === 0)
      ) {
        faceCount += 1;
      }
      if (
        (row + 1 < gridCells &&
          included[index + gridCells] &&
          topLevels[index + gridCells] < level) ||
        (sealOuterBoundary && row + 1 >= gridCells)
      ) {
        faceCount += 1;
      }
      if (
        (row > 0 &&
          included[index - gridCells] &&
          topLevels[index - gridCells] < level) ||
        (sealOuterBoundary && row === 0)
      ) {
        faceCount += 1;
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
    const elevationM = sampleDemElevation(
      elevations,
      metadata.width,
      metadata.height,
      centerColumn + localXM / sampleWidthM,
      centerRow + localZM / sampleHeightM,
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
        );
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
        writeSide(
          [x1, yBottom, z0, x1, yTop, z0, x1, yTop, z1, x1, yBottom, z1],
          0.72,
        );
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
        writeSide(
          [x0, yBottom, z1, x0, yTop, z1, x0, yTop, z0, x0, yBottom, z0],
          0.56,
        );
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
        writeSide(
          [x0, yBottom, z1, x1, yBottom, z1, x1, yTop, z1, x0, yTop, z1],
          0.64,
        );
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
        writeSide(
          [x1, yBottom, z0, x0, yBottom, z0, x0, yTop, z0, x1, yTop, z0],
          0.48,
        );
      }
      cellRingGeometry?.seams.forEach((seam) => {
        const neighborTopY =
          seam.axis === "x"
            ? innerSurfaceTopY(
                seam.coordinate,
                (seam.minimum + seam.maximum) / 2,
              )
            : innerSurfaceTopY(
                (seam.minimum + seam.maximum) / 2,
                seam.coordinate,
              );
        const seamBottom = Math.min(yTop, neighborTopY);
        const seamTop = Math.max(yTop, neighborTopY);
        if (seam.axis === "x") {
          const seamX =
            centerWorldX + seam.coordinate * worldScale.x;
          const seamZ0 =
            centerWorldZ + seam.minimum * worldScale.z;
          const seamZ1 =
            centerWorldZ + seam.maximum * worldScale.z;
          writeSide(
            seam.side < 0
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
            seam.side < 0 ? 0.72 : 0.56,
          );
        } else {
          const seamZ =
            centerWorldZ + seam.coordinate * worldScale.z;
          const seamX0 =
            centerWorldX + seam.minimum * worldScale.x;
          const seamX1 =
            centerWorldX + seam.maximum * worldScale.x;
          writeSide(
            seam.side < 0
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
            seam.side < 0 ? 0.64 : 0.48,
          );
        }
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
