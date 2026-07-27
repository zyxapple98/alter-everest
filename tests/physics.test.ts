import assert from "node:assert/strict";
import test from "node:test";
import { CLIMBER } from "../engine/constants";
import {
  createMovementWorldView,
  validateMovement,
  validateStance,
} from "../engine/movement";
import {
  isInsideBaseCamp,
  isInsideSpawnCore,
} from "../engine/mutation";
import {
  simulateMutation,
  validateStaticServiceLoadCases,
} from "../engine/physics";
import { syntheticReliefM } from "../engine/surface";
import type { TerrainOracle } from "../engine/terrain";
import type {
  MatterMutation,
  PhysicsSnapshot,
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

test("grounded exact-cell placement is stable", async () => {
  const result = await simulateMutation(
    snapshot(),
    importStone("stone-1", { x: 0, y: 1, z: 0 }),
    { terrain },
  );
  assert.equal(result.valid, true);
  assert.deepEqual(result.finalStones, [stone("stone-1", 0, 1, 0)]);
});

test("floating placement rejects atomically", async () => {
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

test("same-cell move remains a rejected no-op", async () => {
  const existing = stone("existing", 0, 1, 0);
  const result = await simulateMutation(
    snapshot([existing]),
    {
      kind: "RELOCATE",
      matterId: existing.id,
      source: { kind: "STONE" },
      destination: { kind: "WORLD", cell: existing.cell },
    },
    { terrain },
  );
  assert.equal(result.valid, false);
  assert.equal(result.code, "NO_STATE_CHANGE");
});

test("quarry must advance from an exposed terrain face", async () => {
  const exposed = await simulateMutation(
    snapshot(),
    {
      kind: "RELOCATE",
      matterId: "quarried",
      source: { kind: "TERRAIN", voxel: { x: 0, y: 0, z: 0 } },
      destination: { kind: "WORLD", cell: { x: 2, y: 1, z: 0 } },
    },
    { terrain },
  );
  assert.equal(exposed.valid, true);

  const sealed = await simulateMutation(
    snapshot(),
    {
      kind: "RELOCATE",
      matterId: "sealed",
      source: { kind: "TERRAIN", voxel: { x: 0, y: -3, z: 0 } },
      destination: { kind: "WORLD", cell: { x: 2, y: 1, z: 0 } },
    },
    { terrain },
  );
  assert.equal(sealed.valid, false);
  assert.equal(sealed.code, "TERRAIN_VOXEL_NOT_EXPOSED");
});

test("exact stance and micro-movement use current 20 cm support", () => {
  const world = snapshot();
  const view = createMovementWorldView(world, terrain);
  const from = {
    step: 0,
    cell: { x: 0, y: 1, z: 0 },
    mode: "WALK" as const,
    protected: false,
  };
  const to = {
    step: 1,
    cell: { x: 1, y: 1, z: 0 },
    mode: "WALK" as const,
    protected: false,
  };
  assert.equal(validateStance(view, from).valid, true);
  assert.equal(
    validateMovement(
      view,
      from,
      to,
      {
        dx: 1,
        dy: 0,
        dz: 0,
        mode: "WALK",
        protected: false,
      },
      false,
    ).valid,
    true,
  );
  assert.equal(validateStance(view, to).valid, true);
});

test("unsupported stance and unprotected climb fail locally", () => {
  const view = createMovementWorldView(snapshot(), terrain);
  const unsupported = {
    step: 0,
    cell: { x: 0, y: 3, z: 0 },
    mode: "WALK" as const,
    protected: false,
  };
  assert.equal(validateStance(view, unsupported).code, "ROUTE_UNSUPPORTED");

  const from = {
    step: 0,
    cell: { x: 0, y: 1, z: 0 },
    mode: "WALK" as const,
    protected: false,
  };
  const to = {
    step: 1,
    cell: { x: 1, y: 5, z: 0 },
    mode: "CLIMB" as const,
    protected: false,
  };
  assert.equal(
    validateMovement(
      view,
      from,
      to,
      {
        dx: 1,
        dy: 4,
        dz: 0,
        mode: "CLIMB",
        protected: false,
      },
      false,
    ).code,
    "CLIMB_UNPROTECTED",
  );
});

test("stone service load is checked as a bounded alternative case", () => {
  const world = snapshot([
    stone("left", 0, 1, 0),
    stone("right", 1, 1, 0),
  ]);
  const result = validateStaticServiceLoadCases(
    world,
    [
      {
        supportCell: { x: 1, y: 1, z: 0 },
        stoneWeightEquivalent: 1,
      },
    ],
    terrain,
  );
  assert.equal(result.valid, true);
});

test("Base Camp and Spawn Core ignore altitude", () => {
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
        y: 0,
        z: 0,
      },
      world,
    ),
    false,
  );
});
