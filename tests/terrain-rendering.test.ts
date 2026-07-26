import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import type {
  ObservatoryFeed,
  ObservatorySurfaceTile,
} from "../lib/world";
import { ScreenSpaceLodSelector } from "../app/everest/terrain-runtime";
import {
  buildTerrainMesh,
  clipTerrainCellToRing,
} from "../app/everest/terrain-mesher";
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
        west: 86.89486111111111,
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
        bounds: { north: 28, west: 86.9 },
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
