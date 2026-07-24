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
  worldForCandidate,
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

  const validationWorld = worldForCandidate(world, terrain, candidate);
  const verdict = await validateCandidateCommit(candidate, validationWorld, {
    baseCamp: world.baseCamp,
    terrain: terrain.oracle,
  });

  assert.equal(verdict.accepted, true, JSON.stringify(verdict, null, 2));
  assert.equal(verdict.physics?.code, "STABLE");
  assert.equal(verdict.route?.outcome, "DEAD");
  assert.ok((verdict.route?.enduranceUsed ?? 101) < 100);
  assert.ok(candidate.proof.route[candidate.proof.releaseIndex!].altitudeM > 8_700);

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
    worldForCandidate(applied, terrain, candidate),
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
  const topVoxel = currentTopVoxel(
    terrain.oracle,
    world.removedTerrainVoxels,
    columnX,
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
      releaseIndex,
      mutation: {
        kind: "RELOCATE",
        matterId: "stone-fixture-lower-roundtrip",
        source: { kind: "BASE" },
        destination: {
          kind: "WORLD",
          releasePose: {
            translation: {
              x: (columnX + 0.5) * TERRAIN.voxelEdgeM,
              y: (topVoxel + 1) * TERRAIN.voxelEdgeM + 0.1,
              z: (columnZ + 0.5) * TERRAIN.voxelEdgeM,
            },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
          },
        },
      },
    },
  };
  candidate.proof.route[candidate.proof.route.length - 1] = {
    ...candidate.proof.route.at(-1)!,
    safeStop: true,
  };
  const validationWorld = worldForCandidate(world, terrain, candidate);
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
  const validationWorld = worldForCandidate(world, terrain, tampered);
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
  const destinationColumn = { x: source.x + 2, z: source.z };
  const destinationX =
    (destinationColumn.x + 0.5) * TERRAIN.voxelEdgeM;
  const destinationZ =
    (destinationColumn.z + 0.5) * TERRAIN.voxelEdgeM;
  const truth = terrain.oracle.sample(destinationX, destinationZ)!;
  const destinationTop = currentTopVoxel(
    terrain.oracle,
    world.removedTerrainVoxels,
    destinationColumn.x,
    destinationColumn.z,
  )!;
  const releaseIndex = route.length;
  route.push({
    x: destinationX,
    y: truth.y,
    z: destinationZ,
    altitudeM: truth.altitudeM,
    slopeDegrees: truth.slopeDegrees,
    surface: truth.surface,
    mode: truth.slopeDegrees <= 32 ? "WALK" : "SCRAMBLE",
    safeStop: true,
  });
  const candidate: CandidateCommit = {
    protocol: "0.4.0",
    id: "fixture-quarry",
    parentWorldHash: world.worldHash,
    terrainHash: world.terrainHash,
    agentId: "quarry-agent",
    proof: {
      route,
      pickupIndex,
      releaseIndex,
      mutation: {
        kind: "RELOCATE",
        matterId: "stone-fixture-quarry",
        source: { kind: "TERRAIN", voxel: source },
        destination: {
          kind: "WORLD",
          releasePose: {
            translation: {
              x: destinationX,
              y:
                (destinationTop + 1) * TERRAIN.voxelEdgeM +
                TERRAIN.voxelEdgeM / 2,
              z: destinationZ,
            },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
          },
        },
      },
    },
  };
  const verdict = await validateCandidateCommit(
    candidate,
    worldForCandidate(world, terrain, candidate),
    { baseCamp: world.baseCamp, terrain: terrain.oracle },
  );
  assert.equal(verdict.accepted, true, JSON.stringify(verdict, null, 2));
  const applied = await applyAcceptedCandidate(candidate, world, verdict);
  assert.deepEqual(applied.removedTerrainVoxels, [source]);
  assert.ok(
    applied.stones.some((stone) => stone.id === candidate.proof.mutation.matterId),
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
