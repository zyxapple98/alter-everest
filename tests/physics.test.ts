import assert from "node:assert/strict";
import test from "node:test";
import { validateCandidateCommit } from "../engine/commit";
import { validateRouteClearance } from "../engine/clearance";
import { CLIMBER, PHYSICS } from "../engine/constants";
import {
  isInsideBaseCamp,
  isInsideSpawnCore,
} from "../engine/mutation";
import {
  simulateMutation,
  validateStaticServiceLoadCases,
  validateStaticServiceLoads,
} from "../engine/physics";
import { validateRoute } from "../engine/route";
import { syntheticReliefM } from "../engine/surface";
import {
  validateRouteTerrain,
  type TerrainOracle,
} from "../engine/terrain";
import type {
  CanonicalWorld,
  ExpeditionProof,
  MatterMutation,
  PhysicsSnapshot,
  RouteSample,
  StoneState,
  VoxelCoordinate,
} from "../engine/types";

const terrain: TerrainOracle = {
  sample(x, z) {
    const y = -syntheticReliefM(x, z);
    return {
      y,
      altitudeM: 5_350 + y,
      slopeDegrees: 0,
      surface: "ROCK",
    };
  },
};

function stone(
  id: string,
  x: number,
  y: number,
  z: number,
): StoneState {
  return { id, cell: { x, y, z } };
}

function importStone(
  id: string,
  cell: VoxelCoordinate,
): MatterMutation {
  return {
    kind: "RELOCATE",
    matterId: id,
    source: { kind: "BASE" },
    destination: { kind: "WORLD", cell },
  };
}

function snapshot(
  stones: StoneState[] = [],
  removedTerrainVoxels: VoxelCoordinate[] = [],
): PhysicsSnapshot {
  return {
    worldHash: "world-head",
    stones,
    removedTerrainVoxels,
  };
}

function canonicalWorld(stones: StoneState[] = []): CanonicalWorld {
  return {
    ...snapshot(stones),
    sequence: 0,
    terrainHash: "terrain-head",
    baseCamp: { x: -160, y: 0, z: 0 },
    extractionZones: [],
    modifiedChunks: [],
    modifiedTiles: [],
    identities: [],
    tombstones: [],
    expeditions: [],
  };
}

function routeSample(
  x: number,
  y = 0,
  safeStop = false,
): RouteSample {
  return {
    x,
    y,
    z: 0,
    altitudeM: 5_350 + y,
    slopeDegrees: 0,
    surface: "ROCK",
    mode: "WALK",
    safeStop,
  };
}

test("a grounded cell placement is accepted at its exact cell", async () => {
  const result = await simulateMutation(
    snapshot(),
    importStone("stone-1", { x: 0, y: 1, z: 0 }),
    { terrain },
  );

  assert.equal(result.valid, true);
  assert.equal(result.code, "STABLE");
  assert.equal(result.contactModel, "VOXEL_STATIC_V2_1");
  assert.deepEqual(result.finalStones, [
    stone("stone-1", 0, 1, 0),
  ]);
});

test("a floating cell is rejected atomically", async () => {
  const before = snapshot();
  const result = await simulateMutation(
    before,
    importStone("floating", { x: 0, y: 3, z: 0 }),
    { terrain },
  );

  assert.equal(result.valid, false);
  assert.equal(result.code, "DESTINATION_HAS_NO_FACE_CONTACT");
  assert.deepEqual(result.finalStones, before.stones);
});

test("face-connected stacks hold while edge-only contact does not", async () => {
  const base = stone("base", 0, 1, 0);
  const stacked = await simulateMutation(
    snapshot([base]),
    importStone("top", { x: 0, y: 2, z: 0 }),
    { terrain },
  );
  assert.equal(stacked.valid, true);

  const diagonal = await simulateMutation(
    snapshot([base]),
    importStone("edge", { x: 1, y: 2, z: 0 }),
    { terrain },
  );
  assert.equal(diagonal.valid, false);
  assert.equal(diagonal.code, "DESTINATION_HAS_NO_FACE_CONTACT");
});

test("a balanced nine-cell bridge span is supported", async () => {
  const stones = [
    stone("left-foot", 0, 1, 0),
    stone("right-foot", 8, 1, 0),
    ...Array.from({ length: 8 }, (_, x) =>
      stone(`deck-${x}`, x, 2, 0),
    ),
  ];
  const result = await simulateMutation(
    snapshot(stones),
    importStone("deck-8", { x: 8, y: 2, z: 0 }),
    { terrain },
  );

  assert.equal(result.valid, true, result.code);
});

test("horizontal reach is capped before a long cantilever can exist", async () => {
  const stones = [
    stone("foot", 0, 1, 0),
    ...Array.from({ length: 5 }, (_, x) =>
      stone(`arm-${x}`, x, 2, 0),
    ),
  ];
  const result = await simulateMutation(
    snapshot(stones),
    importStone("too-far", { x: 5, y: 2, z: 0 }),
    { terrain },
  );

  assert.equal(result.valid, false);
  assert.equal(result.code, "STONE_SPAN_EXCEEDED");
});

test("an eccentric but short cantilever fails the COM test", async () => {
  const result = await simulateMutation(
    snapshot([
      stone("foot", 0, 1, 0),
      stone("arm-0", 0, 2, 0),
      stone("arm-1", 1, 2, 0),
    ]),
    importStone("arm-2", { x: 2, y: 2, z: 0 }),
    { terrain },
  );

  assert.equal(result.valid, false);
  assert.equal(result.code, "STONE_IMBALANCED");
});

test("removing the only support rejects the whole mutation", async () => {
  const before = snapshot([
    stone("foot", 0, 1, 0),
    stone("top", 0, 2, 0),
  ]);
  const result = await simulateMutation(
    before,
    {
      kind: "RELOCATE",
      matterId: "foot",
      source: { kind: "STONE", stoneId: "foot" },
      destination: {
        kind: "WORLD",
        cell: { x: 4, y: 1, z: 0 },
      },
    },
    { terrain },
  );

  assert.equal(result.valid, false);
  assert.equal(result.code, "STONE_UNANCHORED");
  assert.deepEqual(result.finalStones, before.stones);
});

test("a one-cell tower is limited to ten cells of slenderness", async () => {
  const tower = Array.from({ length: 10 }, (_, index) =>
    stone(`tower-${index}`, 0, index + 1, 0),
  );
  const result = await simulateMutation(
    snapshot(tower),
    importStone("tower-10", { x: 0, y: 11, z: 0 }),
    { terrain },
  );

  assert.equal(result.valid, false);
  assert.equal(result.code, "STONE_LATERAL_OVERTURNING");
});

test("service loading checks a climber against the same static component", () => {
  const world = snapshot([stone("deck", 0, 1, 0)]);
  const ordinary = validateStaticServiceLoads(
    world,
    [
      {
        supportCell: { x: 0, y: 1, z: 0 },
        stoneWeightEquivalent:
          CLIMBER.bodyMassKg / PHYSICS.stoneMassKg,
      },
    ],
    terrain,
  );
  assert.equal(ordinary.valid, true);

  const overload = validateStaticServiceLoads(
    world,
    [
      {
        supportCell: { x: 0, y: 1, z: 0 },
        stoneWeightEquivalent: PHYSICS.maximumLoadPerAnchorCell,
      },
    ],
    terrain,
  );
  assert.equal(overload.valid, false);
  assert.equal(overload.code, "STONE_COMPRESSION_EXCEEDED");
});

test("route service-load cases are alternatives, not simultaneous climbers", () => {
  const world = snapshot([stone("deck", 0, 1, 0)]);
  const result = validateStaticServiceLoadCases(
    world,
    [
      {
        supportCell: { x: 0, y: 1, z: 0 },
        stoneWeightEquivalent: 3_000,
      },
      {
        supportCell: { x: 0, y: 1, z: 0 },
        stoneWeightEquivalent: 3_000,
      },
    ],
    terrain,
  );

  assert.equal(result.valid, true);
});

test("affected components have a hard 10,000-cell bound", async () => {
  const stones = Array.from({ length: 10_000 }, (_, index) =>
    stone(
      `plate-${index}`,
      index % 100,
      1,
      Math.floor(index / 100),
    ),
  );
  const result = await simulateMutation(
    snapshot(stones),
    importStone("plate-extra", { x: 100, y: 1, z: 99 }),
    { terrain },
  );

  assert.equal(result.valid, false);
  assert.equal(result.code, "AFFECTED_STONES_TOO_LARGE");
});

test("a mutation cannot force revalidation across nine physics chunks", async () => {
  const stones = Array.from({ length: 1_280 }, (_, x) =>
    stone(`row-${x}`, x, 1, 0),
  );
  const result = await simulateMutation(
    snapshot(stones),
    importStone("ninth-chunk", { x: 1_280, y: 1, z: 0 }),
    { terrain },
  );

  assert.equal(result.valid, false);
  assert.equal(result.code, "TOO_MANY_CHUNKS_TOUCHED");
});

test("surface quarrying and inward face advance make tunnels possible", async () => {
  const first = await simulateMutation(
    snapshot(),
    {
      kind: "RELOCATE",
      matterId: "terrain-0",
      source: {
        kind: "TERRAIN",
        voxel: { x: 0, y: 0, z: 0 },
      },
      destination: { kind: "BASE" },
    },
    { terrain },
  );
  assert.equal(first.valid, true);

  const second = await simulateMutation(
    snapshot([], [{ x: 0, y: 0, z: 0 }]),
    {
      kind: "RELOCATE",
      matterId: "terrain-1",
      source: {
        kind: "TERRAIN",
        voxel: { x: 0, y: -1, z: 0 },
      },
      destination: { kind: "BASE" },
    },
    { terrain },
  );
  assert.equal(second.valid, true);
});

test("a sealed terrain voxel cannot be quarried remotely", async () => {
  const result = await simulateMutation(
    snapshot(),
    {
      kind: "RELOCATE",
      matterId: "sealed",
      source: {
        kind: "TERRAIN",
        voxel: { x: 0, y: -1, z: 0 },
      },
      destination: { kind: "BASE" },
    },
    { terrain },
  );

  assert.equal(result.valid, false);
  assert.equal(result.code, "TERRAIN_VOXEL_NOT_EXPOSED");
});

test("a shallow horizontal tunnel is rejected for thin roof", async () => {
  const result = await simulateMutation(
    snapshot([], [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: -1, z: 0 },
    ]),
    {
      kind: "RELOCATE",
      matterId: "thin-roof",
      source: {
        kind: "TERRAIN",
        voxel: { x: 1, y: -1, z: 0 },
      },
      destination: { kind: "BASE" },
    },
    { terrain },
  );

  assert.equal(result.valid, false);
  assert.equal(result.code, "TUNNEL_ROOF_TOO_THIN");
});

test("a tunnel two cells below the surface has enough roof", async () => {
  const result = await simulateMutation(
    snapshot([], [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: -1, z: 0 },
      { x: 0, y: -2, z: 0 },
    ]),
    {
      kind: "RELOCATE",
      matterId: "deep-enough",
      source: {
        kind: "TERRAIN",
        voxel: { x: 1, y: -2, z: 0 },
      },
      destination: { kind: "BASE" },
    },
    { terrain },
  );

  assert.equal(result.valid, true, result.code);
});

test("an excavated route needs human-width and human-height clearance", () => {
  const bodyCells = [-10, -9, -8, -7, -6, -5, -4, -3, -2];
  const centreAir = bodyCells.map((y) => ({ x: 0, y, z: 0 }));
  const broadAir = [
    ...centreAir,
    ...bodyCells.flatMap((y) => [
      { x: 1, y, z: 0 },
      { x: -1, y, z: 0 },
      { x: 0, y, z: 1 },
      { x: 0, y, z: -1 },
    ]),
  ];
  const underground = routeSample(0.1, -2);

  const narrow = validateRouteTerrain(
    [underground],
    terrain,
    snapshot([], centreAir),
  );
  assert.equal(narrow.valid, false);
  assert.equal(narrow.code, "TERRAIN_MISMATCH");

  const clear = validateRouteTerrain(
    [underground],
    terrain,
    snapshot([], broadAir),
  );
  assert.equal(clear.valid, true);
});

test("moving a stone to its current cell is a no-op", async () => {
  const existing = stone("same", 0, 1, 0);
  const result = await simulateMutation(
    snapshot([existing]),
    {
      kind: "RELOCATE",
      matterId: existing.id,
      source: { kind: "STONE", stoneId: existing.id },
      destination: { kind: "WORLD", cell: existing.cell },
    },
    { terrain },
  );
  assert.equal(result.valid, false);
  assert.equal(result.code, "NO_STATE_CHANGE");
});

test("route clearance blocks stone sides but permits walking on their tops", async () => {
  const world = snapshot([stone("step", 2, 1, 0)]);
  const blocked = await validateRouteClearance(world, [
    routeSample(0, 0.2),
    routeSample(0.7, 0.2),
  ]);
  assert.equal(blocked.clear, false);
  assert.equal(blocked.stoneId, "step");

  const top = await validateRouteClearance(world, [
    routeSample(0.1, 0.4),
    routeSample(0.9, 0.4),
  ]);
  assert.equal(top.clear, true);
});

test("Base Camp and Spawn Core are horizontal cylinders", () => {
  const world = { baseCamp: { x: -160, y: 0, z: 0 } };

  assert.equal(
    isInsideBaseCamp({ x: -160, y: 10_000, z: 0 }, world),
    true,
  );
  assert.equal(
    isInsideSpawnCore({ x: -160, y: 10_000, z: 0 }, world),
    true,
  );
  assert.equal(
    isInsideBaseCamp(
      {
        x: world.baseCamp.x + CLIMBER.baseCampRadiusM + 0.01,
        y: world.baseCamp.y,
        z: world.baseCamp.z,
      },
      world,
    ),
    false,
  );
});

test("return status is inferred from the terminal position", () => {
  const oneWayProof: ExpeditionProof = {
    route: [
      routeSample(-160),
      routeSample(-120),
      routeSample(-80),
      routeSample(-40),
      routeSample(0, 0, true),
    ],
    actions: [
      {
        ...importStone("stone-1", { x: 0, y: 1, z: 0 }),
        pickupIndex: 0,
        releaseIndex: 4,
      },
    ],
  };
  const oneWay = validateRoute(oneWayProof, {
    x: -160,
    y: 0,
    z: 0,
  });
  assert.equal(oneWay.valid, true);
  assert.equal(oneWay.outcome, "DEAD");

  const returnedProof: ExpeditionProof = {
    ...oneWayProof,
    route: [
      ...oneWayProof.route.map((sample) => ({
        ...sample,
        safeStop: undefined,
      })),
      routeSample(-40),
      routeSample(-80),
      routeSample(-120),
      routeSample(-160, 0, true),
    ],
  };
  const returned = validateRoute(returnedProof, {
    x: -160,
    y: 0,
    z: 0,
  });
  assert.equal(returned.valid, true);
  assert.equal(returned.outcome, "ACTIVE");
});

test("one expedition has one departure, one Base withdrawal, and no redeparture", () => {
  const baseCamp = { x: -160, y: 0, z: 0 };
  const neverDeparted = validateRoute(
    {
      route: [
        routeSample(-160),
        routeSample(-120, 0, true),
      ],
      actions: [
        {
          ...importStone("never-left", { x: 0, y: 1, z: 0 }),
          pickupIndex: 0,
          releaseIndex: 1,
        },
      ],
    },
    baseCamp,
  );
  assert.equal(neverDeparted.code, "ROUTE_NEVER_LEFT_BASE");

  const ordinaryRoute = [
    routeSample(-160),
    routeSample(-120),
    routeSample(-80),
    routeSample(-40),
    routeSample(0),
    routeSample(-40, 0, true),
  ];
  const repeatedWithdrawal = validateRoute(
    {
      route: ordinaryRoute,
      actions: [
        {
          ...importStone("supply-1", { x: 0, y: 1, z: 4 }),
          pickupIndex: 0,
          releaseIndex: 1,
        },
        {
          ...importStone("supply-2", { x: 0, y: 1, z: 5 }),
          pickupIndex: 1,
          releaseIndex: 4,
        },
      ],
    },
    baseCamp,
  );
  assert.equal(
    repeatedWithdrawal.code,
    "BASE_WITHDRAWAL_LIMIT_EXCEEDED",
  );

  const redeparture = validateRoute(
    {
      route: [
        ...ordinaryRoute.map((sample) => ({
          ...sample,
          safeStop: undefined,
        })),
        routeSample(0, 0, true),
      ],
      actions: [
        {
          ...importStone("supply-1", { x: 0, y: 1, z: 4 }),
          pickupIndex: 0,
          releaseIndex: 4,
        },
      ],
    },
    baseCamp,
  );
  assert.equal(redeparture.code, "BASE_REDEPARTURE_FORBIDDEN");

  const boundaryGraze = validateRoute(
    {
      route: [
        routeSample(-160),
        routeSample(-120),
        routeSample(-80),
        routeSample(-40),
        { ...routeSample(-21), z: -20 },
        { ...routeSample(-21, 0, true), z: 20 },
      ],
      actions: [
        {
          ...importStone("graze", { x: -105, y: 1, z: -100 }),
          pickupIndex: 0,
          releaseIndex: 4,
        },
      ],
    },
    baseCamp,
  );
  assert.equal(boundaryGraze.code, "BASE_REDEPARTURE_FORBIDDEN");

  const actionAfterReturn = validateRoute(
    {
      route: [
        ...ordinaryRoute.map((sample) => ({
          ...sample,
          safeStop: undefined,
        })),
        routeSample(-80, 0, true),
      ],
      actions: [
        {
          ...importStone("return-phase", { x: 0, y: 1, z: 4 }),
          pickupIndex: 0,
          releaseIndex: 4,
        },
        {
          kind: "RELOCATE",
          matterId: "return-phase",
          source: {
            kind: "STONE",
            stoneId: "return-phase",
          },
          destination: { kind: "BASE" },
          pickupIndex: 5,
          releaseIndex: 6,
        },
      ],
    },
    baseCamp,
  );
  assert.equal(actionAfterReturn.code, "ACTION_AFTER_BASE_RETURN");

  const worldReleaseAfterReturn = validateRoute(
    {
      route: ordinaryRoute,
      actions: [
        {
          kind: "RELOCATE",
          matterId: "carried-home",
          source: {
            kind: "STONE",
            stoneId: "carried-home",
          },
          destination: {
            kind: "WORLD",
            cell: { x: -200, y: 1, z: 0 },
          },
          pickupIndex: 4,
          releaseIndex: 5,
        },
      ],
    },
    baseCamp,
  );
  assert.equal(
    worldReleaseAfterReturn.code,
    "ACTION_AFTER_BASE_RETURN",
  );

  const lateWithdrawal = validateRoute(
    {
      route: [
        ...ordinaryRoute.map((sample) => ({
          ...sample,
          safeStop: undefined,
        })),
        routeSample(-80, 0, true),
      ],
      actions: [
        {
          ...importStone("late-supply", { x: 0, y: 1, z: 4 }),
          pickupIndex: 5,
          releaseIndex: 6,
        },
      ],
    },
    baseCamp,
  );
  assert.equal(lateWithdrawal.code, "BASE_PICKUP_AFTER_DEPARTURE");
});

test("one expedition can place a stable structure while carrying one stone at a time", async () => {
  const world = canonicalWorld([
    stone("course-1", 0, 1, 4),
    stone("course-3", 5, 1, 4),
  ]);
  const route = [
    routeSample(-160),
    routeSample(-120),
    routeSample(-80),
    routeSample(-40),
    routeSample(0),
    routeSample(1),
    routeSample(0),
    routeSample(-40),
    routeSample(-80),
    routeSample(-120),
    routeSample(-160, 0, true),
  ];
  const proof: ExpeditionProof = {
    route,
    actions: [
      {
        ...importStone("course-2", { x: 0, y: 2, z: 4 }),
        pickupIndex: 0,
        releaseIndex: 4,
      },
      {
        kind: "RELOCATE",
        matterId: "course-3",
        source: { kind: "STONE", stoneId: "course-3" },
        destination: {
          kind: "WORLD",
          cell: { x: 0, y: 3, z: 4 },
        },
        pickupIndex: 5,
        releaseIndex: 6,
      },
    ],
  };
  const result = await validateCandidateCommit(
    {
      protocol: "0.6.0",
      id: "two-course-structure",
      parentWorldHash: world.worldHash,
      terrainHash: world.terrainHash,
      agentId: "builder",
      proof,
    },
    world,
    { baseCamp: world.baseCamp, terrain },
  );

  assert.equal(result.accepted, true, JSON.stringify(result, null, 2));
  assert.deepEqual(
    result.physics?.finalStones.map((entry) => entry.id).sort(),
    ["course-1", "course-2", "course-3"],
  );
  assert.ok((result.route?.loadedDistanceM ?? 0) > 0);
});

test("recovery releases matter at an explicit Base Camp route sample", async () => {
  const world = canonicalWorld([
    stone("return-me", 0, 1, 5),
  ]);
  const route = [
    routeSample(-160),
    routeSample(-120),
    routeSample(-80),
    routeSample(-40),
    routeSample(0),
    routeSample(0),
    routeSample(-40),
    routeSample(-80),
    routeSample(-120),
    routeSample(-160, 0, true),
  ];
  const action: ExpeditionProof["actions"][number] = {
    kind: "RELOCATE",
    matterId: "return-me",
    source: { kind: "STONE", stoneId: "return-me" },
    destination: { kind: "BASE" },
    pickupIndex: 4,
    releaseIndex: 9,
  };
  const accepted = await validateCandidateCommit(
    {
      protocol: "0.6.0",
      id: "explicit-base-release",
      parentWorldHash: world.worldHash,
      terrainHash: world.terrainHash,
      agentId: "steward",
      proof: { route, actions: [action] },
    },
    world,
    { baseCamp: world.baseCamp, terrain },
  );
  assert.equal(accepted.accepted, true, JSON.stringify(accepted, null, 2));
  assert.deepEqual(accepted.physics?.finalStones, []);

  const outsideCamp = await validateCandidateCommit(
    {
      protocol: "0.6.0",
      id: "remote-base-release",
      parentWorldHash: world.worldHash,
      terrainHash: world.terrainHash,
      agentId: "steward",
      proof: {
        route,
        actions: [{ ...action, releaseIndex: 5 }],
      },
    },
    world,
    { baseCamp: world.baseCamp, terrain },
  );
  assert.equal(outsideCamp.accepted, false);
  assert.equal(outsideCamp.route?.code, "BASE_RELEASE_OUTSIDE_CAMP");
});

test("a multi-action expedition with no net world change is rejected", async () => {
  const world = canonicalWorld();
  const route = [
    routeSample(-160),
    routeSample(-120),
    routeSample(-80),
    routeSample(-40),
    routeSample(0),
    routeSample(-40),
    routeSample(-80),
    routeSample(-120),
    routeSample(-160, 0, true),
  ];
  const result = await validateCandidateCommit(
    {
      protocol: "0.6.0",
      id: "multi-noop",
      parentWorldHash: world.worldHash,
      terrainHash: world.terrainHash,
      agentId: "builder",
      proof: {
        route,
        actions: [
          {
            ...importStone("roundtrip-stone", { x: 0, y: 1, z: 5 }),
            pickupIndex: 0,
            releaseIndex: 4,
          },
          {
            kind: "RELOCATE",
            matterId: "roundtrip-stone",
            source: {
              kind: "STONE",
              stoneId: "roundtrip-stone",
            },
            destination: { kind: "BASE" },
            pickupIndex: 4,
            releaseIndex: 8,
          },
        ],
      },
    },
    world,
    { baseCamp: world.baseCamp, terrain },
  );
  assert.equal(result.accepted, false);
  assert.equal(result.physics?.code, "NO_STATE_CHANGE");
});

test("overlapping carry intervals and a failing later action reject the expedition atomically", async () => {
  const world = canonicalWorld([
    stone("movable-second", 5, 1, 4),
  ]);
  const route = [
    routeSample(-160),
    routeSample(-120),
    routeSample(-80),
    routeSample(-40),
    routeSample(0),
    routeSample(1),
    routeSample(0),
    routeSample(-40),
    routeSample(-80),
    routeSample(-120),
    routeSample(-160, 0, true),
  ];
  const actions: ExpeditionProof["actions"] = [
    {
      ...importStone("stable-first", { x: 0, y: 1, z: 4 }),
      pickupIndex: 0,
      releaseIndex: 4,
    },
    {
      kind: "RELOCATE",
      matterId: "movable-second",
      source: { kind: "STONE", stoneId: "movable-second" },
      destination: {
        kind: "WORLD",
        cell: { x: 0, y: 4, z: 0 },
      },
      pickupIndex: 5,
      releaseIndex: 6,
    },
  ];
  const overlapping = validateRoute(
    {
      route,
      actions: [
        actions[0],
        { ...actions[1], pickupIndex: 3 },
      ],
    },
    world.baseCamp,
  );
  assert.equal(overlapping.valid, false);
  assert.equal(overlapping.code, "ACTION_INDEX_INVALID");

  const result = await validateCandidateCommit(
    {
      protocol: "0.6.0",
      id: "atomic-multi-failure",
      parentWorldHash: world.worldHash,
      terrainHash: world.terrainHash,
      agentId: "builder",
      proof: { route, actions },
    },
    world,
    { baseCamp: world.baseCamp, terrain },
  );
  assert.equal(result.accepted, false);
  assert.equal(result.code, "PHYSICS_INVALID");
  assert.equal(result.physics?.code, "DESTINATION_HAS_NO_FACE_CONTACT");
  assert.deepEqual(world.stones, [
    stone("movable-second", 5, 1, 4),
  ]);
});

test("a stale candidate is replayed against HEAD when still valid", async () => {
  const world: CanonicalWorld = {
    ...canonicalWorld(),
    worldHash: "new-head",
    identities: [{ id: "agent-7", status: "ACTIVE" }],
  };
  const proof: ExpeditionProof = {
    route: [
      routeSample(-160),
      routeSample(-120),
      routeSample(-80),
      routeSample(-40),
      routeSample(0),
      routeSample(-40),
      routeSample(-80),
      routeSample(-120),
      routeSample(-160, 0, true),
    ],
    actions: [
      {
        ...importStone("stone-7", { x: 5, y: 1, z: 0 }),
        pickupIndex: 0,
        releaseIndex: 4,
      },
    ],
  };
  const result = await validateCandidateCommit(
    {
      protocol: "0.6.0",
      id: "candidate-7",
      parentWorldHash: "old-head",
      terrainHash: "terrain-head",
      agentId: "agent-7",
      proof,
    },
    world,
    { baseCamp: world.baseCamp, terrain },
  );

  assert.equal(result.accepted, true, JSON.stringify(result, null, 2));
  assert.equal(result.revalidatedAgainstHead, true);
  assert.equal(result.canonicalParent, "new-head");
});

test("a move is rejected when its pickup-only intermediate state would collapse", async () => {
  const world = canonicalWorld([
    stone("foot", 0, 1, 0),
    stone("lintel-0", 0, 2, 0),
    stone("lintel-1", 1, 2, 0),
  ]);
  const proof: ExpeditionProof = {
    route: [
      routeSample(-160),
      routeSample(-120),
      routeSample(-80),
      routeSample(-40),
      routeSample(-1),
      routeSample(-0.8),
      routeSample(-40),
      routeSample(-80),
      routeSample(-120),
      routeSample(-160, 0, true),
    ],
    actions: [
      {
        kind: "RELOCATE",
        matterId: "foot",
        source: { kind: "STONE", stoneId: "foot" },
        destination: {
          kind: "WORLD",
          cell: { x: 1, y: 1, z: 0 },
        },
        pickupIndex: 4,
        releaseIndex: 5,
      },
    ],
  };
  const result = await validateCandidateCommit(
    {
      protocol: "0.6.0",
      id: "intermediate-collapse",
      parentWorldHash: world.worldHash,
      terrainHash: world.terrainHash,
      agentId: "builder",
      proof,
    },
    world,
    { baseCamp: world.baseCamp, terrain },
  );

  assert.equal(result.accepted, false);
  assert.equal(result.code, "PHYSICS_INVALID");
  assert.equal(result.physics?.code, "STONE_UNANCHORED");
});

test("an action point cannot teleport a stone", async () => {
  const world = canonicalWorld();
  const proof: ExpeditionProof = {
    route: [
      routeSample(-160),
      routeSample(-120),
      routeSample(-80),
      routeSample(-40),
      routeSample(0),
      routeSample(-40, 0, true),
    ],
    actions: [
      {
        ...importStone("remote", { x: 400, y: 1, z: 0 }),
        pickupIndex: 0,
        releaseIndex: 4,
      },
    ],
  };
  const result = await validateCandidateCommit(
    {
      protocol: "0.6.0",
      id: "remote-action",
      parentWorldHash: world.worldHash,
      terrainHash: world.terrainHash,
      agentId: "agent-remote",
      proof,
    },
    world,
    { baseCamp: world.baseCamp, terrain },
  );

  assert.equal(result.accepted, false);
  assert.equal(result.route?.code, "ACTION_POSITION_MISMATCH");
});

test("a loaded route cannot exceed 100 Endurance", () => {
  const route = Array.from({ length: 5_001 }, (_, index) =>
    routeSample(index * 45, 0, index === 5_000),
  );
  const proof: ExpeditionProof = {
    route,
    actions: [
      {
        ...importStone("too-far", {
          x: Math.floor(route.at(-1)!.x / PHYSICS.voxelEdgeM),
          y: 1,
          z: 0,
        }),
        pickupIndex: 0,
        releaseIndex: route.length - 1,
      },
    ],
  };
  const result = validateRoute(proof, { x: 0, y: 0, z: 0 });

  assert.equal(result.valid, false);
  assert.equal(result.code, "ENDURANCE_EXHAUSTED");
  assert.ok(result.enduranceUsed > 100);
});
