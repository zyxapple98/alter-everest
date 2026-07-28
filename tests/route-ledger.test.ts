import assert from "node:assert/strict";
import test from "node:test";
import type { MovementVerdict } from "../engine/movement";
import {
  enduranceSegment,
  ExactRouteLedger,
} from "../engine/route";
import type {
  ExpeditionProof,
  LocomotionMode,
  MicroMovement,
  RouteSample,
} from "../engine/types";
import type { TerrainOracle } from "../engine/terrain";

const terrain: TerrainOracle = {
  sample() {
    return {
      y: 0,
      altitudeM: 5_259,
      slopeDegrees: 0,
      surface: "ROCK",
    };
  },
};

function sample(
  step: number,
  x: number,
  z: number,
  y = 0.2,
): RouteSample {
  return {
    step,
    cell: {
      x: Math.round(x / 0.2),
      y: Math.round(y / 0.2),
      z: Math.round(z / 0.2),
    },
    x,
    y,
    z,
    altitudeM: 5_259 + y,
    slopeDegrees: 0,
    surface: "ROCK",
    supportKind: "NATURAL",
  };
}

const movement: MicroMovement = {
  dx: 0,
  dy: 0,
  dz: 1,
};

function movementVerdict(
  mode: LocomotionMode,
  speedMps: number,
): MovementVerdict {
  return {
    valid: true,
    code: "MOVEMENT_VALID",
    obstacle: null,
    mode,
    slopeDegrees: 0,
    effectiveSlopeDegrees: 0,
    geometricSlopeDegrees: 0,
    stepHeightM: 0,
    effectiveSpeedMps: speedMps,
    walkStep: false,
  };
}

test("additive Endurance is non-negative and harder locomotion multiplies local effort", () => {
  const from = sample(0, 0, 0);
  const stepped = sample(1, 0.2, 0, 0.4);
  const stepMovement: MicroMovement = { dx: 1, dy: 1, dz: 0 };
  const walk = enduranceSegment(
    from,
    stepped,
    stepMovement,
    movementVerdict("WALK", 0.34),
    false,
  );
  const scramble = enduranceSegment(
    from,
    stepped,
    stepMovement,
    movementVerdict("SCRAMBLE", 0.34),
    false,
  );
  const descent = enduranceSegment(
    stepped,
    from,
    { dx: -1, dy: -1, dz: 0 },
    movementVerdict("WALK", 0.34),
    false,
  );

  assert.equal(walk.elapsedSeconds, scramble.elapsedSeconds);
  assert.ok(scramble.energyKj > walk.energyKj);
  assert.ok(walk.energyKj > 0);
  assert.ok(descent.energyKj > 0);
  assert.ok(walk.energyKj > descent.energyKj);
});

test("an outside micro-edge that cuts Camp counts as return and redeparture", () => {
  const proof: ExpeditionProof = {
    route: {
      codec: "ae-microtrace-v2",
      start: { x: 0, y: 1, z: 0 },
      stepCount: 2,
      program: "AA",
    },
    actions: [
      {
        kind: "RELOCATE",
        matterId: "edge-test",
        source: { kind: "BASE" },
        destination: {
          kind: "WORLD",
          cell: { x: 701, y: 1, z: 0 },
        },
        pickupStep: 0,
        releaseStep: 1,
      },
    ],
  };
  const first = sample(0, 0, 0);
  const outsideA = sample(1, 139.99999, -0.1);
  const outsideB = sample(2, 139.99999, 0.1);
  const baseCamp = { x: 0, y: 0, z: 0 };
  const ledger = new ExactRouteLedger(
    proof,
    first,
    baseCamp,
    terrain,
  );
  const validMovement = movementVerdict("WALK", 0.78);

  assert.equal(
    ledger.advance(
      first,
      outsideA,
      movement,
      validMovement,
      true,
    ),
    null,
  );
  const failure = ledger.advance(
    outsideA,
    outsideB,
    movement,
    validMovement,
    false,
  );
  assert.equal(failure?.code, "BASE_REDEPARTURE_FORBIDDEN");
  assert.equal(failure?.failureStep, 2);
});
