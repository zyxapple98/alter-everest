import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import {
  copyFile,
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
    PHYSICS.maxContactIslandStones,
  );
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
    receiptVersion: "1.0.0",
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
      outcome: "ACTIVE",
      oxygenUsed: 120,
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
    protocol: "0.3.0",
    id: "candidate-1",
    parentWorldHash: "world-1",
    terrainHash: "a".repeat(64),
    agentId: "agent-1",
    proof: {
      route,
      mutation: {
        kind: "ADD",
        stoneId: "stone-1",
        releasePose: {
          translation: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      },
      releaseIndex: 0,
      executable: "never",
    },
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.includes("at most")));
  assert.ok(result.errors.some((entry) => entry.includes("unsupported")));
});

test("the reducer writes one signed event and is idempotent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alter-everest-reducer-"));
  const snapshot = join(directory, "snapshot.json");
  const events = join(directory, "events");
  const receipts = join(directory, "receipts");
  const proofs = join(directory, "proofs");
  const candidate = resolve(
    "candidates/example-agent/everest-roundtrip.json",
  );
  const keys = signingKeys();

  try {
    await copyFile(resolve("world/snapshot.json"), snapshot);
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

    const originalWorld = await readFile(resolve("world/snapshot.json"));
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
  const candidateBytes = await readFile(
    resolve("candidates/example-agent/everest-roundtrip.json"),
  );
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
          GITHUB_TOKEN: "test-token",
          GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
        },
      },
    );
    assert.match(accepted.stdout, /"admitted": true/);
    assert.deepEqual(await readFile(outputPath), candidateBytes);

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
