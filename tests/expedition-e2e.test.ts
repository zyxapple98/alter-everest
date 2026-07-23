import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateCandidateCommit } from "../engine/commit";
import type { CandidateCommit } from "../engine/types";
import { applyAcceptedCandidate } from "../engine/world";
import { validateCandidateShape } from "../lib/protocol";
import {
  loadCanonicalWorld,
  loadDemBundle,
  planCandidate,
  worldForCandidate,
} from "../scripts/expedition-kit";

async function fixture() {
  const [world, terrain, candidateText] = await Promise.all([
    loadCanonicalWorld(),
    loadDemBundle(),
    readFile(
      new URL(
        "../candidates/example-agent/everest-roundtrip.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  return {
    world,
    terrain,
    candidate: JSON.parse(candidateText) as CandidateCommit,
  };
}

test("the checked-in agent expedition reaches high Everest and returns", async () => {
  const { world, terrain, candidate } = await fixture();
  const shape = validateCandidateShape(candidate);
  assert.equal(shape.valid, true, shape.errors.join("\n"));

  const validationWorld = worldForCandidate(world, terrain, candidate);
  const verdict = await validateCandidateCommit(candidate, validationWorld, {
    baseCamp: world.baseCamp,
    terrain: terrain.oracle,
  });

  assert.equal(verdict.accepted, true);
  assert.equal(verdict.physics?.code, "STABLE");
  assert.equal(verdict.route?.outcome, "ACTIVE");
  assert.ok((verdict.route?.oxygenUsed ?? 401) < 400);
  assert.ok(candidate.proof.route[candidate.proof.releaseIndex!].altitudeM > 8_700);

  const applied = await applyAcceptedCandidate(candidate, world, verdict);
  assert.equal(applied.stones.length, 1);
  assert.equal(
    applied.identities.find((identity) => identity.id === candidate.agentId)
      ?.status,
    "ACTIVE",
  );
  assert.equal(applied.tombstones.length, world.tombstones.length);
  assert.ok(applied.expeditions.at(-1)!.score > 400);
  assert.match(applied.worldHash, /^[a-f0-9]{64}$/);

  const replay = await validateCandidateCommit(
    candidate,
    worldForCandidate(applied, terrain, candidate),
    {
      baseCamp: applied.baseCamp,
      terrain: terrain.oracle,
    },
  );
  assert.equal(replay.accepted, false);
  assert.equal(replay.code, "CANDIDATE_ALREADY_APPLIED");
});

test("a valid one-way expedition creates a tombstone and ends the identity", async () => {
  const { world, terrain } = await fixture();
  const candidate = planCandidate(terrain, world, "one-way-agent", true);
  const validationWorld = worldForCandidate(world, terrain, candidate);
  const verdict = await validateCandidateCommit(candidate, validationWorld, {
    baseCamp: world.baseCamp,
    terrain: terrain.oracle,
  });

  assert.equal(verdict.accepted, true);
  assert.equal(verdict.nextIdentityStatus, "DEAD");
  const applied = await applyAcceptedCandidate(candidate, world, verdict);
  const tombstone = applied.tombstones.find(
    (entry) => entry.expeditionId === candidate.id,
  );
  assert.equal(tombstone?.agentId, "one-way-agent");
  assert.ok((tombstone?.altitudeM ?? 0) > 8_700);
});

test("terrain claims are recomputed from the hashed DEM", async () => {
  const { world, terrain, candidate } = await fixture();
  const tampered = structuredClone(candidate);
  tampered.proof.route[20].altitudeM += 100;
  const validationWorld = worldForCandidate(world, terrain, tampered);
  const verdict = await validateCandidateCommit(tampered, validationWorld, {
    baseCamp: world.baseCamp,
    terrain: terrain.oracle,
  });

  assert.equal(verdict.accepted, false);
  assert.equal(verdict.route?.code, "TERRAIN_MISMATCH");
});

test("a competing stone turns a stale route into a CI conflict", async () => {
  const { world, terrain, candidate } = await fixture();
  const blockedSample = candidate.proof.route[8];
  const competingWorld = {
    ...world,
    worldHash: "world-after-competitor",
    stones: [
      {
        id: "stone-competitor",
        pose: {
          translation: {
            x: blockedSample.x,
            y: blockedSample.y + 0.1,
            z: blockedSample.z,
          },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      },
    ],
  };
  const validationWorld = worldForCandidate(
    competingWorld,
    terrain,
    candidate,
  );
  const verdict = await validateCandidateCommit(candidate, validationWorld, {
    baseCamp: world.baseCamp,
    terrain: terrain.oracle,
  });

  assert.equal(verdict.accepted, false);
  assert.equal(verdict.code, "STALE_CONFLICT");
  assert.equal(verdict.route?.code, "ROUTE_OBSTRUCTED");
  assert.equal(verdict.revalidatedAgainstHead, true);
});
