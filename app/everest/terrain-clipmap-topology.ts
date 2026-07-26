export interface TerrainTopRectangle {
  minimumX: number;
  maximumX: number;
  minimumZ: number;
  maximumZ: number;
}

export interface TerrainInnerSeam {
  axis: "x" | "z";
  coordinate: number;
  minimum: number;
  maximum: number;
  side: -1 | 1;
}

export interface TerrainCellRingGeometry {
  tops: TerrainTopRectangle[];
  seams: TerrainInnerSeam[];
}

export interface TerrainInterval {
  minimum: number;
  maximum: number;
}

export interface TerrainHoleRectangle {
  minimumX: number;
  maximumX: number;
  minimumZ: number;
  maximumZ: number;
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

function cellTouchesInnerBoundary(
  minimumX: number,
  maximumX: number,
  minimumZ: number,
  maximumZ: number,
  halfHole: number,
) {
  const overlapsZ =
    maximumZ > -halfHole + GEOMETRY_EPSILON &&
    minimumZ < halfHole - GEOMETRY_EPSILON;
  const overlapsX =
    maximumX > -halfHole + GEOMETRY_EPSILON &&
    minimumX < halfHole - GEOMETRY_EPSILON;
  return (
    (overlapsZ &&
      (Math.abs(maximumX + halfHole) <= GEOMETRY_EPSILON ||
        Math.abs(minimumX - halfHole) <= GEOMETRY_EPSILON)) ||
    (overlapsX &&
      (Math.abs(maximumZ + halfHole) <= GEOMETRY_EPSILON ||
        Math.abs(minimumZ - halfHole) <= GEOMETRY_EPSILON))
  );
}

function terrainInnerSeams(
  minimumX: number,
  maximumX: number,
  minimumZ: number,
  maximumZ: number,
  halfHole: number,
) {
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
  return seams;
}

/**
 * Clips one voxel side edge to the same square-ring footprint as its top.
 * `output` is a flat min/max pair array so the mesher can reuse one buffer.
 */
export function fillTerrainEdgeIntervals(
  minimum: number,
  maximum: number,
  fixedCoordinate: number,
  innerHoleM: number,
  output: number[],
) {
  output.length = 0;
  if (innerHoleM <= 0) {
    output.push(minimum, maximum);
    return 1;
  }
  const halfHole = innerHoleM / 2;
  if (Math.abs(fixedCoordinate) >= halfHole - GEOMETRY_EPSILON) {
    output.push(minimum, maximum);
    return 1;
  }
  const firstMaximum = Math.min(maximum, -halfHole);
  if (firstMaximum - minimum > GEOMETRY_EPSILON) {
    output.push(minimum, firstMaximum);
  }
  const secondMinimum = Math.max(minimum, halfHole);
  if (maximum - secondMinimum > GEOMETRY_EPSILON) {
    output.push(secondMinimum, maximum);
  }
  return output.length / 2;
}

export function terrainEdgeIntervals(
  minimum: number,
  maximum: number,
  fixedCoordinate: number,
  innerHoleM: number,
): TerrainInterval[] {
  const values: number[] = [];
  fillTerrainEdgeIntervals(
    minimum,
    maximum,
    fixedCoordinate,
    innerHoleM,
    values,
  );
  const result: TerrainInterval[] = [];
  for (let index = 0; index < values.length; index += 2) {
    result.push({
      minimum: values[index],
      maximum: values[index + 1],
    });
  }
  return result;
}

/**
 * Splits a coarse seam at every fine-grid boundary. Each returned interval
 * corresponds to exactly one adjacent finer voxel column.
 */
export function subdivideTerrainSeam(
  minimum: number,
  maximum: number,
  finerCellM: number,
): TerrainInterval[] {
  if (
    maximum - minimum <= GEOMETRY_EPSILON ||
    finerCellM <= GEOMETRY_EPSILON
  ) {
    return maximum - minimum > GEOMETRY_EPSILON
      ? [{ minimum, maximum }]
      : [];
  }
  const result: TerrainInterval[] = [];
  let cursor = minimum;
  let boundaryIndex =
    Math.floor(minimum / finerCellM - 0.5) + 1;
  let boundary = (boundaryIndex + 0.5) * finerCellM;
  while (boundary < maximum - GEOMETRY_EPSILON) {
    if (boundary - cursor > GEOMETRY_EPSILON) {
      result.push({ minimum: cursor, maximum: boundary });
    }
    cursor = boundary;
    boundaryIndex += 1;
    boundary = (boundaryIndex + 0.5) * finerCellM;
  }
  if (maximum - cursor > GEOMETRY_EPSILON) {
    result.push({ minimum: cursor, maximum });
  }
  return result;
}

/**
 * Point a seam face toward the lower surface. FrontSide culling can therefore
 * never hide a transition when the finer LOD is higher than the coarse one.
 */
export function terrainSeamNormalSign(
  side: -1 | 1,
  coarseTopY: number,
  finerTopY: number,
) {
  return coarseTopY >= finerTopY ? -side : side;
}

/**
 * Subtracts the exact inner clipmap square from one terrain cell. No two LODs
 * own the same horizontal area, so depth order never chooses the visible LOD.
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
  if (
    !cellOverlapsInnerHole(
      minimumX,
      maximumX,
      minimumZ,
      maximumZ,
      halfHole,
    )
  ) {
    return {
      tops: [{ minimumX, maximumX, minimumZ, maximumZ }],
      seams: terrainInnerSeams(
        minimumX,
        maximumX,
        minimumZ,
        maximumZ,
        halfHole,
      ),
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
  return {
    tops,
    seams: terrainInnerSeams(
      minimumX,
      maximumX,
      minimumZ,
      maximumZ,
      halfHole,
    ),
  };
}

function splitRectangleAtSeam(
  rectangle: TerrainTopRectangle,
  seam: TerrainInnerSeam,
  finerCellM: number,
) {
  const parallelMinimum =
    seam.axis === "x" ? rectangle.minimumZ : rectangle.minimumX;
  const parallelMaximum =
    seam.axis === "x" ? rectangle.maximumZ : rectangle.maximumX;
  const segments: TerrainInterval[] = [];
  if (parallelMinimum < seam.minimum - GEOMETRY_EPSILON) {
    segments.push({
      minimum: parallelMinimum,
      maximum: seam.minimum,
    });
  }
  segments.push(
    ...subdivideTerrainSeam(
      Math.max(parallelMinimum, seam.minimum),
      Math.min(parallelMaximum, seam.maximum),
      finerCellM,
    ),
  );
  if (parallelMaximum > seam.maximum + GEOMETRY_EPSILON) {
    segments.push({
      minimum: seam.maximum,
      maximum: parallelMaximum,
    });
  }
  return segments.map((segment) =>
    seam.axis === "x"
      ? {
          minimumX: rectangle.minimumX,
          maximumX: rectangle.maximumX,
          minimumZ: segment.minimum,
          maximumZ: segment.maximum,
        }
      : {
          minimumX: segment.minimum,
          maximumX: segment.maximum,
          minimumZ: rectangle.minimumZ,
          maximumZ: rectangle.maximumZ,
        },
  );
}

function rectangleTouchesSeam(
  rectangle: TerrainTopRectangle,
  seam: TerrainInnerSeam,
) {
  const perpendicularMinimum =
    seam.axis === "x" ? rectangle.minimumX : rectangle.minimumZ;
  const perpendicularMaximum =
    seam.axis === "x" ? rectangle.maximumX : rectangle.maximumZ;
  const parallelMinimum =
    seam.axis === "x" ? rectangle.minimumZ : rectangle.minimumX;
  const parallelMaximum =
    seam.axis === "x" ? rectangle.maximumZ : rectangle.maximumX;
  return (
    (Math.abs(perpendicularMinimum - seam.coordinate) <=
      GEOMETRY_EPSILON ||
      Math.abs(perpendicularMaximum - seam.coordinate) <=
        GEOMETRY_EPSILON) &&
    parallelMaximum > seam.minimum + GEOMETRY_EPSILON &&
    parallelMinimum < seam.maximum - GEOMETRY_EPSILON
  );
}

function alignTerrainCellSeamVertices(
  geometry: TerrainCellRingGeometry,
  finerCellM: number,
): TerrainCellRingGeometry {
  if (geometry.seams.length === 0 || finerCellM <= 0) {
    return geometry;
  }
  return {
    tops: geometry.tops.flatMap((rectangle) => {
      const seam = geometry.seams.find((candidate) =>
        rectangleTouchesSeam(rectangle, candidate),
      );
      return seam
        ? splitRectangleAtSeam(rectangle, seam, finerCellM)
        : [rectangle];
    }),
    seams: geometry.seams,
  };
}

/**
 * Returns null for an ordinary full coarse cell. Boundary cells receive exact
 * ring ownership and fine-grid-aligned seam vertices; cells inside the hole
 * receive an empty geometry and are omitted by the mesher.
 */
export function terrainCellRingGeometry(
  localCenterX: number,
  localCenterZ: number,
  cellM: number,
  innerHoleM: number,
  finerCellM: number,
): TerrainCellRingGeometry | null {
  if (innerHoleM <= 0) return null;
  const minimumX = localCenterX - cellM / 2;
  const maximumX = localCenterX + cellM / 2;
  const minimumZ = localCenterZ - cellM / 2;
  const maximumZ = localCenterZ + cellM / 2;
  const halfHole = innerHoleM / 2;
  if (
    !cellOverlapsInnerHole(
      minimumX,
      maximumX,
      minimumZ,
      maximumZ,
      halfHole,
    ) &&
    !cellTouchesInnerBoundary(
      minimumX,
      maximumX,
      minimumZ,
      maximumZ,
      halfHole,
    )
  ) {
    return null;
  }
  return alignTerrainCellSeamVertices(
    clipTerrainCellToRing(
      localCenterX,
      localCenterZ,
      cellM,
      innerHoleM,
    ),
    finerCellM,
  );
}

function rectangularHoleSeams(
  minimumX: number,
  maximumX: number,
  minimumZ: number,
  maximumZ: number,
  hole: TerrainHoleRectangle,
) {
  const seams: TerrainInnerSeam[] = [];
  const seamMinimumZ = Math.max(minimumZ, hole.minimumZ);
  const seamMaximumZ = Math.min(maximumZ, hole.maximumZ);
  const seamMinimumX = Math.max(minimumX, hole.minimumX);
  const seamMaximumX = Math.min(maximumX, hole.maximumX);
  if (
    minimumX <= hole.minimumX + GEOMETRY_EPSILON &&
    maximumX >= hole.minimumX - GEOMETRY_EPSILON &&
    seamMaximumZ - seamMinimumZ > GEOMETRY_EPSILON
  ) {
    seams.push({
      axis: "x",
      coordinate: hole.minimumX,
      minimum: seamMinimumZ,
      maximum: seamMaximumZ,
      side: -1,
    });
  }
  if (
    minimumX <= hole.maximumX + GEOMETRY_EPSILON &&
    maximumX >= hole.maximumX - GEOMETRY_EPSILON &&
    seamMaximumZ - seamMinimumZ > GEOMETRY_EPSILON
  ) {
    seams.push({
      axis: "x",
      coordinate: hole.maximumX,
      minimum: seamMinimumZ,
      maximum: seamMaximumZ,
      side: 1,
    });
  }
  if (
    minimumZ <= hole.minimumZ + GEOMETRY_EPSILON &&
    maximumZ >= hole.minimumZ - GEOMETRY_EPSILON &&
    seamMaximumX - seamMinimumX > GEOMETRY_EPSILON
  ) {
    seams.push({
      axis: "z",
      coordinate: hole.minimumZ,
      minimum: seamMinimumX,
      maximum: seamMaximumX,
      side: -1,
    });
  }
  if (
    minimumZ <= hole.maximumZ + GEOMETRY_EPSILON &&
    maximumZ >= hole.maximumZ - GEOMETRY_EPSILON &&
    seamMaximumX - seamMinimumX > GEOMETRY_EPSILON
  ) {
    seams.push({
      axis: "z",
      coordinate: hole.maximumZ,
      minimum: seamMinimumX,
      maximum: seamMaximumX,
      side: 1,
    });
  }
  return seams;
}

/**
 * Subtracts an arbitrary rectangular inner layer from one outer terrain cell.
 * This is the same single-owner contract used by square detail clipmaps, but
 * it also covers the fixed 30 m activity / 300 m overview transition.
 */
export function clipTerrainRectangleToHole(
  minimumX: number,
  maximumX: number,
  minimumZ: number,
  maximumZ: number,
  hole: TerrainHoleRectangle,
): TerrainCellRingGeometry {
  const intersectionMinimumX = Math.max(minimumX, hole.minimumX);
  const intersectionMaximumX = Math.min(maximumX, hole.maximumX);
  const intersectionMinimumZ = Math.max(minimumZ, hole.minimumZ);
  const intersectionMaximumZ = Math.min(maximumZ, hole.maximumZ);
  const overlapsHole =
    intersectionMaximumX - intersectionMinimumX >
      GEOMETRY_EPSILON &&
    intersectionMaximumZ - intersectionMinimumZ >
      GEOMETRY_EPSILON;
  if (!overlapsHole) {
    return {
      tops: [{ minimumX, maximumX, minimumZ, maximumZ }],
      seams: rectangularHoleSeams(
        minimumX,
        maximumX,
        minimumZ,
        maximumZ,
        hole,
      ),
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
    intersectionMinimumX,
    minimumZ,
    maximumZ,
  );
  pushTop(
    intersectionMaximumX,
    maximumX,
    minimumZ,
    maximumZ,
  );
  pushTop(
    intersectionMinimumX,
    intersectionMaximumX,
    minimumZ,
    intersectionMinimumZ,
  );
  pushTop(
    intersectionMinimumX,
    intersectionMaximumX,
    intersectionMaximumZ,
    maximumZ,
  );

  return {
    tops,
    seams:
      tops.length > 0
        ? rectangularHoleSeams(
            minimumX,
            maximumX,
            minimumZ,
            maximumZ,
            hole,
          )
        : [],
  };
}

/**
 * Clips an internal height-wall edge to an arbitrary rectangular hole.
 * `axis` is the varying coordinate of the edge.
 */
export function fillTerrainRectangleEdgeIntervals(
  minimum: number,
  maximum: number,
  fixedCoordinate: number,
  axis: "x" | "z",
  hole: TerrainHoleRectangle | null,
  output: number[],
) {
  output.length = 0;
  if (!hole) {
    output.push(minimum, maximum);
    return 1;
  }
  const fixedMinimum =
    axis === "x" ? hole.minimumZ : hole.minimumX;
  const fixedMaximum =
    axis === "x" ? hole.maximumZ : hole.maximumX;
  if (
    fixedCoordinate <= fixedMinimum + GEOMETRY_EPSILON ||
    fixedCoordinate >= fixedMaximum - GEOMETRY_EPSILON
  ) {
    output.push(minimum, maximum);
    return 1;
  }
  const holeMinimum =
    axis === "x" ? hole.minimumX : hole.minimumZ;
  const holeMaximum =
    axis === "x" ? hole.maximumX : hole.maximumZ;
  const firstMaximum = Math.min(maximum, holeMinimum);
  if (firstMaximum - minimum > GEOMETRY_EPSILON) {
    output.push(minimum, firstMaximum);
  }
  const secondMinimum = Math.max(minimum, holeMaximum);
  if (maximum - secondMinimum > GEOMETRY_EPSILON) {
    output.push(secondMinimum, maximum);
  }
  return output.length / 2;
}
