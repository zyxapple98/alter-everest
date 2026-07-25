import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateCandidateCommit } from "../engine/commit";
import type {
  CandidateCommit,
  CanonicalWorld,
  RouteSample,
} from "../engine/types";
import { applyAcceptedCandidate } from "../engine/world";
import { TERRAIN } from "../engine/constants";
import { currentTopVoxel } from "../engine/surface";
import { validateCandidateShape } from "../lib/protocol";
import {
  loadDemBundle,
} from "../scripts/expedition-kit";

async function fixture() {
  const [worldText, terrain, candidateText] = await Promise.all([
    readFile(
      new URL("./fixtures/genesis-world.json", import.meta.url),
      "utf8",
    ),
    loadDemBundle(),
    readFile(
      new URL(
        "./fixtures/everest-one-way-candidate.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  return {
    world: JSON.parse(worldText) as CanonicalWorld,
    terrain,
    candidate: JSON.parse(candidateText) as CandidateCommit,
  };
}

test("the checked-in agent expedition reaches high Everest one-way", async () => {
  const { world, terrain, candidate } = await fixture();
  const shape = validateCandidateShape(candidate);
  assert.equal(shape.valid, true, shape.errors.join("\n"));

  const validationWorld = world;
  const verdict = await validateCandidateCommit(candidate, validationWorld, {
    baseCamp: world.baseCamp,
    terrain: terrain.oracle,
  });

  assert.equal(verdict.accepted, true, JSON.stringify(verdict, null, 2));
  assert.equal(verdict.physics?.code, "STABLE");
  assert.equal(verdict.route?.outcome, "DEAD");
  assert.ok((verdict.route?.enduranceUsed ?? 101) < 100);
  assert.ok(
    candidate.proof.route[candidate.proof.actions[0].releaseIndex].altitudeM >
      8_700,
  );

  const applied = await applyAcceptedCandidate(candidate, world, verdict);
  assert.equal(applied.stones.length, 1);
  assert.equal(
    applied.identities.find((identity) => identity.id === candidate.agentId)
      ?.status,
    "DEAD",
  );
  assert.equal(applied.tombstones.length, world.tombstones.length + 1);
  assert.ok(applied.expeditions.at(-1)!.score > 300);
  assert.ok(applied.modifiedChunks.length > 0);
  assert.ok(applied.modifiedTiles.length > 0);
  assert.match(applied.worldHash, /^[a-f0-9]{64}$/);

  const replay = await validateCandidateCommit(
    candidate,
    applied,
    {
      baseCamp: applied.baseCamp,
      terrain: terrain.oracle,
    },
  );
  assert.equal(replay.accepted, false);
  assert.equal(replay.code, "CANDIDATE_ALREADY_APPLIED");
});

test("a lower round-trip preserves the identity without an official planner", async () => {
  const { world, terrain, candidate: summitCandidate } = await fixture();
  const releaseIndex = 72;
  const ascent = summitCandidate.proof.route.slice(0, releaseIndex + 1);
  const releaseSample = ascent.at(-1)!;
  const columnX = Math.floor(releaseSample.x / TERRAIN.voxelEdgeM);
  const columnZ = Math.floor(releaseSample.z / TERRAIN.voxelEdgeM);
  const placementColumnX = columnX + 5;
  const topVoxel = currentTopVoxel(
    terrain.oracle,
    world.removedTerrainVoxels,
    placementColumnX,
    columnZ,
  )!;
  const descent = ascent
    .slice(0, -1)
    .reverse()
    .map((sample) => ({ ...sample, safeStop: undefined }));
  const candidate: CandidateCommit = {
    ...structuredClone(summitCandidate),
    id: "fixture-lower-roundtrip",
    agentId: "roundtrip-agent",
    proof: {
      route: [...ascent, ...descent],
      actions: [
        {
          kind: "RELOCATE",
          matterId: "stone-fixture-lower-roundtrip",
          source: { kind: "BASE" },
          destination: {
            kind: "WORLD",
            cell: {
              x: placementColumnX,
              y: topVoxel + 1,
              z: columnZ,
            },
          },
          pickupIndex: 0,
          releaseIndex,
        },
      ],
    },
  };
  candidate.proof.route[candidate.proof.route.length - 1] = {
    ...candidate.proof.route.at(-1)!,
    safeStop: true,
  };
  const validationWorld = world;
  const verdict = await validateCandidateCommit(candidate, validationWorld, {
    baseCamp: world.baseCamp,
    terrain: terrain.oracle,
  });

  assert.equal(verdict.accepted, true, JSON.stringify(verdict, null, 2));
  assert.equal(verdict.nextIdentityStatus, "ACTIVE");
  const applied = await applyAcceptedCandidate(candidate, world, verdict);
  assert.equal(
    applied.identities.find((entry) => entry.id === candidate.agentId)?.status,
    "ACTIVE",
  );
  assert.equal(applied.tombstones.length, world.tombstones.length);
});

test("terrain claims are recomputed from the hashed DEM", async () => {
  const { world, terrain, candidate } = await fixture();
  const tampered = structuredClone(candidate);
  tampered.proof.route[20].altitudeM += 100;
  const validationWorld = world;
  const verdict = await validateCandidateCommit(tampered, validationWorld, {
    baseCamp: world.baseCamp,
    terrain: terrain.oracle,
  });

  assert.equal(verdict.accepted, false);
  assert.equal(verdict.route?.code, "TERRAIN_MISMATCH");
});

test("an exposed terrain voxel can be quarried and relocated", async () => {
  const { world, terrain, candidate: summitCandidate } = await fixture();
  const pickupIndex = 72;
  const route: RouteSample[] = summitCandidate.proof.route
    .slice(0, pickupIndex + 1)
    .map((sample) => ({ ...sample, safeStop: undefined }));
  const pickup = route.at(-1)!;
  const source = {
    x: Math.floor(pickup.x / TERRAIN.voxelEdgeM),
    y: 0,
    z: Math.floor(pickup.z / TERRAIN.voxelEdgeM),
  };
  source.y = currentTopVoxel(
    terrain.oracle,
    world.removedTerrainVoxels,
    source.x,
    source.z,
  )!;
  const destinationColumn = { x: source.x + 5, z: source.z };
  const releaseColumn = { x: source.x + 1, z: source.z };
  const releaseX = (releaseColumn.x + 0.5) * TERRAIN.voxelEdgeM;
  const releaseZ = (releaseColumn.z + 0.5) * TERRAIN.voxelEdgeM;
  const truth = terrain.oracle.sample(releaseX, releaseZ)!;
  const destinationTop = currentTopVoxel(
    terrain.oracle,
    world.removedTerrainVoxels,
    destinationColumn.x,
    destinationColumn.z,
  )!;
  const releaseIndex = route.length;
  route.push({
    x: releaseX,
    y: truth.y,
    z: releaseZ,
    altitudeM: truth.altitudeM,
    slopeDegrees: truth.slopeDegrees,
    surface: truth.surface,
    mode: truth.slopeDegrees <= 32 ? "WALK" : "SCRAMBLE",
    safeStop: true,
  });
  const candidate: CandidateCommit = {
    protocol: "0.6.0",
    id: "fixture-quarry",
    parentWorldHash: world.worldHash,
    terrainHash: world.terrainHash,
    agentId: "quarry-agent",
    proof: {
      route,
      actions: [
        {
          kind: "RELOCATE",
          matterId: "stone-fixture-quarry",
          source: { kind: "TERRAIN", voxel: source },
          destination: {
            kind: "WORLD",
            cell: {
              x: destinationColumn.x,
              y: destinationTop + 1,
              z: destinationColumn.z,
            },
          },
          pickupIndex,
          releaseIndex,
        },
      ],
    },
  };
  const verdict = await validateCandidateCommit(
    candidate,
    world,
    { baseCamp: world.baseCamp, terrain: terrain.oracle },
  );
  assert.equal(verdict.accepted, true, JSON.stringify(verdict, null, 2));
  const applied = await applyAcceptedCandidate(candidate, world, verdict);
  assert.deepEqual(applied.removedTerrainVoxels, [source]);
  assert.ok(
    applied.stones.some(
      (stone) => stone.id === candidate.proof.actions[0].matterId,
    ),
  );
  assert.equal(applied.expeditions.at(-1)?.action, "QUARRY");
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
        cell: {
          x: Math.floor(blockedSample.x / TERRAIN.voxelEdgeM),
          y: Math.floor(blockedSample.y / TERRAIN.voxelEdgeM),
          z: Math.floor(blockedSample.z / TERRAIN.voxelEdgeM),
        },
      },
    ],
  };
  const validationWorld = competingWorld;
  const verdict = await validateCandidateCommit(candidate, validationWorld, {
    baseCamp: world.baseCamp,
    terrain: terrain.oracle,
  });

  assert.equal(verdict.accepted, false);
  assert.equal(verdict.code, "STALE_CONFLICT");
  assert.equal(verdict.route?.code, "ROUTE_OBSTRUCTED");
  assert.equal(verdict.revalidatedAgainstHead, true);
});
