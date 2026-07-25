import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  copyFile,
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

const execute = promisify(execFile);
const projectRoot = resolve(".");
const exampleCandidate =
  "examples/example-agent/first-marker-roundtrip.json";

function runScript(script: string, argumentsList: string[] = []) {
  return execute(
    process.execPath,
    ["--import", "tsx", script, ...argumentsList],
    { cwd: projectRoot },
  );
}

test("agent entrypoints expose gameplay before collaboration", async () => {
  const inspected = await runScript("scripts/inspect-world.ts");
  const inspection = JSON.parse(inspected.stdout);
  assert.equal(
    inspection.onboarding.verifiedExample,
    exampleCandidate,
  );
  assert.match(inspection.onboarding.authority, /full local verdict/i);
  assert.equal(
    inspection.onboarding.gameplayChoices[0].operation,
    "ADD",
  );

  const queried = await runScript(
    "scripts/query-site.ts",
    [
      "--site",
      "south-col",
      "--world",
      "world/snapshot.json",
    ],
  );
  const site = JSON.parse(queried.stdout);
  assert.equal(site.site.id, "south-col");
  assert.ok(Number.isFinite(site.localAnchor.x));
  assert.ok(Number.isSafeInteger(site.candidateGroundedCell.cell.y));
  assert.match(site.candidateGroundedCell.note, /planning hint/i);
  assert.ok(site.nearbySafeStops.samples.length > 0);
  assert.ok(
    site.nearbySafeStops.samples.every(
      (sample: { slopeDegrees: number }) =>
        sample.slopeDegrees <=
        site.nearbySafeStops.maximumWalkSlopeDegrees,
    ),
  );
  assert.doesNotMatch(site.next[0], /undefined/);
  assert.match(site.next[0], /--radius 110/);
  assert.match(site.next[0], /--world/);

  const sharedInspection = await runScript(
    "scripts/inspect-world.ts",
    ["--world", "world/snapshot.json"],
  );
  const sharedNext = JSON.parse(sharedInspection.stdout).onboarding
    .nextCommands;
  assert.ok(
    sharedNext
      .filter((command: string) => command !== sharedNext[3])
      .every((command: string) => /--world/.test(command)),
  );

  const playerInspection = await runScript(
    "scripts/inspect-world.ts",
    ["--agent", "northstar-17"],
  );
  const player = JSON.parse(playerInspection.stdout).player;
  assert.equal(player.status, "DEAD");
  assert.equal(player.expeditionCount, 1);
  assert.equal(player.tombstones.length, 1);

  const terrainHelp = await runScript(
    "scripts/query-terrain.ts",
    ["--help"],
  );
  assert.match(terrainHelp.stdout, /Usage: npm run terrain:query/);
  const siteHelp = await runScript("scripts/query-site.ts", ["--help"]);
  assert.match(siteHelp.stdout, /--world <snapshot\.json>/);

  const onboarding = await readFile(
    resolve("docs/AGENT-ONBOARDING.md"),
    "utf8",
  );
  assert.match(onboarding, /FIRST-EXPEDITION\.md/);
  assert.match(onboarding, /First choose a physical play/);
});

test("route annotation fills terrain without choosing the path", async () => {
  const outputDirectory = await mkdtemp(
    join(tmpdir(), "alter-everest-route-annotation-"),
  );
  const waypointsPath = join(outputDirectory, "waypoints.json");
  const routePath = join(outputDirectory, "route.json");

  try {
    await writeFile(
      waypointsPath,
      JSON.stringify([
        {
          x: -4136.384339074745,
          z: -6705.793111111192,
          mode: "SCRAMBLE",
        },
        {
          x: -4096.384339074745,
          z: -6705.793111111192,
          mode: "SCRAMBLE",
          safeStop: true,
        },
      ]),
    );
    await runScript(
      "scripts/annotate-route.ts",
      [waypointsPath, "--out", routePath],
    );
    const route = JSON.parse(await readFile(routePath, "utf8"));
    assert.equal(route.length, 2);
    assert.equal(route[0].surface, "ROCK");
    assert.ok(Number.isFinite(route[0].altitudeM));
    assert.equal(route[1].safeStop, true);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("terrain queries accept a labelled point batch", async () => {
  const outputDirectory = await mkdtemp(
    join(tmpdir(), "alter-everest-terrain-batch-"),
  );
  const pointsPath = join(outputDirectory, "points.json");

  try {
    await writeFile(
      pointsPath,
      JSON.stringify([
        { label: "camp", x: -4136.38, z: -6705.79 },
        { label: "west", x: -4296.38, z: -6705.79 },
      ]),
    );
    const queried = await runScript(
      "scripts/query-terrain.ts",
      ["--points", pointsPath, "--summary"],
    );
    const batch = JSON.parse(queried.stdout);
    assert.equal(batch.count, 2);
    assert.deepEqual(
      batch.results.map(
        (result: { label: string }) => result.label,
      ),
      ["camp", "west"],
    );
    assert.ok(
      batch.results.every(
        (result: { candidateGroundedCell: { cell: unknown } }) =>
          result.candidateGroundedCell.cell,
      ),
    );
    assert.equal(batch.results[0].measured, undefined);
    assert.ok(Number.isFinite(batch.results[0].terrain.altitudeM));
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("the first local expedition passes route, verifier and apply", async () => {
  const outputDirectory = await mkdtemp(
    join(tmpdir(), "alter-everest-first-expedition-"),
  );
  const outputWorld = join(outputDirectory, "world-after.json");

  try {
    const currentWorld = JSON.parse(
      await readFile(resolve("world/snapshot.json"), "utf8"),
    );
    const routeResult = await runScript(
      "scripts/evaluate-route.ts",
      [exampleCandidate, "--summary"],
    );
    const route = JSON.parse(routeResult.stdout);
    assert.equal(route.scope, "ROUTE_PREFLIGHT_ONLY");
    assert.equal(route.preflightAccepted, true);
    assert.equal(route.fullCandidateAccepted, null);
    assert.equal(route.endurance.segments, undefined);
    assert.equal(route.endurance.segmentCount, 8);
    assert.equal(route.route.outcome, "ACTIVE");

    const checked = await runScript(
      "scripts/validate-expedition.ts",
      [exampleCandidate, "--diagnose"],
    );
    const verdict = JSON.parse(checked.stdout);
    assert.equal(verdict.accepted, true);
    assert.equal(verdict.code, "ACCEPTED");
    assert.equal(verdict.actionableCode, "ACCEPTED");
    assert.equal(verdict.operation, "ADD");
    assert.equal(verdict.physics.code, "STABLE");
    assert.equal(verdict.scoreBreakdown.survival, 120);
    assert.equal(verdict.scoreBreakdown.repeatPenalty, 0);
    assert.equal(verdict.scoreBreakdown.total, verdict.score);
    assert.equal(verdict.diagnostics.valid, true);
    assert.equal(verdict.diagnostics.stage, "ALL_PHASES_CLEAR");

    await runScript(
      "scripts/apply-expedition.ts",
      [exampleCandidate, "--out", outputWorld],
    );
    const applied = JSON.parse(await readFile(outputWorld, "utf8"));
    assert.equal(applied.sequence, currentWorld.sequence + 1);
    assert.equal(applied.stones.length, currentWorld.stones.length + 1);
    assert.deepEqual(
      applied.identities.find(
        (identity: { id: string }) =>
          identity.id === "example-agent",
      ),
      { id: "example-agent", status: "ACTIVE" },
    );
    assert.equal(
      applied.tombstones.some(
        (entry: { agentId: string }) =>
          entry.agentId === "example-agent",
      ),
      false,
    );

    const queried = await runScript(
      "scripts/query-world.ts",
      [
        "--x",
        "-3976.3",
        "--z",
        "-6705.7",
        "--radius",
        "5",
        "--world",
        outputWorld,
      ],
    );
    const neighborhood = JSON.parse(queried.stdout);
    assert.equal(neighborhood.counts.stones, 1);
    assert.ok(Array.isArray(neighborhood.faceConnectedStoneGroups));
    assert.equal(
      neighborhood.stones[0].id,
      "stone-example-first-marker-roundtrip",
    );
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("route preflight and diagnostics honor world state and phase indices", async () => {
  const outputDirectory = await mkdtemp(
    join(tmpdir(), "alter-everest-route-diagnostics-"),
  );
  const changedWorldPath = join(outputDirectory, "changed-world.json");
  const changedCandidatePath = join(
    outputDirectory,
    "example-agent",
    "changed-candidate.json",
  );

  try {
    const [world, candidate] = await Promise.all([
      readFile(resolve("world/snapshot.json"), "utf8").then(JSON.parse),
      readFile(resolve(exampleCandidate), "utf8").then(JSON.parse),
    ]);
    const first = candidate.proof.route[0];
    const terrainQuery = await runScript("scripts/query-terrain.ts", [
      "--x",
      String(first.x),
      "--z",
      String(first.z),
    ]);
    const exposed = JSON.parse(terrainQuery.stdout).exposedVoxel;
    world.removedTerrainVoxels.push(
      ...Array.from({ length: 6 }, (_, offset) => ({
        x: exposed.x,
        y: exposed.y - offset,
        z: exposed.z,
      })),
    );
    await writeFile(changedWorldPath, JSON.stringify(world));

    const preflight = await runScript("scripts/evaluate-route.ts", [
      exampleCandidate,
      "--world",
      changedWorldPath,
      "--summary",
    ]);
    assert.equal(JSON.parse(preflight.stdout).terrain.valid, false);

    candidate.proof.route[2] = {
      ...candidate.proof.route[2],
      y: candidate.proof.route[2].y + 5,
      altitudeM: candidate.proof.route[2].altitudeM + 5,
    };
    await mkdir(join(outputDirectory, "example-agent"));
    await writeFile(changedCandidatePath, JSON.stringify(candidate));
    const diagnosed = await runScript("scripts/validate-expedition.ts", [
      changedCandidatePath,
      "--diagnose",
    ]).catch((error: { stderr: string }) => ({
      stdout: error.stderr,
    }));
    const diagnosticVerdict = JSON.parse(diagnosed.stdout);
    assert.ok(
      diagnosticVerdict.diagnostics,
      JSON.stringify(diagnosticVerdict),
    );
    assert.equal(
      diagnosticVerdict.diagnostics.terrain.globalSampleIndex,
      2,
    );
    assert.deepEqual(
      diagnosticVerdict.diagnostics.terrain.sample,
      candidate.proof.route[2],
    );

    const oneWayPath = join(
      outputDirectory,
      "example-agent",
      "one-way.json",
    );
    const oneWayCandidate = JSON.parse(
      await readFile(resolve(exampleCandidate), "utf8"),
    );
    const finalReleaseIndex =
      oneWayCandidate.proof.actions[0].releaseIndex;
    oneWayCandidate.id = "example-first-marker-one-way";
    oneWayCandidate.proof.route = oneWayCandidate.proof.route.slice(
      0,
      finalReleaseIndex + 1,
    );
    await writeFile(oneWayPath, JSON.stringify(oneWayCandidate));
    const oneWay = await runScript(
      "scripts/validate-expedition.ts",
      [oneWayPath, "--diagnose"],
    ).catch((error: { stderr: string }) => ({
      stdout: error.stderr,
    }));
    const oneWayVerdict = JSON.parse(oneWay.stdout);
    assert.equal(oneWayVerdict.diagnostics.valid, true);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("world query completes connected groups beyond its radius", async () => {
  const outputDirectory = await mkdtemp(
    join(tmpdir(), "alter-everest-world-groups-"),
  );
  const worldPath = join(outputDirectory, "world.json");
  try {
    const world = JSON.parse(
      await readFile(resolve("world/snapshot.json"), "utf8"),
    );
    world.stones.push(
      {
        id: "boundary-group-a",
        cell: { x: 5000, y: 0, z: -6000 },
      },
      {
        id: "boundary-group-b",
        cell: { x: 5001, y: 0, z: -6000 },
      },
    );
    await writeFile(worldPath, JSON.stringify(world));
    const queried = await runScript("scripts/query-world.ts", [
      "--x",
      "1000.1",
      "--z",
      "-1199.9",
      "--radius",
      "0.15",
      "--world",
      worldPath,
    ]);
    const result = JSON.parse(queried.stdout);
    assert.equal(result.counts.stones, 1);
    assert.equal(result.faceConnectedStoneGroups[0].stoneCount, 2);
    assert.equal(result.faceConnectedStoneGroups[0].localStoneCount, 1);
    assert.equal(result.faceConnectedStoneGroups[0].extendsBeyondQuery, true);
    assert.equal(result.faceConnectedStoneGroups[0].complete, true);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("a local applied world can become an isolated observatory feed", async () => {
  const outputDirectory = await mkdtemp(
    join(tmpdir(), "alter-everest-playtest-feed-"),
  );
  const inputWorld = join(outputDirectory, "world.json");
  const feedDirectory = join(outputDirectory, "feed");

  try {
    await copyFile(resolve("world/snapshot.json"), inputWorld);
    const source = JSON.parse(await readFile(inputWorld, "utf8"));
    const generated = await runScript(
      "scripts/build-world-feed.ts",
      [
        "--world",
        inputWorld,
        "--output-dir",
        feedDirectory,
      ],
    );
    assert.match(generated.stdout, /from .*world\.json/);

    const feed = JSON.parse(
      await readFile(join(feedDirectory, "latest.json"), "utf8"),
    );
    assert.equal(feed.sequence, source.sequence);
    assert.deepEqual(
      feed.recentExpeditions.map(
        (expedition: { id: string }) => expedition.id,
      ),
      source.expeditions
        .slice(-3)
        .reverse()
        .map((expedition: { id: string }) => expedition.id),
    );
    assert.ok(Array.isArray(feed.surfaceTiles.tiles));
    assert.deepEqual(feed.worldSummary, {
      stoneCount: source.stones.length,
      removedTerrainVoxelCount: source.removedTerrainVoxels.length,
      identityCount: source.identities.length,
      activeIdentityCount: source.identities.filter(
        (identity: { status: string }) => identity.status === "ACTIVE",
      ).length,
      deadIdentityCount: source.identities.filter(
        (identity: { status: string }) => identity.status === "DEAD",
      ).length,
      tombstoneCount: source.tombstones.length,
      expeditionCount: source.expeditions.length,
      modifiedTileCount: feed.surfaceTiles.tiles.length,
    });
    assert.ok(
      feed.recentExpeditions.every(
        (expedition: { trace: unknown }) => expedition.trace === null,
      ),
    );
    const badges = JSON.parse(
      await readFile(join(feedDirectory, "badges.json"), "utf8"),
    );
    assert.equal(badges.worldSequence, source.sequence);
    assert.equal(
      badges.highestExpeditionAltitudeM,
      badges.highestAltitudeM,
    );
    assert.equal(
      badges.currentHighestAltitudeM,
      Math.round(feed.currentHighestPoint.altitudeM),
    );

    const emptyWorld = {
      ...source,
      identities: [],
      tombstones: [],
      expeditions: [],
    };
    const emptyWorldPath = join(outputDirectory, "empty-world.json");
    const emptyFeedDirectory = join(outputDirectory, "empty-feed");
    await writeFile(emptyWorldPath, JSON.stringify(emptyWorld));
    await runScript("scripts/build-world-feed.ts", [
      "--world",
      emptyWorldPath,
      "--output-dir",
      emptyFeedDirectory,
    ]);
    const emptyFeed = JSON.parse(
      await readFile(join(emptyFeedDirectory, "latest.json"), "utf8"),
    );
    assert.deepEqual(emptyFeed.recentExpeditions, []);
    assert.equal(emptyFeed.worldSummary.expeditionCount, 0);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
