import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
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
  "candidates/example-agent/first-marker-roundtrip.json";

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
    ["--site", "south-col"],
  );
  const site = JSON.parse(queried.stdout);
  assert.equal(site.site.id, "south-col");
  assert.ok(Number.isFinite(site.localAnchor.x));
  assert.ok(Number.isSafeInteger(site.candidateGroundedCell.cell.y));
  assert.match(site.candidateGroundedCell.note, /planning hint/i);

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
      [exampleCandidate],
    );
    const route = JSON.parse(routeResult.stdout);
    assert.equal(route.accepted, true);
    assert.equal(route.route.outcome, "ACTIVE");

    const checked = await runScript(
      "scripts/validate-expedition.ts",
      [exampleCandidate],
    );
    const verdict = JSON.parse(checked.stdout);
    assert.equal(verdict.accepted, true);
    assert.equal(verdict.code, "ACCEPTED");
    assert.equal(verdict.operation, "ADD");
    assert.equal(verdict.physics.code, "STABLE");
    assert.equal(verdict.scoreBreakdown.survival, 120);
    assert.equal(verdict.scoreBreakdown.repeatPenalty, 0);
    assert.equal(verdict.scoreBreakdown.total, verdict.score);

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
    assert.equal(
      neighborhood.stones[0].id,
      "stone-example-first-marker-roundtrip",
    );
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
