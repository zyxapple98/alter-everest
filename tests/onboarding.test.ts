import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { verifyCandidateFile } from "../scripts/verification";
import { selectFootprintRankingCandidates } from "../lib/footprint-ranking";

const execute = promisify(execFile);
const projectRoot = resolve(".");
const exampleCandidate =
  "examples/example-agent/first-marker-roundtrip.json";
const examplePlan =
  "examples/example-agent/first-marker-plan.json";
const rehearsalWorld =
  "examples/example-agent/rehearsal-world.json";

function runScript(script: string, argumentsList: string[] = []) {
  return execute(
    process.execPath,
    ["--import", "tsx", script, ...argumentsList],
    { cwd: projectRoot },
  );
}

test("onboarding exposes the exact-route player loop", async () => {
  const doctor = JSON.parse(
    (await execute(process.execPath, ["scripts/agent-doctor.mjs"], {
      cwd: projectRoot,
    })).stdout,
  );
  assert.equal(doctor.repositoryComplete, true);
  assert.equal(doctor.readyForInspect, true);

  const inspected = JSON.parse(
    (await runScript("scripts/inspect-world.ts", [
      "--agent",
      "new-climber",
    ])).stdout,
  );
  assert.equal(inspected.protocol, "0.8.0");
  assert.equal(inspected.player.status, "NEW");
  assert.deepEqual(inspected.player.footprint, {
    agentId: "new-climber",
    acceptedExpeditions: 0,
    totalDistanceMillimeters: 0,
    activeTerrainRemovals: 0,
    activeStonePlacements: 0,
    activeAlterations: 0,
  });
  assert.ok(
    inspected.onboarding.nextCommands.some((command: string) =>
      command.includes("route:encode"),
    ),
  );
  assert.ok(
    inspected.onboarding.nextCommands.some((command: string) =>
      command.includes("authority:check -- --fetch"),
    ),
  );
  assert.match(inspected.onboarding.authority, /full local verdict/i);
  assert.equal(
    inspected.onboarding.intentInterview.requiredAfterLocalRehearsal,
    true,
  );
  assert.equal(
    inspected.onboarding.intentInterview.skipWhenHumanAlreadyProvidedIntent,
    true,
  );
  assert.ok(
    inspected.onboarding.intentInterview.exampleIntents.length >= 7,
  );
  assert.ok(
    inspected.onboarding.starterMissions.some(
      (mission: { id: string }) =>
        mission.id === "newcomer-village-foundation",
    ),
  );
  assert.deepEqual(inspected.onboarding.sequence.slice(0, 2), [
    "COMPLETE_LOCAL_REHEARSAL",
    "OBTAIN_HUMAN_INTENT",
  ]);
  assert.equal(
    inspected.playerInterface.docs.intentions,
    "docs/player/INTENTIONS.md",
  );
  assert.equal(inspected.onboarding.rehearsalWorld, rehearsalWorld);

  const site = JSON.parse(
    (await runScript("scripts/query-site.ts", [
      "--site",
      "south-col",
    ])).stdout,
  );
  assert.equal(site.site.id, "south-col");
  assert.ok(Number.isSafeInteger(site.candidateGroundedCell.cell.y));
  assert.ok(site.nearbyOneWayTerminals.samples.length > 0);
  assert.ok(
    Number.isSafeInteger(
      site.nearbyOneWayTerminals.samples[0].exactStance.y,
    ),
  );

  for (const script of [
    "scripts/query-terrain.ts",
    "scripts/query-world.ts",
    "scripts/query-site.ts",
    "scripts/encode-route.ts",
    "scripts/decode-route.ts",
    "scripts/check-move.ts",
    "scripts/check-matter.ts",
    "scripts/check-authority.ts",
    "scripts/evaluate-route.ts",
    "scripts/validate-expedition.ts",
    "scripts/compile-expedition.ts",
  ]) {
    const result = await runScript(script, ["--help"]);
    assert.match(result.stdout, /Usage:/i, script);
  }

  const entry = await readFile(resolve("AGENTS.md"), "utf8");
  assert.match(entry, /complete exact trace/i);
  assert.match(entry, /20 cm grid/i);
  assert.match(entry, /authority:check -- --fetch/);
  assert.match(entry, /human intent handoff/i);
  assert.match(entry, /what would you like this climber/i);

  const intentions = await readFile(
    resolve("docs/player/INTENTIONS.md"),
    "utf8",
  );
  assert.match(intentions, /Newcomer Village foundation/i);
  assert.match(intentions, /villa district/i);
  assert.match(intentions, /toll passage/i);
  assert.match(intentions, /dismantle/i);

  const docsCheck = JSON.parse(
    (await runScript("scripts/check-player-docs.mjs")).stdout,
  );
  assert.equal(docsCheck.valid, true);
});

test("route codec CLI losslessly round-trips exact stances", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ae-route-codec-"));
  const routePath = join(directory, "route.json");
  const encodedPath = join(directory, "encoded.json");
  const decodedPath = join(directory, "decoded.json");
  const authoringRoute = {
    stances: [
      {
        label: "start",
        cell: { x: 10, y: 20, z: 30 },
      },
      {
        label: "finish",
        cell: { x: 11, y: 21, z: 30 },
      },
    ],
    acceptOneWayDeath: true,
  };

  try {
    await writeFile(routePath, JSON.stringify(authoringRoute));
    const encoded = JSON.parse(
      (await runScript("scripts/encode-route.ts", [
        routePath,
        "--out",
        encodedPath,
      ])).stdout,
    );
    assert.equal(encoded.route.codec, "ae-microtrace-v2");
    assert.equal(encoded.route.stepCount, 1);
    assert.deepEqual(encoded.labelSteps, { start: 0, finish: 1 });

    const decodeReceipt = JSON.parse((await runScript("scripts/decode-route.ts", [
      encodedPath,
      "--out",
      decodedPath,
    ])).stdout);
    assert.equal(decodeReceipt.writtenStances, 2);
    assert.equal(Object.hasOwn(decodeReceipt, "stances"), false);
    const decoded = JSON.parse(await readFile(decodedPath, "utf8"));
    assert.equal(decoded.stepCount, 1);
    assert.deepEqual(
      decoded.stances.map(
        (stance: { cell: unknown }) => ({
          cell: stance.cell,
        }),
      ),
      authoringRoute.stances.map(({ cell }) => ({
        cell,
      })),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("labelled exact plans compile without route generation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ae-compile-"));
  const candidateDirectory = join(directory, "example-agent");
  const candidatePath = join(candidateDirectory, "candidate.json");

  try {
    await mkdir(candidateDirectory);
    const summary = JSON.parse(
      (await runScript("scripts/compile-expedition.ts", [
        examplePlan,
        "--world",
        rehearsalWorld,
        "--out",
        candidatePath,
      ])).stdout,
    );
    assert.equal(summary.compiled, true);
    assert.equal(summary.routeCodec, "ae-microtrace-v2");
    assert.equal(summary.routeSteps, 1410);
    assert.deepEqual(summary.bindings[0], {
      action: 1,
      matterId: "stone-example-first-marker-exact",
      pickupAt: "base-pickup",
      pickupStep: 0,
      releaseAt: "marker-release",
      releaseStep: 705,
    });

    const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
    const fixture = JSON.parse(
      await readFile(resolve(rehearsalWorld), "utf8"),
    );
    const verifiedExample = JSON.parse(
      await readFile(resolve(exampleCandidate), "utf8"),
    );
    assert.equal(candidate.parentWorldHash, fixture.worldHash);
    assert.equal(verifiedExample.parentWorldHash, fixture.worldHash);
    assert.equal(candidate.proof.route.stepCount, 1410);
    assert.equal(candidate.proof.actions[0].releaseStep, 705);
    assert.deepEqual(
      candidate.proof.actions,
      verifiedExample.proof.actions,
    );
    assert.equal(
      candidate.proof.route.program,
      verifiedExample.proof.route.program,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the first exact expedition passes preflight, verifier and apply", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ae-first-expedition-"));
  const outputWorld = join(directory, "nested", "world.json");

  try {
    const currentWorld = JSON.parse(
      await readFile(resolve(rehearsalWorld), "utf8"),
    );
    const preflight = JSON.parse(
      (await runScript("scripts/evaluate-route.ts", [
        exampleCandidate,
        "--world",
        rehearsalWorld,
        "--summary",
      ])).stdout,
    );
    assert.equal(preflight.scope, "FULL_READ_ONLY_REPLAY");
    assert.equal(preflight.fullCandidateAccepted, true);
    assert.equal(Object.hasOwn(preflight, "accepted"), false);
    assert.equal(preflight.decodedSteps, 1410);
    assert.equal(preflight.route.distanceMillimeters, 295_586);
    assert.equal(preflight.route.outcome, "ACTIVE");

    const verdict = JSON.parse(
      (await runScript("scripts/validate-expedition.ts", [
        exampleCandidate,
        "--world",
        rehearsalWorld,
        "--diagnose",
      ])).stdout,
    );
    assert.equal(verdict.accepted, true);
    assert.equal(verdict.code, "ACCEPTED");
    assert.equal(verdict.physics.code, "STABLE");
    assert.deepEqual(verdict.footprintDelta, {
      terrainRemovalsCreated: 0,
      stonePlacementsCreated: 1,
      stonePlacementsRemoved: 0,
    });
    assert.equal(verdict.distanceMillimeters, 295_586);

    await runScript("scripts/apply-expedition.ts", [
      exampleCandidate,
      "--world",
      rehearsalWorld,
      "--out",
      outputWorld,
    ]);
    const applied = JSON.parse(await readFile(outputWorld, "utf8"));
    assert.equal(applied.sequence, currentWorld.sequence + 1);
    assert.equal(applied.stones.length, currentWorld.stones.length + 1);
    assert.deepEqual(
      applied.footprints.find(
        (entry: { agentId: string }) =>
          entry.agentId === "example-agent",
      ),
      {
        agentId: "example-agent",
        acceptedExpeditions: 1,
        totalDistanceMillimeters: 295_586,
        activeTerrainRemovals: 0,
        activeStonePlacements: 1,
        activeAlterations: 1,
      },
    );

    const caseInsensitiveProfile = JSON.parse(
      (await runScript("scripts/inspect-world.ts", [
        "--agent",
        "EXAMPLE-AGENT",
        "--world",
        outputWorld,
      ])).stdout,
    );
    assert.equal(caseInsensitiveProfile.player.status, "ACTIVE");
    assert.equal(
      caseInsensitiveProfile.player.footprint.acceptedExpeditions,
      1,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("local candidate paths and malformed JSON objects fail safely", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ae-local-candidate-"));
  const localCandidate = join(directory, "candidate.json");
  const malformedCandidate = join(directory, "malformed.json");
  try {
    await writeFile(
      localCandidate,
      await readFile(resolve(exampleCandidate), "utf8"),
    );
    await writeFile(malformedCandidate, JSON.stringify({}));
    const local = await verifyCandidateFile(localCandidate, {
      worldPath: rehearsalWorld,
    });
    assert.equal(local.accepted, true);
    const malformed = await verifyCandidateFile(malformedCandidate);
    assert.equal(malformed.accepted, false);
    assert.equal(malformed.stage, "SCHEMA");
    assert.match(malformed.errors.join(" "), /agentId|protocol|proof/i);
    const missing = await verifyCandidateFile(
      join(directory, "missing.json"),
    );
    assert.equal(missing.accepted, false);
    assert.equal(missing.stage, "INPUT");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("diagnostics identify the failing physical action and phase", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ae-diagnose-"));
  const candidatePath = join(directory, "occupied-destination.json");
  try {
    const candidate = JSON.parse(
      await readFile(resolve(exampleCandidate), "utf8"),
    );
    candidate.proof.actions[0].destination.cell.y -= 1;
    await writeFile(candidatePath, JSON.stringify(candidate));
    await assert.rejects(
      runScript("scripts/validate-expedition.ts", [
        candidatePath,
        "--world",
        rehearsalWorld,
        "--diagnose",
      ]),
      (error: Error & { stderr?: string }) => {
        const output = JSON.parse(error.stderr ?? "{}");
        assert.equal(output.accepted, false);
        assert.equal(output.physics.code, "DESTINATION_OCCUPIED");
        assert.deepEqual(output.failureContext, {
          stage: "RELEASE_PHYSICS",
          actionIndex: 1,
          step: 705,
        });
        assert.equal(output.diagnostics.actionIndex, 1);
        assert.equal(
          output.diagnostics.actionContext.matterId,
          candidate.proof.actions[0].matterId,
        );
        return true;
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("batch movement, compact terrain and matter transition tools compose", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ae-primitives-"));
  const decodedPath = join(directory, "decoded.json");
  const movesPath = join(directory, "moves.json");
  const mutationPath = join(directory, "mutation.json");
  const chunkPath = join(directory, "chunk.json");
  try {
    await runScript("scripts/decode-route.ts", [
      exampleCandidate,
      "--range",
      "0:1",
      "--out",
      decodedPath,
    ]);
    const decoded = JSON.parse(await readFile(decodedPath, "utf8"));
    const [from, to] = decoded.stances;
    const movement = {
      dx: to.cell.x - from.cell.x,
      dy: to.cell.y - from.cell.y,
      dz: to.cell.z - from.cell.z,
      carrying: true,
    };
    await writeFile(
      movesPath,
      JSON.stringify([
        { label: "first", from: from.cell, movement },
        { label: "same-check", from: from.cell, movement },
      ]),
    );
    const moves = JSON.parse(
      (await runScript("scripts/check-move.ts", [
        "--moves",
        movesPath,
      ])).stdout,
    );
    assert.equal(moves.valid, true);
    assert.equal(moves.count, 2);
    assert.equal(moves.validCount, 2);

    const candidate = JSON.parse(
      await readFile(resolve(exampleCandidate), "utf8"),
    );
    const { pickupStep, releaseStep, ...mutation } =
      candidate.proof.actions[0];
    void pickupStep;
    void releaseStep;
    await writeFile(mutationPath, JSON.stringify(mutation));
    const matter = JSON.parse(
      (await runScript("scripts/check-matter.ts", [
        mutationPath,
        "--world",
        rehearsalWorld,
      ])).stdout,
    );
    assert.equal(matter.valid, true);
    assert.equal(
      matter.scope,
      "ONE_MATTER_TRANSITION_PHYSICS_ONLY",
    );

    const chunkReceipt = JSON.parse(
      (await runScript("scripts/query-terrain.ts", [
        "--chunk",
        "-130:-210",
        "--compact",
        "--out",
        chunkPath,
      ])).stdout,
    );
    assert.equal(chunkReceipt.count, 25_600);
    const chunk = JSON.parse(await readFile(chunkPath, "utf8"));
    assert.equal(chunk.payload.encoding, "ae-surface-columns-v1");
    assert.equal(chunk.payload.topTerrainVoxelY.length, 25_600);
    assert.equal(Object.hasOwn(chunk.payload, "columns"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("terrain observations expose exact cells and provenance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ae-terrain-query-"));
  const cellsPath = join(directory, "cells.json");
  const worldPath = join(directory, "world.json");

  try {
    const world = JSON.parse(
      await readFile(resolve("world/snapshot.json"), "utf8"),
    );
    const removedCell = { x: -20684, y: 43, z: -32729 };
    world.removedTerrainVoxels = [removedCell];
    world.alterations.terrainRemovals = [{
      cell: removedCell,
      agentId: "observation-agent",
      expeditionId: "observation-expedition",
    }];
    await writeFile(worldPath, JSON.stringify(world));
    await writeFile(
      cellsPath,
      JSON.stringify([
        { label: "removed", ...removedCell },
        { label: "plain", x: 0, y: 0, z: 0 },
      ]),
    );
    const result = JSON.parse(
      (await runScript("scripts/query-terrain.ts", [
        "--cells",
        cellsPath,
        "--world",
        worldPath,
      ])).stdout,
    );
    assert.equal(result.count, 2);
    assert.equal(result.payload.cells[0].solidTerrain, false);
    assert.equal(
      result.payload.cells[0].removedTerrain.agentId,
      "observation-agent",
    );
    assert.equal(result.payload.cells[1].removedTerrain, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("observatory feed publishes the canonical footprint model", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ae-feed-"));
  const feedDirectory = join(directory, "feed");

  try {
    await runScript("scripts/build-world-feed.ts", [
      "--world",
      "world/snapshot.json",
      "--output-dir",
      feedDirectory,
    ]);
    const feed = JSON.parse(
      await readFile(join(feedDirectory, "latest.json"), "utf8"),
    );
    const world = JSON.parse(
      await readFile(resolve("world/snapshot.json"), "utf8"),
    );
    assert.equal(feed.schemaVersion, "1.5.0");
    assert.equal(feed.sequence, world.sequence);
    assert.equal(feed.worldHash, world.worldHash);
    const identityStatus = new Map(
      world.identities.map(
        (identity: { id: string; status: "ACTIVE" | "DEAD" }) => [
          identity.id.toLowerCase(),
          identity.status,
        ],
      ),
    );
    const expectedFootprints = selectFootprintRankingCandidates(
      world.footprints.map(
        (footprint: {
          agentId: string;
          acceptedExpeditions: number;
          totalDistanceMillimeters: number;
          activeTerrainRemovals: number;
          activeStonePlacements: number;
          activeAlterations: number;
        }) => ({
          ...footprint,
          agent: footprint.agentId,
          outcome:
            identityStatus.get(footprint.agentId.toLowerCase()) ??
            "ACTIVE",
        }),
      ),
    );
    assert.deepEqual(feed.footprints, expectedFootprints);
    assert.equal(
      feed.recentExpeditions.length,
      Math.min(100, world.expeditions.length),
    );
    assert.equal(
      feed.worldSummary.expeditionCount,
      world.expeditions.length,
    );
    assert.equal(
      feed.worldSummary.removedTerrainVoxelCount,
      world.removedTerrainVoxels.length,
    );
    assert.equal(feed.worldSummary.stoneCount, world.stones.length);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
