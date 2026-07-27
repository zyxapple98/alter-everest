import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import type {
  ObservatoryFeed,
  ObservatorySurfaceTile,
} from "../lib/world";
import {
  focusAnchoredTerrainCenter,
  requiredOrbitVerticalShift,
  ScreenSpaceLodSelector,
} from "../app/everest/terrain-runtime";
import {
  buildTerrainMesh,
  sampleTerrainElevation,
} from "../app/everest/terrain-mesher";
import {
  clipTerrainRectangleToHole,
  fillTerrainRectangleEdgeIntervals,
  clipTerrainCellToRing,
  subdivideTerrainSeam,
  terrainCellRectangularRingGeometry,
  terrainEdgeIntervals,
  terrainSeamNormalSign,
} from "../app/everest/terrain-clipmap-topology";
import {
  alignedActivityTerrainBounds,
  geographicBoundsToTerrainHole,
  terrainOverviewMorphWeight,
  terrainOverviewTargetPoint,
} from "../app/everest/terrain-overview-transition";
import { SurfaceTileStore } from "../app/everest/surface-tile-store";
import {
  anchoredCanonicalWorldPosition,
  pointBelongsToPatchRing,
  TerrainStreamingEngine,
} from "../app/everest/terrain-streaming";
import {
  canonicalToWorld,
  canonicalWorldScale,
  worldToCanonical,
} from "../app/everest/canonical-world";
import {
  MAX_TERRAIN_OVERVIEW_DISTANCE_M,
  planTerrainClipmap,
  snapCanonicalClipmapCoordinate,
  TERRAIN_FAR_PLANE_TRANSMITTANCE,
  TERRAIN_CAMERA_FAR_DISTANCE_M,
  terrainFogTransmittance,
  terrainClipmapLevelIndex,
  TERRAIN_CLIPMAP_LEVELS,
} from "../app/everest/terrain-lod-plan";
import {
  highestRenderedTerrainCellNear,
  renderedTerrainCellAt,
} from "../app/everest/terrain-landmark-anchor";

test("screen-space terrain LOD follows projected voxel density", () => {
  const levels = [
    { value: "20 CM", cellM: 0.2 },
    { value: "80 CM", cellM: 0.8 },
    { value: "3.2 M", cellM: 3.2 },
    { value: "15 M", cellM: 15 },
    { value: "90 M", cellM: 90 },
  ] as const;
  const selector = new ScreenSpaceLodSelector(levels, "90 M", 11);
  selector.update(12, 1_000, Math.PI / 4, 0, false);
  assert.equal(
    selector.update(12, 1_000, Math.PI / 4, 100, false),
    "20 CM",
  );
  selector.update(1_000, 1_000, Math.PI / 4, 200, false);
  assert.notEqual(
    selector.update(1_000, 1_000, Math.PI / 4, 300, false),
    "20 CM",
  );
});

test("orbiting a camera cannot move the terrain detail anchor", () => {
  const focus = { x: 125, z: -75 };
  const northView = focusAnchoredTerrainCenter(
    focus,
    { x: 125, z: -25 },
  );
  const eastView = focusAnchoredTerrainCenter(
    focus,
    { x: 175, z: -75 },
  );
  assert.equal(northView, focus);
  assert.equal(eastView, focus);
  assert.deepEqual(northView, eastView);
});

test("terrain landmark authority resolves to the highest nearby voxel", () => {
  const elevations = new Map([
    ["45:45", 8_700],
    ["135:45", 8_710],
    ["45:135", 8_720],
    ["135:135", 8_740],
  ]);
  const anchor = highestRenderedTerrainCellNear({
    centerCanonicalX: 80,
    centerCanonicalZ: 80,
    cellM: 90,
    searchRadiusM: 150,
    sampleNaturalElevationM: (x, z) =>
      elevations.get(`${x}:${z}`) ?? 8_000,
  });

  assert.deepEqual(anchor, {
    canonicalX: 135,
    canonicalZ: 135,
    naturalElevationM: 8_740,
    surfaceTopM: 8_820,
  });
});

test("one semantic landmark maps onto each active LOD without moving its authority point", () => {
  const semanticAnchor = {
    canonicalX: 45.1,
    canonicalZ: -14.9,
  };
  const coarse = renderedTerrainCellAt({
    ...semanticAnchor,
    cellM: 90,
    sampleNaturalElevationM: () => 8_724,
  });
  const fine = renderedTerrainCellAt({
    ...semanticAnchor,
    cellM: 0.2,
    sampleNaturalElevationM: () => 8_735,
  });

  assert.deepEqual(coarse, {
    canonicalX: 45,
    canonicalZ: -45,
    naturalElevationM: 8_724,
    surfaceTopM: 8_730,
  });
  assert.equal(fine.canonicalX, 45.1);
  assert.equal(fine.canonicalZ, -14.9);
  assert.ok(Math.abs(fine.surfaceTopM - 8_735.2) < 1e-9);
});

test("an upward orbit preserves pitch while clearing the terrain", () => {
  const cameraY = 2;
  const targetY = 10;
  const shift = requiredOrbitVerticalShift(
    cameraY,
    targetY,
    0,
    3,
  );
  assert.equal(shift, 1);
  assert.equal(cameraY + shift, 3);
  assert.equal(
    cameraY + shift - (targetY + shift),
    cameraY - targetY,
  );

  assert.equal(requiredOrbitVerticalShift(12, 0, 0, 3), 0);
});

test("one clipmap plan spans selectable detail and macro terrain", () => {
  const activeIndex = terrainClipmapLevelIndex("1.6 M");
  const rings = planTerrainClipmap(
    TERRAIN_CLIPMAP_LEVELS,
    activeIndex,
  );
  assert.equal(rings[0].cellM, 1.6);
  assert.equal(rings[0].innerHoleM, 0);
  assert.deepEqual(
    rings.map(({ cellM }) => cellM),
    [1.6, 3.2, 6.4, 15, 30, 90, 180, 300],
  );
  assert.equal(rings.at(-1)?.sealOuterBoundary, true);
  rings.slice(1).forEach((ring, index) => {
    assert.equal(ring.innerHoleM, rings[index].windowM);
    assert.equal(ring.innerCellM, rings[index].cellM);
  });
  const outerRing = rings.at(-1);
  assert.ok(outerRing);
  assert.ok(
    outerRing.windowM / 2 > TERRAIN_CAMERA_FAR_DISTANCE_M,
  );
  assert.ok(
    MAX_TERRAIN_OVERVIEW_DISTANCE_M <
      TERRAIN_CAMERA_FAR_DISTANCE_M,
  );
});

test("atmospheric fade hides the far clipping plane", () => {
  const worldUnitsPerMeter = 0.235 / 30;
  assert.ok(
    Math.abs(
      terrainFogTransmittance(
        TERRAIN_CAMERA_FAR_DISTANCE_M,
        worldUnitsPerMeter,
      ) - TERRAIN_FAR_PLANE_TRANSMITTANCE,
    ) < 1e-12,
  );
  assert.ok(
    terrainFogTransmittance(
      MAX_TERRAIN_OVERVIEW_DISTANCE_M,
      worldUnitsPerMeter,
    ) > 0.3,
  );
});

test("each clipmap level recenters only by whole native cells", () => {
  for (const level of TERRAIN_CLIPMAP_LEVELS) {
    const first = snapCanonicalClipmapCoordinate(12_345.67, level.cellM);
    const next = snapCanonicalClipmapCoordinate(
      12_345.67 + level.cellM,
      level.cellM,
    );
    assert.ok(Math.abs(next - first - level.cellM) < 1e-9);
    const phase = first / level.cellM - 0.5;
    assert.ok(Math.abs(phase - Math.round(phase)) < 1e-9);
  }
});

test("DEM pyramid selects by cell size and falls back by coverage", () => {
  const constantSource = (
    minimumCellM: number,
    value: number,
    extent: number,
  ) => {
    const dimension = extent * 40;
    return {
      minimumCellM,
      metadata: {
        sampleSpacingArcSeconds: 180,
        width: dimension,
        height: dimension,
        bounds: {
          north: extent,
          south: -extent,
          west: -extent,
          east: extent,
        },
      },
      elevations: new Int16Array(dimension * dimension).fill(value),
    };
  };
  const authority = constantSource(0, 100, 2);
  const context = {
    metadata: authority.metadata,
    elevations: authority.elevations,
    elevationSources: [
      constantSource(90, 200, 4),
      constantSource(300, 300, 6),
    ],
    terrain: {
      blockSize: 1,
      xOrigin: 0,
      zOrigin: 0,
    },
    canonicalOriginLatitude: 0,
    canonicalOriginLongitude: 0,
    metersPerDegreeLatitude: 100,
    worldUnitsPerMeter: 1,
  };
  assert.equal(sampleTerrainElevation(context, 0, 0, 30), 100);
  assert.equal(sampleTerrainElevation(context, 0, 0, 90), 200);
  assert.equal(sampleTerrainElevation(context, 0, 0, 300), 300);
  assert.equal(sampleTerrainElevation(context, 450, 0, 90), 300);
  const justInsideAuthority = sampleTerrainElevation(
    context,
    199,
    0,
    30,
  );
  const justOutsideAuthority = sampleTerrainElevation(
    context,
    201,
    0,
    30,
  );
  assert.ok(Math.abs(justInsideAuthority - justOutsideAuthority) < 1);
  const justOutsideCoarsest = sampleTerrainElevation(
    context,
    601,
    0,
    1_200,
  );
  const remoteProxy = sampleTerrainElevation(
    context,
    60_600,
    0,
    1_200,
  );
  assert.ok(Math.abs(justOutsideCoarsest - 300) < 1);
  assert.ok(remoteProxy < 1);
});

test("a stone belongs to only one nested clipmap ring", () => {
  assert.equal(pointBelongsToPatchRing(2, 1, 25.6, 0), true);
  assert.equal(pointBelongsToPatchRing(2, 1, 51.2, 25.6), false);
  assert.equal(pointBelongsToPatchRing(14, 1, 51.2, 25.6), true);
  assert.equal(pointBelongsToPatchRing(14, 1, 102.4, 51.2), false);
});

test("matter animation and final stone share one anchored transform", () => {
  const registration = {
    metadata: {
      sampleSpacingArcSeconds: 1,
      bounds: { north: 28, west: 86.9 },
    },
    terrain: {
      blockSize: 0.235,
      xOrigin: -20,
      zOrigin: -20,
    },
    canonicalOriginLatitude: 27.94236111111111,
    canonicalOriginLongitude: 86.89486111111111,
    metersPerDegreeLatitude: 111_320,
    worldUnitsPerMeter: 0.235 / 30,
  };
  const canonicalCell = {
    x: -4_135.5,
    y: 5_268.1,
    z: -6_545.7,
  };
  const firstAnchorCanonical = { x: -4_136, z: -6_546 };
  const secondAnchorCanonical = { x: -4_080, z: -6_480 };
  const firstAnchorWorld = canonicalToWorld(
    registration,
    firstAnchorCanonical.x,
    firstAnchorCanonical.z,
  );
  const secondAnchorWorld = canonicalToWorld(
    registration,
    secondAnchorCanonical.x,
    secondAnchorCanonical.z,
  );
  const scale = canonicalWorldScale(registration);
  const firstPosition = anchoredCanonicalWorldPosition(
    canonicalCell.x,
    canonicalCell.y,
    canonicalCell.z,
    firstAnchorCanonical.x,
    firstAnchorCanonical.z,
    firstAnchorWorld.x,
    firstAnchorWorld.z,
    scale,
  );
  const secondPosition = anchoredCanonicalWorldPosition(
    canonicalCell.x,
    canonicalCell.y,
    canonicalCell.z,
    secondAnchorCanonical.x,
    secondAnchorCanonical.z,
    secondAnchorWorld.x,
    secondAnchorWorld.z,
    scale,
  );
  assert.ok(firstPosition.distanceTo(secondPosition) < 1e-10);
  const roundTrip = worldToCanonical(
    registration,
    firstPosition.x,
    firstPosition.z,
  );
  assert.ok(Math.abs(roundTrip.x - canonicalCell.x) < 1e-9);
  assert.ok(Math.abs(roundTrip.z - canonicalCell.z) < 1e-9);
});

test("clipmap rings assign every horizontal point to one LOD", () => {
  const crossing = clipTerrainCellToRing(2, 2, 2, 4);
  assert.equal(crossing.tops.length, 2);
  assert.equal(crossing.seams.length, 2);
  const topArea = crossing.tops.reduce(
    (area, rectangle) =>
      area +
      (rectangle.maximumX - rectangle.minimumX) *
        (rectangle.maximumZ - rectangle.minimumZ),
    0,
  );
  assert.equal(topArea, 3);
  assert.deepEqual(
    clipTerrainCellToRing(0, 0, 2, 4),
    { tops: [], seams: [] },
  );
});

test("offset clipmap holes preserve exact single ownership", () => {
  const hole = {
    minimumX: -0.25,
    maximumX: 2.75,
    minimumZ: -1.75,
    maximumZ: 1.25,
  };
  const geometry = terrainCellRectangularRingGeometry(
    2,
    0,
    4,
    hole,
    1,
    1.25,
    -0.25,
  );
  assert.ok(geometry);
  const visibleArea = geometry.tops.reduce(
    (area, rectangle) =>
      area +
      (rectangle.maximumX - rectangle.minimumX) *
        (rectangle.maximumZ - rectangle.minimumZ),
    0,
  );
  const overlapWidth = 2.75 - 0;
  const overlapHeight = 1.25 - -1.75;
  assert.equal(visibleArea + overlapWidth * overlapHeight, 16);
  assert.ok(geometry.seams.length > 0);
});

test("ring side walls cannot cross the finer LOD footprint", () => {
  assert.deepEqual(terrainEdgeIntervals(-2, 2, 0, 2), [
    { minimum: -2, maximum: -1 },
    { minimum: 1, maximum: 2 },
  ]);
  assert.deepEqual(terrainEdgeIntervals(-2, 2, 1, 2), [
    { minimum: -2, maximum: 2 },
  ]);
});

test("LOD seam faces always point toward the lower surface", () => {
  assert.equal(terrainSeamNormalSign(1, 20, 10), -1);
  assert.equal(terrainSeamNormalSign(1, 10, 20), 1);
  assert.equal(terrainSeamNormalSign(-1, 20, 10), 1);
  assert.equal(terrainSeamNormalSign(-1, 10, 20), -1);
});

test("overview and activity terrain have exact single-owner coverage", () => {
  const hole = {
    minimumX: 2,
    maximumX: 8,
    minimumZ: 3,
    maximumZ: 7,
  };
  const geometry = clipTerrainRectangleToHole(
    0,
    10,
    0,
    10,
    hole,
  );
  const outerArea = geometry.tops.reduce(
    (area, rectangle) =>
      area +
      (rectangle.maximumX - rectangle.minimumX) *
        (rectangle.maximumZ - rectangle.minimumZ),
    0,
  );
  const activityArea =
    (hole.maximumX - hole.minimumX) *
    (hole.maximumZ - hole.minimumZ);
  assert.equal(outerArea + activityArea, 100);
  assert.equal(geometry.seams.length, 4);

  const intervals: number[] = [];
  assert.equal(
    fillTerrainRectangleEdgeIntervals(
      0,
      10,
      5,
      "z",
      hole,
      intervals,
    ),
    2,
  );
  assert.deepEqual(intervals, [0, 3, 7, 10]);
});

test("progressive activity, context, and background tiers have one owner", () => {
  const activity = {
    minimumX: -20,
    maximumX: 20,
    minimumZ: -20,
    maximumZ: 20,
  };
  const context = {
    minimumX: -60,
    maximumX: 60,
    minimumZ: -60,
    maximumZ: 60,
  };
  const farGeometry = clipTerrainRectangleToHole(
    -100,
    100,
    -100,
    100,
    context,
  );
  const contextGeometry = clipTerrainRectangleToHole(
    context.minimumX,
    context.maximumX,
    context.minimumZ,
    context.maximumZ,
    activity,
  );
  const ownsPoint = (
    rectangles: readonly {
      minimumX: number;
      maximumX: number;
      minimumZ: number;
      maximumZ: number;
    }[],
    x: number,
    z: number,
  ) =>
    rectangles.some(
      (rectangle) =>
        x > rectangle.minimumX &&
        x < rectangle.maximumX &&
        z > rectangle.minimumZ &&
        z < rectangle.maximumZ,
    );

  for (let z = -99.5; z < 100; z += 1) {
    for (let x = -99.5; x < 100; x += 1) {
      const owners = [
        ownsPoint(farGeometry.tops, x, z),
        ownsPoint(contextGeometry.tops, x, z),
        x > activity.minimumX &&
          x < activity.maximumX &&
          z > activity.minimumZ &&
          z < activity.maximumZ,
      ].filter(Boolean).length;
      assert.equal(owners, 1, `expected one terrain owner at ${x}, ${z}`);
    }
  }
});

test("overview transition shares exact bounds and morphs only its edge", () => {
  const sharedActivityBounds = alignedActivityTerrainBounds(
    {
      north: 28.035,
      south: 27.94,
      west: 86.87,
      east: 86.98,
    },
    [
      {
        latitude: 28.1421,
        longitude: 86.8519,
      },
    ],
    0.04,
    3,
  );
  const latitudeArcSeconds =
    (sharedActivityBounds.north -
      sharedActivityBounds.south) *
    3600;
  const longitudeArcSeconds =
    (sharedActivityBounds.east -
      sharedActivityBounds.west) *
    3600;
  assert.ok(
    Math.abs(latitudeArcSeconds / 3 -
      Math.round(latitudeArcSeconds / 3)) < 1e-8,
  );
  assert.ok(
    Math.abs(longitudeArcSeconds / 3 -
      Math.round(longitudeArcSeconds / 3)) < 1e-8,
  );
  assert.equal(
    Math.round(latitudeArcSeconds),
    Math.round(latitudeArcSeconds / 3) * 3,
  );
  assert.equal(
    Math.round(longitudeArcSeconds),
    Math.round(longitudeArcSeconds / 3) * 3,
  );

  assert.deepEqual(
    geographicBoundsToTerrainHole(
      {
        north: 11,
        south: 9,
        west: 19,
        east: 22,
      },
      10,
      20,
      0.5,
    ),
    {
      minimumX: -1_800,
      maximumX: 3_600,
      minimumZ: -1_800,
      maximumZ: 1_800,
    },
  );
  assert.equal(terrainOverviewMorphWeight(0, 12, 100, 80, 24), 1);
  assert.ok(
    terrainOverviewMorphWeight(12, 12, 100, 80, 24) > 0 &&
      terrainOverviewMorphWeight(12, 12, 100, 80, 24) < 1,
  );
  assert.equal(
    terrainOverviewMorphWeight(24, 24, 100, 80, 24),
    0,
  );
  assert.deepEqual(
    terrainOverviewTargetPoint(
      79,
      50,
      100,
      80,
      5,
      7,
      {
        minimumX: 0,
        maximumX: 10,
        minimumZ: 0,
        maximumZ: 8,
      },
      0.01,
    ),
    { x: 5, z: 8.01 },
  );
});

test("every production LOD seam is continuous at fine-cell precision", () => {
  const pairs = TERRAIN_CLIPMAP_LEVELS.slice(0, -1).map(
    (coarse, index) => ({
      coarse,
      fine: TERRAIN_CLIPMAP_LEVELS[index + 1],
    }),
  );
  pairs.forEach(({ coarse, fine }) => {
    const innerHoleM = fine.cellM * fine.gridCells;
    const halfHole = innerHoleM / 2;
    const coarseHalfGrid = Math.floor(coarse.gridCells / 2);
    const segmentsByBoundary = new Map<
      string,
      Array<{ minimum: number; maximum: number }>
    >([
      ["x:-1", []],
      ["x:1", []],
      ["z:-1", []],
      ["z:1", []],
    ]);
    for (let row = 0; row < coarse.gridCells; row += 1) {
      for (
        let column = 0;
        column < coarse.gridCells;
        column += 1
      ) {
        const geometry = clipTerrainCellToRing(
          (column - coarseHalfGrid) * coarse.cellM,
          (row - coarseHalfGrid) * coarse.cellM,
          coarse.cellM,
          innerHoleM,
        );
        geometry.seams.forEach((seam) => {
          assert.ok(
            Math.abs(seam.coordinate - seam.side * halfHole) < 1e-9,
          );
          segmentsByBoundary
            .get(`${seam.axis}:${seam.side}`)!
            .push(
              ...subdivideTerrainSeam(
                seam.minimum,
                seam.maximum,
                fine.cellM,
              ),
            );
        });
      }
    }
    segmentsByBoundary.forEach((segments, boundary) => {
      segments.sort(
        (left, right) => left.minimum - right.minimum,
      );
      assert.ok(
        segments.length > 0,
        `${coarse.cellM}/${fine.cellM} ${boundary} is empty`,
      );
      assert.ok(
        Math.abs(segments[0].minimum + halfHole) < 1e-9,
      );
      assert.ok(
        Math.abs(segments[segments.length - 1].maximum - halfHole) <
          1e-9,
      );
      segments.forEach((segment, index) => {
        assert.ok(
          segment.maximum - segment.minimum <= fine.cellM + 1e-9,
        );
        if (index > 0) {
          assert.ok(
            Math.abs(
              segments[index - 1].maximum - segment.minimum,
            ) < 1e-9,
          );
        }
      });
    });
  });
});

test("streamed stone instances do not move when a patch recenters", async () => {
  const width = 32;
  const height = 32;
  const blockSize = 0.235;
  const registration = {
    metadata: {
      sampleSpacingArcSeconds: 1,
      width,
      height,
      bounds: {
        north: 27.94236111111111,
        south: 27.93347222222222,
        west: 86.89486111111111,
        east: 86.90375,
      },
    },
    elevations: new Int16Array(width * height).fill(5_260),
    terrain: {
      blockSize,
      xOrigin: 0,
      zOrigin: 0,
    },
    canonicalOriginLatitude: 27.94236111111111,
    canonicalOriginLongitude: 86.89486111111111,
    metersPerDegreeLatitude: 111_320,
    worldUnitsPerMeter: blockSize / 30,
  };
  const tile: ObservatorySurfaceTile = {
    schemaVersion: "1.1.0",
    id: "0:0",
    x: 0,
    z: 0,
    hash: "stable-stone-tile",
    chunks: [
      {
        id: "0:0",
        x: 0,
        z: 0,
        hash: "stable-stone-chunk",
        removedTerrainVoxels: [],
        stones: [{ id: "stable-stone", cell: { x: 2, y: 5, z: 3 } }],
      },
    ],
  };
  const feed = {
    schemaVersion: "1.4.0",
    sequence: 1,
    worldHash: "stable-stone-world",
    summitHeightM: 8_848.86,
    surfaceTiles: {
      voxelEdgeM: 0.2,
      physicsChunkEdgeM: 32,
      tileEdgeM: 256,
      verticalDatumM: 5_259,
      tiles: [
        {
          id: tile.id,
          x: tile.x,
          z: tile.z,
          hash: tile.hash,
          path: `tiles/${tile.hash}.json`,
          chunkCount: 1,
          removedTerrainVoxelCount: 0,
          stoneCount: 1,
          lodSummary: [],
        },
      ],
    },
    recentExpeditions: [],
    leaderboard: [],
  } satisfies ObservatoryFeed;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) =>
    String(input).endsWith(`${tile.hash}.json`)
      ? new Response(JSON.stringify(tile), {
          headers: { "content-type": "application/json" },
        })
      : new Response(null, { status: 404 });
  const engine = new TerrainStreamingEngine(registration, feed);
  try {
    const centers = [
      canonicalToWorld(registration, 0.5, 0.7),
      canonicalToWorld(registration, 2.5, 2.7),
    ];
    const positions: THREE.Vector3[] = [];
    for (const [index, center] of centers.entries()) {
      const patch = await engine.createPatch({
        key: `stable-${index}`,
        centerWorldX: center.x,
        centerWorldZ: center.z,
        cellM: 0.8,
        gridCells: 17,
        innerHoleM: 0,
        innerCellM: 0,
        sealOuterBoundary: false,
        terrainTint: "#fff4e7",
        fogDensity: 0.007,
        atmosphere: {
          top: "#31586f",
          middle: "#6c91a4",
          horizon: "#66869a",
          nadir: "#273033",
        },
      });
      const stoneMesh = patch.group.children.find(
        (child) => child instanceof THREE.InstancedMesh,
      ) as THREE.InstancedMesh | undefined;
      assert.ok(stoneMesh);
      const matrix = new THREE.Matrix4();
      stoneMesh.getMatrixAt(0, matrix);
      positions.push(new THREE.Vector3().setFromMatrixPosition(matrix));
      patch.dispose();
    }
    assert.ok(positions[0].distanceTo(positions[1]) < 1e-10);
  } finally {
    engine.dispose();
    globalThis.fetch = originalFetch;
  }
});

test("terrain mesher emits a single-owner sealed clipmap ring", () => {
  const width = 12;
  const height = 12;
  const elevations = new Int16Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      elevations[row * width + column] =
        7_000 + row * 4 + column * 2;
    }
  }
  const blockSize = 0.235;
  const result = buildTerrainMesh(
    {
      metadata: {
        sampleSpacingArcSeconds: 1,
        width,
        height,
        bounds: {
          north: 28,
          south: 27.996666666666666,
          west: 86.9,
          east: 86.903333333333336,
        },
      },
      elevations,
      terrain: {
        blockSize,
        xOrigin: 0,
        zOrigin: 0,
      },
      canonicalOriginLatitude: 27.94236111111111,
      canonicalOriginLongitude: 86.89486111111111,
      metersPerDegreeLatitude: 111_320,
      worldUnitsPerMeter: blockSize / 30,
    },
    {
      centerWorldX: blockSize * 6,
      centerWorldZ: blockSize * 6,
      innerCenterWorldX: blockSize * 6 + 0.002,
      innerCenterWorldZ: blockSize * 6 - 0.001,
      cellM: 0.8,
      gridCells: 17,
      innerHoleM: 4,
      innerCellM: 0.4,
      sealOuterBoundary: true,
      terrainTint: "#fff4e7",
      delta: {
        voxelEdgeM: 0.2,
        verticalDatumM: 5_259,
        chunks: [],
      },
    },
  );

  assert.ok(result.renderedTopCount > 0);
  assert.equal(result.positions.length, result.colors.length);
  assert.ok(result.indices.length > 0);
  assert.ok(result.colors instanceof Uint8Array);
  const scale = canonicalWorldScale({
    metadata: {
      sampleSpacingArcSeconds: 1,
      bounds: { north: 28, west: 86.9 },
    },
    terrain: {
      blockSize,
      xOrigin: 0,
      zOrigin: 0,
    },
    canonicalOriginLatitude: 27.94236111111111,
    canonicalOriginLongitude: 86.89486111111111,
    metersPerDegreeLatitude: 111_320,
    worldUnitsPerMeter: blockSize / 30,
  });
  const expectedMinimumX =
    blockSize * 6 -
    (8 * 0.8 + 0.4) * scale.x;
  let hasOuterBoundarySkirt = false;
  for (
    let faceIndex = 0;
    faceIndex < result.positions.length / 12;
    faceIndex += 1
  ) {
    const positionOffset = faceIndex * 12;
    const y0 = result.positions[positionOffset + 1];
    const isVertical = [1, 2, 3].some(
      (vertex) =>
        Math.abs(
          result.positions[positionOffset + vertex * 3 + 1] - y0,
        ) > 0.000_001,
    );
    if (!isVertical) continue;
    const liesOnMinimumX = [0, 1, 2, 3].every(
      (vertex) =>
        Math.abs(
          result.positions[positionOffset + vertex * 3] -
            expectedMinimumX,
        ) < 0.000_001,
    );
    hasOuterBoundarySkirt ||= liesOnMinimumX;
  }
  assert.equal(hasOuterBoundarySkirt, true);
  assert.ok(
    result.positions.every((value) => Number.isFinite(value)) &&
      result.colors.every((value) => Number.isFinite(value)),
  );
});

test("surface tile eviction releases its collision index", async () => {
  const payloads = new Map<string, ObservatorySurfaceTile>();
  const tiles = Array.from({ length: 50 }, (_, x) => {
    const hash = `tile-${x}`;
    const payload: ObservatorySurfaceTile = {
      schemaVersion: "1.1.0",
      id: `${x}:0`,
      x,
      z: 0,
      hash,
      chunks: [
        {
          id: `${x * 8}:0`,
          x: x * 8,
          z: 0,
          hash: `chunk-${x}`,
          removedTerrainVoxels: [{ x: x * 1_280, y: 1, z: 0 }],
          stones: [
            {
              id: `stone-${x}`,
              cell: { x: x * 1_280, y: 2, z: 0 },
            },
          ],
        },
      ],
    };
    payloads.set(`/data/world/tiles/${hash}.json`, payload);
    return {
      id: payload.id,
      x,
      z: 0,
      hash,
      path: `tiles/${hash}.json`,
      chunkCount: 1,
      removedTerrainVoxelCount: 1,
      stoneCount: 1,
      lodSummary: [],
    };
  });
  const feed = {
    schemaVersion: "1.4.0",
    sequence: 1,
    worldHash: "tile-eviction-test",
    summitHeightM: 8_848.86,
    surfaceTiles: {
      voxelEdgeM: 0.2,
      physicsChunkEdgeM: 32,
      tileEdgeM: 256,
      verticalDatumM: 5_259,
      tiles,
    },
    recentExpeditions: [],
    leaderboard: [],
  } satisfies ObservatoryFeed;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const payload = payloads.get(String(input));
    if (!payload) return new Response(null, { status: 404 });
    return new Response(JSON.stringify(payload), {
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const store = new SurfaceTileStore(feed);
    await store.chunksInBounds({
      minimumX: 0,
      maximumX: 50 * 256 - 1,
      minimumZ: 0,
      maximumZ: 255,
    });
    assert.equal(store.stats().residentTiles, 48);
    assert.equal(store.removedLevels(0, 0), undefined);
    assert.equal(
      store.highestStoneLevel(0, 0, new Set()),
      undefined,
    );
    assert.ok(store.removedLevels(49 * 1_280, 0)?.has(1));
    assert.equal(
      store.highestStoneLevel(49 * 1_280, 0, new Set()),
      2,
    );
    assert.equal(
      store.highestStoneLevel(
        49 * 1_280,
        0,
        new Set(["stone-49"]),
      ),
      undefined,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
