import assert from "node:assert/strict";
import test from "node:test";
import { CLIMBER } from "../engine/constants";
import { validateActionPickupBinding } from "../engine/action";
import {
  createMovementWorldView,
  validateMovement as validateMovementCore,
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
  MicroMovement,
  RouteStance,
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

function columnTerrain(
  topCells: Readonly<Record<number, number>>,
  slopeDegrees = 0,
): TerrainOracle {
  return {
    sample(x, z) {
      const column = Math.floor(x / 0.2);
      const topCell = topCells[column] ?? 0;
      const y =
        topCell * 0.2 + 1e-7 - syntheticReliefM(x, z);
      return {
        y,
        altitudeM: 5_350 + y,
        slopeDegrees,
        surface: "ROCK",
      };
    },
  };
}

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

function validateMovement(
  view: ReturnType<typeof createMovementWorldView>,
  from: RouteStance,
  to: RouteStance,
  movement: MicroMovement,
  carrying: boolean,
) {
  const fromVerdict = validateStance(view, from);
  const toVerdict = validateStance(view, to);
  assert.ok(fromVerdict.sample);
  assert.ok(toVerdict.sample);
  return validateMovementCore(
    view,
    fromVerdict.sample,
    toVerdict.sample,
    {
      dx: movement.dx,
      dy: movement.dy,
      dz: movement.dz,
    },
    carrying,
  );
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
  };
  const to = {
    step: 1,
    cell: { x: 1, y: 1, z: 0 },
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
      },
      false,
    ).valid,
    true,
  );
  assert.equal(validateStance(view, to).valid, true);
});

test("a 20 cm terrain rise is a locally costed WALK step, not a 45 degree slope", () => {
  const steppedTerrain = columnTerrain({ 0: 0, 1: 1 });
  const view = createMovementWorldView(snapshot(), steppedTerrain);
  const from = {
    step: 0,
    cell: { x: 0, y: 1, z: 0 },
  };
  const to = {
    step: 1,
    cell: { x: 1, y: 2, z: 0 },
  };
  const movement = {
    dx: 1,
    dy: 1,
    dz: 0,
  };

  assert.equal(validateStance(view, from).valid, true);
  assert.equal(validateStance(view, to).valid, true);
  for (const carrying of [false, true]) {
    const result = validateMovement(
      view,
      from,
      to,
      movement,
      carrying,
    );
    assert.equal(result.valid, true);
    assert.equal(result.walkStep, true);
    assert.equal(result.stepHeightM, 0.2);
    assert.equal(result.geometricSlopeDegrees, 45);
    assert.equal(result.slopeDegrees, 0);
    assert.equal(result.effectiveSpeedMps, CLIMBER.walkStepSpeedMps);
  }
});

test("a placed 20 cm stone is valid lower-body contact and a WALK tread", () => {
  const step = stone("walk-step", 1, 1, 0);
  const view = createMovementWorldView(snapshot([step]), terrain);
  const from = {
    step: 0,
    cell: { x: 0, y: 1, z: 0 },
  };
  const to = {
    step: 1,
    cell: { x: 1, y: 2, z: 0 },
  };
  const result = validateMovement(
    view,
    from,
    to,
    {
      dx: 1,
      dy: 1,
      dz: 0,
    },
    false,
  );

  assert.equal(validateStance(view, from).valid, true);
  assert.equal(result.valid, true);
  assert.equal(result.walkStep, true);
  assert.equal(result.slopeDegrees, 0);
  assert.equal(validateStance(view, to).valid, true);
});

test("consecutive 20 cm WALK steps stay local and accumulate no search history", () => {
  const staircaseTerrain = columnTerrain({
    0: 0,
    1: 1,
    2: 2,
    3: 3,
    4: 4,
  });
  const view = createMovementWorldView(snapshot(), staircaseTerrain);
  for (let column = 0; column < 4; column += 1) {
    const from = {
      step: column,
      cell: { x: column, y: column + 1, z: 0 },
    };
    const to = {
      step: column + 1,
      cell: { x: column + 1, y: column + 2, z: 0 },
    };
    const result = validateMovement(
      view,
      from,
      to,
      {
        dx: 1,
        dy: 1,
        dz: 0,
      },
      false,
    );

    assert.equal(validateStance(view, from).valid, true);
    assert.equal(result.valid, true);
    assert.equal(result.walkStep, true);
    assert.equal(result.effectiveSpeedMps, CLIMBER.walkStepSpeedMps);
    assert.equal(validateStance(view, to).valid, true);
  }
});

test("step height and actual support slope independently derive movement tier", () => {
  const highStepView = createMovementWorldView(
    snapshot(),
    columnTerrain({ 0: 0, 1: 2 }),
  );
  const steepStepView = createMovementWorldView(
    snapshot(),
    columnTerrain({ 0: 0, 1: 1 }, 36),
  );
  const from = {
    step: 0,
    cell: { x: 0, y: 1, z: 0 },
  };

  const highStep = validateMovement(
    highStepView,
    from,
    {
      step: 1,
      cell: { x: 1, y: 3, z: 0 },
    },
    {
      dx: 1,
      dy: 2,
      dz: 0,
    },
    false,
  );
  assert.equal(highStep.valid, true);
  assert.equal(highStep.mode, "SCRAMBLE");
  const steepResult = validateMovement(
    steepStepView,
    from,
    {
      step: 1,
      cell: { x: 1, y: 2, z: 0 },
    },
    {
      dx: 1,
      dy: 1,
      dz: 0,
    },
    false,
  );
  assert.equal(steepResult.valid, true);
  assert.equal(steepResult.mode, "SCRAMBLE");
  assert.equal(steepResult.walkStep, false);
  assert.equal(steepResult.slopeDegrees, 36);
  assert.equal(steepResult.geometricSlopeDegrees, 45);

  const steepLandingView = createMovementWorldView(
    snapshot([stone("source-step", 0, 1, 0)]),
    columnTerrain({ 0: 0, 1: 0 }, 36),
  );
  const steepLanding = validateMovement(
    steepLandingView,
    {
      step: 0,
      cell: { x: 0, y: 2, z: 0 },
    },
    {
      step: 1,
      cell: { x: 1, y: 1, z: 0 },
    },
    {
      dx: 1,
      dy: -1,
      dz: 0,
    },
    false,
  );
  assert.equal(steepLanding.valid, true);
  assert.equal(steepLanding.mode, "SCRAMBLE");
  assert.equal(steepLanding.slopeDegrees, 36);
});

test("swept clearance detects stones across spatial bucket boundaries", () => {
  for (const [fromX, toX, blockerX] of [
    [31, 32, 32],
    [-33, -32, -32],
  ]) {
    const blocker = stone(`blocker-${blockerX}`, blockerX, 3, 0);
    const edgeTerrain = columnTerrain({ [fromX]: 0, [toX]: 4 });
    const view = createMovementWorldView(
      snapshot([blocker]),
      edgeTerrain,
    );
    const clearView = createMovementWorldView(snapshot(), edgeTerrain);
    const from = {
      step: 0,
      cell: { x: fromX, y: 1, z: 0 },
    };
    const to = {
      step: 1,
      cell: { x: toX, y: 5, z: 0 },
    };
    const fromSample = validateStance(clearView, from).sample;
    const toSample = validateStance(clearView, to).sample;
    assert.ok(fromSample);
    assert.ok(toSample);
    const result = validateMovementCore(
      view,
      fromSample,
      toSample,
      { dx: 1, dy: 4, dz: 0 },
      false,
    );
    assert.equal(result.code, "ROUTE_OBSTRUCTED");
    assert.equal(result.obstacle, blocker.id);
  }
});

test("unsupported stances fail and technical movement is verifier-derived", () => {
  const view = createMovementWorldView(snapshot(), terrain);
  const unsupported = {
    step: 0,
    cell: { x: 0, y: 3, z: 0 },
  };
  assert.equal(validateStance(view, unsupported).code, "ROUTE_UNSUPPORTED");

  const from = {
    step: 0,
    cell: { x: 0, y: 1, z: 0 },
  };
  const technicalView = createMovementWorldView(
    snapshot(),
    columnTerrain({ 0: 0, 1: 4 }),
  );
  const to = {
    step: 1,
    cell: { x: 1, y: 5, z: 0 },
  };
  const technical = validateMovement(
    technicalView,
    from,
    to,
    {
      dx: 1,
      dy: 4,
      dz: 0,
    },
    false,
  );
  assert.equal(technical.valid, true);
  assert.equal(technical.mode, "CLIMB");
  assert.equal(technical.stepHeightM, 0.8);
});

test("40 cm steps have the same derived tier in orthogonal and diagonal directions", () => {
  const steppedTerrain = columnTerrain({ 0: 0, 1: 2 });
  const view = createMovementWorldView(snapshot(), steppedTerrain);
  const from = { step: 0, cell: { x: 0, y: 1, z: 0 } };
  const orthogonal = validateMovement(
    view,
    from,
    { step: 1, cell: { x: 1, y: 3, z: 0 } },
    { dx: 1, dy: 2, dz: 0 },
    false,
  );
  const diagonal = validateMovement(
    view,
    from,
    { step: 1, cell: { x: 1, y: 3, z: 1 } },
    { dx: 1, dy: 2, dz: 1 },
    false,
  );
  assert.equal(orthogonal.mode, "SCRAMBLE");
  assert.equal(diagonal.mode, "SCRAMBLE");
  assert.notEqual(
    orthogonal.geometricSlopeDegrees,
    diagonal.geometricSlopeDegrees,
  );
});

test("support profile follows the actual tread rather than the route centre line or buried terrain", () => {
  const steepTerrain = columnTerrain({ 0: 0, 1: 0 }, 60);
  const naturalView = createMovementWorldView(snapshot(), steepTerrain);
  const naturalFrom = validateStance(naturalView, {
    step: 0,
    cell: { x: 0, y: 1, z: 0 },
  });
  const naturalTo = validateStance(naturalView, {
    step: 1,
    cell: { x: 1, y: 1, z: 0 },
  });
  assert.ok(naturalFrom.sample);
  assert.ok(naturalTo.sample);
  const contour = validateMovementCore(
    naturalView,
    naturalFrom.sample,
    naturalTo.sample,
    { dx: 1, dy: 0, dz: 0 },
    false,
  );
  assert.equal(contour.geometricSlopeDegrees, 0);
  assert.equal(contour.mode, "CLIMB");

  const platformView = createMovementWorldView(
    snapshot([
      stone("platform-a", 0, 1, 0),
      stone("platform-b", 1, 1, 0),
    ]),
    steepTerrain,
  );
  const platformFrom = validateStance(platformView, {
    step: 0,
    cell: { x: 0, y: 2, z: 0 },
  });
  const platformTo = validateStance(platformView, {
    step: 1,
    cell: { x: 1, y: 2, z: 0 },
  });
  assert.ok(platformFrom.sample);
  assert.ok(platformTo.sample);
  assert.equal(platformFrom.sample.supportKind, "STONE");
  assert.equal(platformFrom.sample.slopeDegrees, 0);
  assert.equal(platformFrom.sample.surface, "ROCK");
  const platform = validateMovementCore(
    platformView,
    platformFrom.sample,
    platformTo.sample,
    { dx: 1, dy: 0, dz: 0 },
    false,
  );
  assert.equal(platform.mode, "WALK");
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

test("Base Camp follows local ground while Spawn Core remains a protected column", () => {
  const world = { baseCamp: { x: -160, y: 0, z: 0 } };
  assert.equal(
    isInsideBaseCamp(
      { x: -160, y: 10_000, z: 0 },
      world,
      terrain,
    ),
    false,
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
      terrain,
    ),
    false,
  );
  const localGround = terrain.sample(-160, 0)!;
  assert.equal(
    isInsideBaseCamp(
      { x: -160, y: localGround.y, z: 0 },
      world,
      terrain,
    ),
    true,
  );
});

test("heavy matter interaction is short-range and cannot pass through solid cells", () => {
  const target = stone("target", 3, 1, 0);
  const baseCamp = { x: 100, y: 0, z: 100 };
  const action = {
    kind: "RELOCATE" as const,
    matterId: target.id,
    source: { kind: "STONE" as const },
    destination: { kind: "BASE" as const },
    pickupStep: 0,
    releaseStep: 1,
  };
  const stance = { x: 0.1, y: 0.2, z: 0.1 };
  const visibleView = createMovementWorldView(
    snapshot([target]),
    terrain,
  );
  assert.equal(
    validateActionPickupBinding(action, stance, {
      baseCamp,
      view: visibleView,
    }).code,
    "ACTION_BOUND",
  );

  const blockedView = createMovementWorldView(
    snapshot([target, stone("wall", 2, 2, 0)]),
    terrain,
  );
  assert.equal(
    validateActionPickupBinding(action, stance, {
      baseCamp,
      view: blockedView,
    }).code,
    "ACTION_OCCLUDED",
  );

  const farTarget = stone("far-target", 4, 1, 0);
  const farView = createMovementWorldView(
    snapshot([farTarget]),
    terrain,
  );
  assert.equal(
    validateActionPickupBinding(
      { ...action, matterId: farTarget.id },
      stance,
      { baseCamp, view: farView },
    ).code,
    "ACTION_POSITION_MISMATCH",
  );
});
