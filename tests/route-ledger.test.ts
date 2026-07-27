import assert from "node:assert/strict";
import test from "node:test";
import { ExactRouteLedger } from "../engine/route";
import type {
  ExpeditionProof,
  MicroMovement,
  RouteSample,
} from "../engine/types";

function sample(step: number, x: number, z: number): RouteSample {
  return {
    step,
    cell: {
      x: Math.round(x / 0.2),
      y: 1,
      z: Math.round(z / 0.2),
    },
    x,
    y: 0.2,
    z,
    altitudeM: 5_259.2,
    slopeDegrees: 0,
    surface: "ROCK",
    mode: step === 0 ? "WALK" : "SCRAMBLE",
    protected: false,
  };
}

const movement: MicroMovement = {
  dx: 0,
  dy: 0,
  dz: 1,
  mode: "SCRAMBLE",
  protected: false,
};

test("an outside micro-edge that cuts Camp counts as return and redeparture", () => {
  const proof: ExpeditionProof = {
    route: {
      codec: "ae-microtrace-v1",
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
  const ledger = new ExactRouteLedger(proof, first, {
    x: 0,
    y: 0,
    z: 0,
  });

  assert.equal(
    ledger.advance(first, outsideA, movement, true),
    null,
  );
  const failure = ledger.advance(
    outsideA,
    outsideB,
    movement,
    false,
  );
  assert.equal(failure?.code, "BASE_REDEPARTURE_FORBIDDEN");
  assert.equal(failure?.failureStep, 2);
});
