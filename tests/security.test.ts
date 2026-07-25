import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { PHYSICS } from "../engine/constants";
import type { ReceiptBody } from "../lib/receipt";
import {
  signReceiptBody,
  verifyReceiptSignature,
} from "../lib/receipt";
import { CANDIDATE_LIMITS, validateCandidateShape } from "../lib/protocol";
import { computeVerifierHash } from "../scripts/verifier-integrity";

const execute = promisify(execFile);
const projectRoot = resolve(".");

test("public resource manifest matches enforced physics bounds", () => {
  assert.equal(
    CANDIDATE_LIMITS.maximumTouchedStones,
    PHYSICS.maximumAffectedStoneCells,
  );
  assert.equal(CANDIDATE_LIMITS.maximumBaseWithdrawals, 1);
});

test("release manifest names the exact protected verifier source", async () => {
  const release = JSON.parse(
    await readFile(resolve("protocol/release.json"), "utf8"),
  );
  assert.equal(release.verifierSourceSha256, await computeVerifierHash());
  assert.match(release.baseImage, /@sha256:[a-f0-9]{64}$/);
});

function signingKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey: privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64"),
    publicKey: publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64"),
  };
}

test("signed verifier receipts reject result tampering", () => {
  const body: ReceiptBody = {
    receiptVersion: "1.2.0",
    candidateHash: "a".repeat(64),
    candidateId: "candidate-1",
    agentId: "agent-1",
    canonicalParent: "world-1",
    terrainHash: "b".repeat(64),
    engineHash: "c".repeat(64),
    issuedAt: "2026-07-24T00:00:00.000Z",
    result: {
      accepted: true,
      code: "ACCEPTED",
      action: "ADD",
      actions: ["ADD"],
      actionCount: 1,
      stoneIds: ["stone-1"],
      outcome: "ACTIVE",
      enduranceUsed: 20,
      energyKj: 1000,
      score: 250,
      physicsCode: "STABLE",
      affectedStoneIds: ["stone-1"],
    },
  };
  const keys = signingKeys();
  const receipt = signReceiptBody(body, keys.privateKey);
  assert.equal(verifyReceiptSignature(receipt, keys.publicKey), true);

  const tampered = structuredClone(receipt);
  tampered.result.score = 999_999;
  assert.equal(verifyReceiptSignature(tampered, keys.publicKey), false);
});

test("candidate shape limits reject oversized and extended proofs", () => {
  const route = Array.from(
    { length: CANDIDATE_LIMITS.maximumRouteSamples + 1 },
    (_, index) => ({
      x: index,
      y: 0,
      z: 0,
      altitudeM: 5350,
      slopeDegrees: 0,
      surface: "ROCK",
      mode: "WALK",
    }),
  );
  const result = validateCandidateShape({
    protocol: "0.6.0",
    id: "candidate-1",
    parentWorldHash: "world-1",
    terrainHash: "a".repeat(64),
    agentId: "agent-1",
    proof: {
      route,
      actions: [
        {
          kind: "RELOCATE",
          matterId: "stone-1",
          source: { kind: "BASE" },
          destination: {
            kind: "WORLD",
            cell: { x: 400, y: 0, z: 0 },
          },
          pickupIndex: 0,
          releaseIndex: 1,
        },
      ],
      executable: "never",
    },
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.includes("at most")));
  assert.ok(result.errors.some((entry) => entry.includes("unsupported")));
});

test("BASE to BASE is rejected before route execution", () => {
  const result = validateCandidateShape({
    protocol: "0.6.0",
    id: "base-noop",
    parentWorldHash: "world-1",
    terrainHash: "a".repeat(64),
    agentId: "agent-1",
    proof: {
      route: [
        {
          x: 0,
          y: 0,
          z: 0,
          altitudeM: 5259,
          slopeDegrees: 0,
          surface: "ROCK",
          mode: "WALK",
        },
        {
          x: 1,
          y: 0,
          z: 0,
          altitudeM: 5259,
          slopeDegrees: 0,
          surface: "ROCK",
          mode: "WALK",
        },
      ],
      actions: [
        {
          kind: "RELOCATE",
          matterId: "stone-noop",
          source: { kind: "BASE" },
          destination: { kind: "BASE" },
          pickupIndex: 0,
          releaseIndex: 1,
        },
      ],
    },
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("proof.actions contains an invalid action"));
});

test("the reducer writes one signed event and is idempotent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alter-everest-reducer-"));
  const snapshot = join(directory, "snapshot.json");
  const events = join(directory, "events");
  const receipts = join(directory, "receipts");
  const proofs = join(directory, "proofs");
  const candidate = resolve(
    "tests/fixtures/everest-one-way-candidate.json",
  );
  const genesisWorld = resolve("tests/fixtures/genesis-world.json");
  const keys = signingKeys();

  try {
    await copyFile(genesisWorld, snapshot);
    const environment = {
      ...process.env,
      VERIFIER_PRIVATE_KEY_PKCS8_BASE64: keys.privateKey,
    };
    const argumentsList = [
      "--import",
      "tsx",
      "scripts/reduce-expedition.ts",
      candidate,
      "--world",
      snapshot,
      "--out",
      snapshot,
      "--events-dir",
      events,
      "--receipts-dir",
      receipts,
      "--proofs-dir",
      proofs,
      "--expected-agent",
      "example-agent",
      "--require-signature",
    ];

    const first = await execute(process.execPath, argumentsList, {
      cwd: projectRoot,
      env: environment,
    });
    assert.match(first.stdout, /"idempotent": false/);

    const nextWorld = JSON.parse(await readFile(snapshot, "utf8"));
    assert.equal(nextWorld.sequence, 6319);
    assert.match(nextWorld.worldHash, /^[a-f0-9]{64}$/);

    const [eventName] = await readdir(events);
    const [receiptName] = await readdir(receipts);
    const event = JSON.parse(
      await readFile(join(events, eventName), "utf8"),
    );
    const receipt = JSON.parse(
      await readFile(join(receipts, receiptName), "utf8"),
    );
    assert.equal(event.sequence, 6319);
    assert.equal(event.candidateHash, receipt.candidateHash);
    assert.equal(verifyReceiptSignature(receipt, keys.publicKey), true);

    const originalWorld = await readFile(genesisWorld);
    await writeFile(snapshot, originalWorld);
    const recovered = await execute(process.execPath, argumentsList, {
      cwd: projectRoot,
      env: environment,
    });
    assert.match(recovered.stdout, /"idempotent": false/);

    const second = await execute(process.execPath, argumentsList, {
      cwd: projectRoot,
      env: environment,
    });
    assert.match(second.stdout, /"idempotent": true/);
    assert.equal((await readdir(events)).length, 1);
    assert.equal((await readdir(proofs)).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("PR admission downloads one JSON blob without checking out PR code", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alter-everest-admission-"));
  const eventPath = join(directory, "event.json");
  const outputPath = join(directory, "candidate.json");
  const eventsDirectory = join(directory, "events");
  const candidateBytes = await readFile(
    resolve("tests/fixtures/everest-one-way-candidate.json"),
  );
  let admissionArtifacts = [
    {
      id: 1,
      expired: false,
      created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      workflow_run: { head_sha: "other-head-1" },
    },
    {
      id: 2,
      expired: false,
      created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      workflow_run: { head_sha: "other-head-2" },
    },
  ];
  let changedFiles = [
    {
      filename: "candidates/example-agent/test.json",
      status: "added",
    },
  ];

  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname.endsWith("/pulls/7/files")) {
      response.end(JSON.stringify(changedFiles));
      return;
    }
    if (
      url.pathname.endsWith(
        "/actions/artifacts",
      )
    ) {
      response.end(
        JSON.stringify({
          total_count: admissionArtifacts.length,
          artifacts: admissionArtifacts,
        }),
      );
      return;
    }
    if (url.pathname === "/search/issues") {
      response.end(JSON.stringify({ items: [{ number: 7 }] }));
      return;
    }
    if (
      url.pathname.endsWith(
        "/contents/candidates/example-agent/test.json",
      )
    ) {
      response.end(
        JSON.stringify({
          type: "file",
          encoding: "base64",
          size: candidateBytes.byteLength,
          sha: "git-blob-sha",
          content: candidateBytes.toString("base64"),
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ message: "not found" }));
  });

  try {
    await mkdir(eventsDirectory);
    await writeFile(
      eventPath,
      JSON.stringify({
        repository: { full_name: "example/repo" },
        pull_request: {
          number: 7,
          user: { login: "example-agent" },
          head: { sha: "head-sha" },
        },
      }),
    );
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    const accepted = await execute(
      process.execPath,
      [
        "scripts/admit-candidate-pr.mjs",
        "--event",
        eventPath,
        "--out",
        outputPath,
      ],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          GITHUB_RUN_ID: "",
          GITHUB_TOKEN: "test-token",
          GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
        },
      },
    );
    assert.match(accepted.stdout, /"admitted": true/);
    assert.deepEqual(await readFile(outputPath), candidateBytes);

    const rateChecked = await execute(
      process.execPath,
      [
        "scripts/admit-candidate-pr.mjs",
        "--event",
        eventPath,
        "--out",
        join(directory, "rate-checked.json"),
      ],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          GITHUB_RUN_ID: "999",
          GITHUB_RUN_ATTEMPT: "1",
          GITHUB_TOKEN: "test-token",
          GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
        },
      },
    );
    assert.match(rateChecked.stdout, /"admitted": true/);

    admissionArtifacts = [
      {
        id: 3,
        expired: false,
        created_at: new Date(Date.now() - 60 * 1000).toISOString(),
        workflow_run: { head_sha: "head-sha" },
      },
    ];
    await assert.rejects(
      execute(
        process.execPath,
        [
          "scripts/admit-candidate-pr.mjs",
          "--event",
          eventPath,
          "--out",
          join(directory, "duplicate-head.json"),
        ],
        {
          cwd: projectRoot,
          env: {
            ...process.env,
            GITHUB_RUN_ID: "998",
            GITHUB_RUN_ATTEMPT: "1",
            GITHUB_TOKEN: "test-token",
            GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
          },
        },
      ),
      /exact candidate head already started/,
    );

    await assert.rejects(
      execute(
        process.execPath,
        [
          "scripts/admit-candidate-pr.mjs",
          "--event",
          eventPath,
          "--out",
          join(directory, "rerun.json"),
        ],
        {
          cwd: projectRoot,
          env: {
            ...process.env,
            GITHUB_RUN_ID: "999",
            GITHUB_RUN_ATTEMPT: "2",
            GITHUB_TOKEN: "test-token",
            GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
          },
        },
      ),
      /cannot be manually re-run/,
    );

    admissionArtifacts = Array.from({ length: 6 }, (_, index) => ({
      id: index + 1,
      expired: false,
      created_at: new Date(Date.now() - (index + 1) * 60 * 1000).toISOString(),
      workflow_run: { head_sha: `hourly-head-${index + 1}` },
    }));
    await assert.rejects(
      execute(
        process.execPath,
        [
          "scripts/admit-candidate-pr.mjs",
          "--event",
          eventPath,
          "--out",
          join(directory, "hourly-limited.json"),
        ],
        {
          cwd: projectRoot,
          env: {
            ...process.env,
            GITHUB_RUN_ID: "1000",
            GITHUB_RUN_ATTEMPT: "1",
            GITHUB_TOKEN: "test-token",
            GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
          },
        },
      ),
      /limit of 6 starts in one hour/,
    );

    admissionArtifacts = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      expired: false,
      created_at: new Date(
        Date.now() - (index + 1) * 70 * 60 * 1000,
      ).toISOString(),
      workflow_run: { head_sha: `daily-head-${index + 1}` },
    }));
    await assert.rejects(
      execute(
        process.execPath,
        [
          "scripts/admit-candidate-pr.mjs",
          "--event",
          eventPath,
          "--out",
          join(directory, "daily-limited.json"),
        ],
        {
          cwd: projectRoot,
          env: {
            ...process.env,
            GITHUB_RUN_ID: "1000",
            GITHUB_RUN_ATTEMPT: "1",
            GITHUB_TOKEN: "test-token",
            GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
          },
        },
      ),
      /daily verifier limit of 12/,
    );

    const candidateHash = JSON.parse(accepted.stdout).candidateHash;
    await writeFile(
      join(eventsDirectory, "accepted.json"),
      JSON.stringify({ candidateHash }),
    );
    await assert.rejects(
      execute(
        process.execPath,
        [
          "scripts/admit-candidate-pr.mjs",
          "--event",
          eventPath,
          "--events-dir",
          eventsDirectory,
          "--out",
          join(directory, "duplicate.json"),
        ],
        {
          cwd: projectRoot,
          env: {
            ...process.env,
            GITHUB_RUN_ID: "",
            GITHUB_TOKEN: "test-token",
            GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
          },
        },
      ),
      /exact candidate bytes are already part/,
    );

    await writeFile(
      eventPath,
      JSON.stringify({
        repository: { full_name: "example/repo" },
        pull_request: {
          number: 7,
          state: "closed",
          user: { login: "example-agent" },
          head: { sha: "head-sha" },
        },
      }),
    );
    const replay = await execute(
      process.execPath,
      [
        "scripts/admit-candidate-pr.mjs",
        "--event",
        eventPath,
        "--events-dir",
        eventsDirectory,
        "--allow-applied",
        "--out",
        join(directory, "replay.json"),
      ],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          GITHUB_RUN_ID: "",
          GITHUB_TOKEN: "test-token",
          GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
        },
      },
    );
    assert.match(replay.stdout, /"admitted": true/);

    changedFiles = [
      ...changedFiles,
      { filename: ".github/workflows/pwn.yml", status: "added" },
    ];
    await assert.rejects(
      execute(
        process.execPath,
        [
          "scripts/admit-candidate-pr.mjs",
          "--event",
          eventPath,
          "--out",
          join(directory, "second.json"),
        ],
        {
          cwd: projectRoot,
          env: {
            ...process.env,
            GITHUB_RUN_ID: "",
            GITHUB_TOKEN: "test-token",
            GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
          },
        },
      ),
      /must add exactly one file/,
    );
  } finally {
    await new Promise<void>((resolveClose, rejectClose) =>
      server.close((error) =>
        error ? rejectClose(error) : resolveClose(),
      ),
    );
    await rm(directory, { recursive: true, force: true });
  }
});

test("README badge stats match the canonical world", async () => {
  const [world, badges] = await Promise.all(
    ["world/snapshot.json", "public/data/world/badges.json"].map((path) =>
      readFile(join(projectRoot, path), "utf8").then(JSON.parse),
    ),
  );
  assert.equal(badges.schemaVersion, "1.0.0");
  assert.equal(badges.expeditions, world.expeditions.length);
  assert.equal(
    badges.highestAltitudeM,
    Math.round(
      Math.max(
        0,
        ...world.expeditions.map(
          (expedition: { altitudeM: number }) => expedition.altitudeM,
        ),
      ),
    ),
  );
  assert.equal(
    badges.highestExpeditionAltitudeM,
    badges.highestAltitudeM,
  );
  assert.equal(
    badges.currentHighestAltitudeM,
    Math.round(
      JSON.parse(
        await readFile(
          join(projectRoot, "public/data/world/latest.json"),
          "utf8",
        ),
      ).currentHighestPoint.altitudeM,
    ),
  );
  assert.equal(badges.liveStones, world.stones.length);
  assert.equal(
    badges.livingIdentities,
    world.identities.filter(
      (identity: { status: string }) => identity.status === "ACTIVE",
    ).length,
  );
  assert.equal(badges.worldSequence, world.sequence);
});

test("R2 manifests bind immutable artifacts and publish latest last", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alter-everest-r2-"));
  const manifestPath = join(directory, "manifest.json");

  try {
    await execute(
      process.execPath,
      [
        "scripts/build-r2-publish-manifest.mjs",
        "--all",
        "--out",
        manifestPath,
      ],
      { cwd: projectRoot },
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.schemaVersion, "1.0.0");
    assert.ok(
      manifest.immutable.some(
        (artifact: { key?: string }) =>
          artifact.key === `worlds/${manifest.worldHash}.json`,
      ),
    );
    assert.equal(
      new Set(
        manifest.immutable.map(
          (artifact: { key?: string }) => artifact.key,
        ),
      ).size,
      manifest.immutable.length,
    );
    assert.ok(
      manifest.immutable.every((artifact: { sha256?: string }) =>
        /^[a-f0-9]{64}$/.test(artifact.sha256 ?? ""),
      ),
    );
    assert.ok(
      manifest.mutable.some(
        (artifact: { key?: string }) => artifact.key === "world/badges.json",
      ),
    );
    assert.equal(manifest.mutable.at(-1).key, "world/latest.json");

    const dryRun = await execute(
      process.execPath,
      [
        "scripts/publish-world-r2.mjs",
        "--manifest",
        manifestPath,
        "--bucket",
        "alter-everest-world",
        "--dry-run",
      ],
      { cwd: projectRoot },
    );
    assert.match(dryRun.stdout, /"dryRun": true/);
    assert.match(dryRun.stdout, /"key": "world\/badges.json"/);
    assert.match(dryRun.stdout, /"key": "world\/latest.json"/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
