import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  buildContributionComment,
  parseBuildThreadReference,
} from "../scripts/record-build-contribution.mjs";

const execute = promisify(execFile);
const projectRoot = resolve(".");

const canonicalEvent = {
  eventVersion: "1.2.0",
  sequence: 6320,
  eventHash: "e".repeat(64),
  candidateId: "sunrise-course-2",
  candidateHash: "c".repeat(64),
  agentId: "example-agent",
  parentWorldHash: "a".repeat(64),
  worldHash: "b".repeat(64),
  terrainHash: "d".repeat(64),
  engineHash: "f".repeat(64),
  action: "MULTI",
  actions: ["ADD", "MOVE", "MOVE"],
  actionCount: 3,
  stoneIds: ["sunrise-1", "sunrise-2", "sunrise-3"],
  outcome: "ACTIVE",
  altitudeM: 7312,
  enduranceUsed: 41.235,
  energyKj: 18555,
  distanceMillimeters: 318_400,
  alterationDelta: {
    terrainRemovalsCreated: 0,
    stonePlacementsCreated: 3,
    stonePlacementsRemoved: 2,
  },
  proofArtifact: "world/proofs/example.json",
  traceArtifact: null,
  receiptKeyId: "test",
};

test("Build-Thread references are explicit and repository-local", () => {
  assert.equal(
    parseBuildThreadReference(
      "Build-Thread: #42",
      "example/alter-everest",
    ),
    42,
  );
  assert.equal(
    parseBuildThreadReference(
      [
        "Build-Thread: https://github.com/example/alter-everest/discussions/42",
        "Build-Thread: #42",
      ].join("\n"),
      "example/alter-everest",
    ),
    42,
  );
  assert.equal(
    parseBuildThreadReference(
      "Build-Thread: <!-- optional -->",
      "example/alter-everest",
    ),
    null,
  );
  assert.throws(
    () =>
      parseBuildThreadReference(
        "Build-Thread: https://github.com/other/repo/discussions/42",
        "example/alter-everest",
      ),
    /must reference a Discussion in example\/alter-everest/,
  );
  assert.throws(
    () =>
      parseBuildThreadReference(
        "Build-Thread: #42\nBuild-Thread: #43",
        "example/alter-everest",
      ),
    /at most one/,
  );
});

test("Build contribution comments distinguish world truth from coordination", () => {
  const body = buildContributionComment({
    event: canonicalEvent,
    eventPath: resolve("world/events/000006320-sunrise-course-2.json"),
    repository: "example/alter-everest",
    pullRequest: {
      number: 91,
      html_url: "https://github.com/example/alter-everest/pull/91",
      base: { ref: "main" },
    },
    root: projectRoot,
  });

  assert.match(
    body,
    /alter-everest-build-contribution:e{64}/,
  );
  assert.match(body, /ADD · MOVE × 2/);
  assert.match(body, /41\.24/);
  assert.match(body, /canonical world event is authoritative/i);
  assert.match(body, /world\/events\/000006320-sunrise-course-2\.json/);
});

test("accepted expeditions are reported once to a Builds Discussion", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alter-everest-build-"));
  const eventsDirectory = join(directory, "events");
  let recordedBody = "";
  let mutationCount = 0;

  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    const url = new URL(request.url ?? "/", "http://localhost");

    if (url.pathname.endsWith("/repos/example/alter-everest/pulls/91")) {
      response.end(
        JSON.stringify({
          number: 91,
          body: "Build-Thread: #42",
          html_url: "https://github.com/example/alter-everest/pull/91",
          user: { login: "example-agent" },
          base: { ref: "main" },
        }),
      );
      return;
    }

    if (url.pathname === "/graphql") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (payload.query.includes("query BuildDiscussion")) {
        response.end(
          JSON.stringify({
            data: {
              repository: {
                discussion: {
                  id: "discussion-node-42",
                  number: 42,
                  url: "https://github.com/example/alter-everest/discussions/42",
                  title: "[BUILD] Sunrise settlement",
                  closed: false,
                  category: { slug: "builds" },
                  comments: {
                    nodes: recordedBody ? [{ body: recordedBody }] : [],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              },
            },
          }),
        );
        return;
      }
      if (payload.query.includes("mutation RecordBuildContribution")) {
        mutationCount += 1;
        recordedBody = payload.variables.body;
        response.end(
          JSON.stringify({
            data: {
              addDiscussionComment: {
                comment: {
                  url: "https://github.com/example/alter-everest/discussions/42#discussioncomment-1",
                },
              },
            },
          }),
        );
        return;
      }
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ message: "not found" }));
  });

  try {
    await mkdir(eventsDirectory);
    await writeFile(
      join(eventsDirectory, "000006320-sunrise-course-2.json"),
      JSON.stringify(canonicalEvent),
    );
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    const environment = {
      ...process.env,
      GITHUB_REPOSITORY: "example/alter-everest",
      GITHUB_TOKEN: "test-token",
      GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
      GITHUB_GRAPHQL_URL: `http://127.0.0.1:${address.port}/graphql`,
    };
    const argumentsList = [
      "scripts/record-build-contribution.mjs",
      "--pull",
      "91",
      "--candidate-hash",
      canonicalEvent.candidateHash,
      "--events-dir",
      eventsDirectory,
    ];

    const first = await execute(process.execPath, argumentsList, {
      cwd: projectRoot,
      env: environment,
    });
    assert.match(first.stdout, /"idempotent": false/);
    assert.match(recordedBody, /sunrise-course-2/);
    assert.equal(mutationCount, 1);

    const replay = await execute(process.execPath, argumentsList, {
      cwd: projectRoot,
      env: environment,
    });
    assert.match(replay.stdout, /"idempotent": true/);
    assert.equal(mutationCount, 1);
  } finally {
    await new Promise<void>((resolveClose, rejectClose) =>
      server.close((error) =>
        error ? rejectClose(error) : resolveClose(),
      ),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
