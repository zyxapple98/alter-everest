import assert from "node:assert/strict";
import test from "node:test";
import { validateCandidateCommit } from "../engine/commit";
import { validateRouteClearance } from "../engine/clearance";
import { simulateMutation } from "../engine/physics";
import { validateRoute } from "../engine/route";
import {
  IDENTITY_QUATERNION,
  type CanonicalWorld,
  type ExpeditionProof,
  type PhysicsSnapshot,
  type RouteSample,
  type StoneState,
} from "../engine/types";

const floor = {
  kind: "cuboid" as const,
  center: { x: 0, y: -0.5, z: 0 },
  halfExtents: { x: 8, y: 0.5, z: 8 },
};

function pose(x: number, y: number, z: number) {
  return {
    translation: { x, y, z },
    rotation: IDENTITY_QUATERNION,
  };
}

function stone(id: string, x: number, y: number, z: number): StoneState {
  return { id, pose: pose(x, y, z) };
}

function snapshot(stones: StoneState[] = []): PhysicsSnapshot {
  return { worldHash: "world-head", stones, terrain: [floor] };
}

function routeSample(
  x: number,
  y: number,
  safeStop = false,
): RouteSample {
  return {
    x,
    y,
    z: 0,
    altitudeM: 5350 + y,
    slopeDegrees: 8,
    surface: "ROCK",
    mode: "WALK",
    safeStop,
  };
}

test("a stone released on rock settles and remains at the intended placement", async () => {
  const result = await simulateMutation(snapshot(), {
    kind: "ADD",
    stoneId: "stone-1",
    releasePose: pose(0, 0.11, 0),
  });

  assert.equal(result.valid, true);
  assert.equal(result.code, "STABLE");
  assert.ok(Math.abs(result.finalStones[0].pose.translation.y - 0.1) < 0.012);
});

test("a proposed floating stone falls and the placement is rejected", async () => {
  const result = await simulateMutation(snapshot(), {
    kind: "ADD",
    stoneId: "stone-1",
    releasePose: pose(0, 1.1, 0),
  });

  assert.equal(result.valid, false);
  assert.equal(result.code, "PLACEMENT_DID_NOT_HOLD");
  assert.ok(result.finalStones[0].pose.translation.y < 0.15);
});

test("a centered stack holds but an excessive cantilever does not", async () => {
  const base = stone("stone-base", 0, 0.1, 0);
  const centered = await simulateMutation(snapshot([base]), {
    kind: "ADD",
    stoneId: "stone-top",
    releasePose: pose(0, 0.31, 0),
  });
  assert.equal(centered.valid, true);

  const cantilevered = await simulateMutation(snapshot([base]), {
    kind: "ADD",
    stoneId: "stone-top",
    releasePose: pose(0.13, 0.31, 0),
  });
  assert.equal(cantilevered.valid, false);
  assert.equal(cantilevered.code, "PLACEMENT_DID_NOT_HOLD");
});

test("return status is inferred from the terminal position", () => {
  const oneWayProof: ExpeditionProof = {
    route: [
      routeSample(0, 0),
      routeSample(0.75, 0.025),
      routeSample(1.5, 0.05),
      routeSample(2.25, 0.075),
      routeSample(3, 0.1, true),
    ],
    mutation: {
      kind: "ADD",
      stoneId: "stone-1",
      releasePose: pose(1, 0.11, 0),
    },
    releaseIndex: 4,
  };
  const oneWay = validateRoute(oneWayProof, { x: 0, y: 0, z: 0 });
  assert.equal(oneWay.valid, true);
  assert.equal(oneWay.outcome, "RETIRED");

  const returnedProof: ExpeditionProof = {
    ...oneWayProof,
    route: [
      routeSample(0, 0),
      routeSample(0.75, 0.025),
      routeSample(1.5, 0.05),
      routeSample(2.25, 0.075),
      routeSample(3, 0.1),
      routeSample(2.25, 0.075),
      routeSample(1.5, 0.05),
      routeSample(0.75, 0.025),
      routeSample(0, 0, true),
    ],
  };
  const returned = validateRoute(returnedProof, { x: 0, y: 0, z: 0 });
  assert.equal(returned.valid, true);
  assert.equal(returned.outcome, "ACTIVE");
});

test("the climber capsule rejects a route blocked by an existing stone", async () => {
  const blocked = await validateRouteClearance(
    snapshot([stone("stone-obstacle", 0.55, 0.1, 0)]),
    [routeSample(0, 0), routeSample(0.8, 0)],
  );
  assert.equal(blocked.clear, false);
  assert.equal(blocked.stoneId, "stone-obstacle");
  assert.equal(blocked.blockedSegmentIndex, 0);
});

test("a pickup target is excluded without making other stones passable", async () => {
  const world = snapshot([
    stone("stone-target", 0.55, 0.1, 0),
    stone("stone-obstacle", 1.4, 0.1, 0),
  ]);
  const route = [
    routeSample(0, 0),
    routeSample(0.8, 0),
    routeSample(1.7, 0),
  ];

  const result = await validateRouteClearance(
    world,
    route,
    new Set(["stone-target"]),
  );

  assert.equal(result.clear, false);
  assert.equal(result.stoneId, "stone-obstacle");
});

test("a stale candidate is replayed against HEAD and accepted when still valid", async () => {
  const world: CanonicalWorld = {
    ...snapshot(),
    worldHash: "new-head",
    identities: [{ id: "agent-7", status: "ACTIVE" }],
  };
  const proof: ExpeditionProof = {
    route: [
      routeSample(0, 0),
      routeSample(0.5, 0.02),
      routeSample(0, 0, true),
    ],
    mutation: {
      kind: "ADD",
      stoneId: "stone-7",
      releasePose: pose(0, 0.11, 0),
    },
    releaseIndex: 1,
  };
  const result = await validateCandidateCommit(
    {
      id: "candidate-7",
      parentWorldHash: "old-head",
      agentId: "agent-7",
      proof,
    },
    world,
    { x: 0, y: 0, z: 0 },
  );

  assert.equal(result.accepted, true);
  assert.equal(result.revalidatedAgainstHead, true);
  assert.equal(result.canonicalParent, "new-head");
});
