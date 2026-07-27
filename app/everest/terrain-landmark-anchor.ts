export interface RenderedTerrainLandmarkCell {
  canonicalX: number;
  canonicalZ: number;
  naturalElevationM: number;
  surfaceTopM: number;
}

export interface RenderedTerrainLandmarkOptions {
  centerCanonicalX: number;
  centerCanonicalZ: number;
  cellM: number;
  searchRadiusM: number;
  sampleNaturalElevationM(
    canonicalX: number,
    canonicalZ: number,
    cellM: number,
  ): number;
}

function snappedCellCenter(coordinateM: number, cellM: number) {
  return (Math.floor(coordinateM / cellM) + 0.5) * cellM;
}

export interface RenderedTerrainCellOptions {
  canonicalX: number;
  canonicalZ: number;
  cellM: number;
  sampleNaturalElevationM(
    canonicalX: number,
    canonicalZ: number,
    cellM: number,
  ): number;
}

/**
 * Maps one stable geographic point onto the voxel that represents it in the
 * active LOD. The returned point is the centre of that visible cell, so its
 * height and horizontal position agree with the mesh even on a steep slope.
 */
export function renderedTerrainCellAt(
  options: RenderedTerrainCellOptions,
): RenderedTerrainLandmarkCell {
  const {
    canonicalX,
    canonicalZ,
    cellM,
    sampleNaturalElevationM,
  } = options;
  if (
    !Number.isFinite(canonicalX) ||
    !Number.isFinite(canonicalZ) ||
    !Number.isFinite(cellM) ||
    cellM <= 0
  ) {
    throw new Error("Rendered terrain cells require finite coordinates.");
  }
  const snappedCanonicalX = snappedCellCenter(canonicalX, cellM);
  const snappedCanonicalZ = snappedCellCenter(canonicalZ, cellM);
  const naturalElevationM = sampleNaturalElevationM(
    snappedCanonicalX,
    snappedCanonicalZ,
    cellM,
  );
  return {
    canonicalX: snappedCanonicalX,
    canonicalZ: snappedCanonicalZ,
    naturalElevationM,
    surfaceTopM:
      (Math.floor(naturalElevationM / cellM) + 1) * cellM,
  };
}

/**
 * Resolves a semantic landmark, such as the summit, once against its authority
 * terrain. Callers then retain this canonical point and use
 * renderedTerrainCellAt to project it into coarser or finer display LODs.
 *
 * This separation prevents a place or navigation destination from wandering
 * when the camera zooms while still making its pin touch the visible mesh.
 */
export function highestRenderedTerrainCellNear(
  options: RenderedTerrainLandmarkOptions,
): RenderedTerrainLandmarkCell {
  const {
    centerCanonicalX,
    centerCanonicalZ,
    cellM,
    searchRadiusM,
    sampleNaturalElevationM,
  } = options;
  if (
    !Number.isFinite(centerCanonicalX) ||
    !Number.isFinite(centerCanonicalZ) ||
    !Number.isFinite(cellM) ||
    cellM <= 0 ||
    !Number.isFinite(searchRadiusM) ||
    searchRadiusM < 0
  ) {
    throw new Error("Terrain landmark search requires finite coordinates.");
  }

  const searchCellM = cellM;
  const firstX = snappedCellCenter(
    centerCanonicalX - searchRadiusM,
    searchCellM,
  );
  const lastX = snappedCellCenter(
    centerCanonicalX + searchRadiusM,
    searchCellM,
  );
  const firstZ = snappedCellCenter(
    centerCanonicalZ - searchRadiusM,
    searchCellM,
  );
  const lastZ = snappedCellCenter(
    centerCanonicalZ + searchRadiusM,
    searchCellM,
  );
  const permittedRadiusM = searchRadiusM + searchCellM * 0.75;
  let best:
    | (RenderedTerrainLandmarkCell & { distanceSquaredM: number })
    | undefined;

  for (
    let searchX = firstX;
    searchX <= lastX + searchCellM * 0.25;
    searchX += searchCellM
  ) {
    for (
      let searchZ = firstZ;
      searchZ <= lastZ + searchCellM * 0.25;
      searchZ += searchCellM
    ) {
      const deltaX = searchX - centerCanonicalX;
      const deltaZ = searchZ - centerCanonicalZ;
      const distanceSquaredM = deltaX * deltaX + deltaZ * deltaZ;
      if (distanceSquaredM > permittedRadiusM * permittedRadiusM) {
        continue;
      }
      const candidateCell = renderedTerrainCellAt({
        canonicalX: searchX,
        canonicalZ: searchZ,
        cellM,
        sampleNaturalElevationM,
      });
      const candidate = {
        ...candidateCell,
        distanceSquaredM,
      };
      if (
        !best ||
        candidate.surfaceTopM > best.surfaceTopM ||
        (candidate.surfaceTopM === best.surfaceTopM &&
          candidate.naturalElevationM > best.naturalElevationM) ||
        (candidate.surfaceTopM === best.surfaceTopM &&
          candidate.naturalElevationM === best.naturalElevationM &&
          candidate.distanceSquaredM < best.distanceSquaredM)
      ) {
        best = candidate;
      }
    }
  }

  if (!best) {
    return renderedTerrainCellAt({
      canonicalX: centerCanonicalX,
      canonicalZ: centerCanonicalZ,
      cellM,
      sampleNaturalElevationM,
    });
  }

  return {
    canonicalX: best.canonicalX,
    canonicalZ: best.canonicalZ,
    naturalElevationM: best.naturalElevationM,
    surfaceTopM: best.surfaceTopM,
  };
}
