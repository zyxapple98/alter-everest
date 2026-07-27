import assert from "node:assert/strict";
import test from "node:test";
import { validateCandidateCommit } from "../engine/commit";
import { exactRouteFromStances } from "../engine/route-codec";
import type {
  CandidateCommit,
  CanonicalWorld,
} from "../engine/types";
import { applyAcceptedCandidate, computeWorldHash } from "../engine/world";
import { currentTopVoxel } from "../engine/surface";
import {
  loadCanonicalWorld,
  loadDemBundle,
} from "../scripts/expedition-kit";
import { roundTrip, surfaceLine } from "./helpers/exact-route";

const terrain = await loadDemBundle();

function clone<T>(value: T): T {
  return structuredClone(value);
}

function firstMarkerCandidate(
  world: CanonicalWorld,
  input: {
    agentId: string;
    id: string;
    roundTripRoute?: boolean;
  },
): CandidateCommit {
  const startX = Math.floor(world.baseCamp.x / 0.2);
  const startZ = Math.floor(world.baseCamp.z / 0.2);
  const outbound = surfaceLine(terrain.oracle, world, {
    startX,
    startZ,
    endX: startX + 705,
    endZ: startZ,
    mode: "SCRAMBLE",
  });
  const stances =
    input.roundTripRoute === false ? outbound : roundTrip(outbound);
  const destinationX = startX + 705;
  const destinationZ = startZ + 4;
  const destinationTop = currentTopVoxel(
    terrain.oracle,
    world.removedTerrainVoxels,
    destinationX,
    destinationZ,
  );
  assert.notEqual(destinationTop, null);
  return {
    protocol: "0.7.0",
    id: input.id,
    parentWorldHash: world.worldHash,
    terrainHash: world.terrainHash,
    agentId: input.agentId,
    proof: {
      route: exactRouteFromStances(
        stances,
        input.roundTripRoute === false,
      ),
      actions: [
        {
          kind: "RELOCATE",
          matterId: `stone-${input.agentId}-${input.id}`,
          source: { kind: "BASE" },
          destination: {
            kind: "WORLD",
            cell: {
              x: destinationX,
              y: destinationTop! + 1,
              z: destinationZ,
            },
          },
          pickupStep: 0,
          releaseStep: outbound.length - 1,
        },
      ],
    },
  };
}

async function verify(candidate: CandidateCommit, world: CanonicalWorld) {
  return validateCandidateCommit(candidate, world, {
    baseCamp: world.baseCamp,
    extractionZones: world.extractionZones,
    terrain: terrain.oracle,
  });
}

test("exact round-trip expedition accepts and updates footprint", async () => {
  const world = await loadCanonicalWorld();
  const candidate = firstMarkerCandidate(world, {
    agentId: "exact-agent",
    id: "exact-round-trip",
  });
  assert.ok(candidate.proof.route.stepCount > 1_000);
  assert.ok(
    Buffer.from(candidate.proof.route.program, "base64url").byteLength <
      1_000,
  );

  const verdict = await verify(candidate, world);
  assert.equal(verdict.accepted, true);
  assert.equal(verdict.route?.outcome, "ACTIVE");
  assert.equal(verdict.route?.failureStep, null);
  assert.ok((verdict.route?.distanceMillimeters ?? 0) > 290_000);
  assert.deepEqual(verdict.footprintDelta, {
    terrainRemovalsCreated: 0,
    stonePlacementsCreated: 1,
    stonePlacementsRemoved: 0,
  });

  const next = await applyAcceptedCandidate(candidate, world, verdict);
  const footprint = next.footprints.find(
    (entry) => entry.agentId === "exact-agent",
  );
  assert.equal(footprint?.acceptedExpeditions, 1);
  assert.equal(footprint?.activeAlterations, 1);
  assert.equal(
    footprint?.totalDistanceMillimeters,
    verdict.route?.distanceMillimeters,
  );
});

test("legal exact one-way expedition accepts and kills the identity", async () => {
  const world = await loadCanonicalWorld();
  const candidate = firstMarkerCandidate(world, {
    agentId: "one-way-agent",
    id: "exact-one-way",
    roundTripRoute: false,
  });
  const verdict = await verify(candidate, world);
  assert.equal(verdict.accepted, true);
  assert.equal(verdict.route?.outcome, "DEAD");

  const next = await applyAcceptedCandidate(candidate, world, verdict);
  assert.equal(
    next.identities.find((entry) => entry.id === "one-way-agent")?.status,
    "DEAD",
  );
  assert.equal(next.tombstones.at(-1)?.agentId, "one-way-agent");
});

test("GitHub identity lifecycle is case-insensitive", async () => {
  const world = await loadCanonicalWorld();
  const first = firstMarkerCandidate(world, {
    agentId: "Case-Agent",
    id: "case-one-way",
    roundTripRoute: false,
  });
  const firstVerdict = await verify(first, world);
  assert.equal(firstVerdict.accepted, true);
  const next = await applyAcceptedCandidate(first, world, firstVerdict);
  assert.equal(
    next.identities.find((entry) => entry.id === "Case-Agent")?.status,
    "DEAD",
  );

  const second = firstMarkerCandidate(next, {
    agentId: "case-agent",
    id: "case-second-expedition",
  });
  const secondVerdict = await verify(second, next);
  assert.equal(secondVerdict.accepted, false);
  assert.equal(secondVerdict.code, "IDENTITY_DEAD");
});

test("non-canonical or mismatched route program is rejected", async () => {
  const world = await loadCanonicalWorld();
  const candidate = firstMarkerCandidate(world, {
    agentId: "codec-agent",
    id: "bad-codec",
  });
  candidate.proof.route = {
    ...candidate.proof.route,
    stepCount: candidate.proof.route.stepCount + 1,
  };
  const verdict = await verify(candidate, world);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.code, "ROUTE_INVALID");
  assert.equal(verdict.route?.code, "ROUTE_PROGRAM_INVALID");
});

test("a competing stone turns an exact stale trace into conflict", async () => {
  const world = await loadCanonicalWorld();
  const candidate = firstMarkerCandidate(world, {
    agentId: "stale-agent",
    id: "stale-route",
  });
  const decoded = (
    await import("../engine/route")
  ).decodeCandidateRoute(candidate.proof);
  const blocked = decoded.stances[20].cell;
  const changed = clone(world);
  changed.stones.push({
    id: "competing-route-blocker",
    cell: { ...blocked },
  });
  changed.worldHash = await computeWorldHash({
    ...changed,
    worldHash: "",
  });

  const verdict = await verify(candidate, changed);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.code, "STALE_CONFLICT");
  assert.equal(verdict.route?.code, "ROUTE_OBSTRUCTED");
  assert.ok((verdict.route?.failureStep ?? -1) < 20);
  assert.equal(verdict.route?.obstacle, "competing-route-blocker");
});
