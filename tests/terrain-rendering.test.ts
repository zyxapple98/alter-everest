import assert from "node:assert/strict";
import test from "node:test";
import type {
  ObservatoryFeed,
  ObservatorySurfaceTile,
} from "../lib/world";
import { ScreenSpaceLodSelector } from "../app/everest/terrain-runtime";
import { buildTerrainMesh } from "../app/everest/terrain-mesher";
import { SurfaceTileStore } from "../app/everest/surface-tile-store";

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

test("terrain mesher emits an opaque-backed transition without invalid data", () => {
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
      innerOverlapM: 1.6,
      outerTransitionM: 3.2,
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
  assert.equal(result.positions.length / 3, result.visibility.length);
  assert.ok(result.indices.length > 0);
  assert.ok(result.visibility.some((value) => value > 0 && value < 255));
  assert.ok(result.colors instanceof Uint8Array);
  assert.ok(result.visibility instanceof Uint8Array);
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
      schemaVersion: "1.0.0",
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
          stones: [],
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
      stoneCount: 0,
      lodSummary: [],
    };
  });
  const feed = {
    schemaVersion: "1.3.0",
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
    assert.ok(store.removedLevels(49 * 1_280, 0)?.has(1));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
