import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { CanonicalExpeditionEvent } from "../engine/types";
import { applyAcceptedCandidate } from "../engine/world";
import {
  canonicalJson,
  receiptBody,
  signReceiptBody,
  unsignedReceipt,
} from "../lib/receipt";
import { computeVerifierHash } from "./verifier-integrity";
import { verifyCandidateFile } from "./verification";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 128);
}

async function writeUniqueOrConfirm(path: string, text: string) {
  try {
    await writeFile(path, text, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(path, "utf8");
    if (existing !== text) {
      throw new Error(`Canonical artifact already exists with other content: ${path}`);
    }
  }
}

const candidatePath = process.argv[2];
if (!candidatePath) {
  throw new Error(
    "Usage: npm run expedition:reduce -- <candidate.json> [--world <snapshot.json>]",
  );
}

const worldPath = resolve(argument("--world") ?? "world/snapshot.json");
const outputPath = resolve(argument("--out") ?? worldPath);
const eventsDirectory = resolve(argument("--events-dir") ?? "world/events");
const receiptsDirectory = resolve(
  argument("--receipts-dir") ?? "world/receipts",
);
const proofsDirectory = resolve(argument("--proofs-dir") ?? "world/proofs");
const expectedAgent = argument("--expected-agent");
const requireSignature = process.argv.includes("--require-signature");
const privateKey = process.env.VERIFIER_PRIVATE_KEY_PKCS8_BASE64 ?? null;

if (requireSignature && !privateKey) {
  throw new Error("A verifier signing key is required by the reducer.");
}

const [verification, engineHash] = await Promise.all([
  verifyCandidateFile(candidatePath, {
    expectedAgent,
    worldPath,
  }),
  computeVerifierHash(),
]);

if (
  !verification.accepted ||
  !verification.candidate ||
  !verification.candidateHash ||
  !verification.canonicalWorld ||
  !verification.verdict
) {
  if (verification.verdict?.code === "CANDIDATE_ALREADY_APPLIED") {
    console.log(
      JSON.stringify(
        {
          accepted: true,
          idempotent: true,
          candidateId: verification.candidate?.id ?? null,
          worldHash: verification.canonicalWorld?.worldHash ?? null,
        },
        null,
        2,
      ),
    );
  } else {
    console.error(JSON.stringify(verification, null, 2));
    process.exitCode = 1;
  }
} else {
  const candidate = verification.candidate;
  const verdict = verification.verdict;
  const nextWorld = await applyAcceptedCandidate(
    candidate,
    { ...verification.canonicalWorld, terrain: [] },
    verdict,
  );
  const body = receiptBody(
    candidate,
    verdict,
    verification.candidateHash,
    engineHash,
  );
  const receipt = privateKey
    ? signReceiptBody(body, privateKey)
    : unsignedReceipt(body);
  const actionIndex =
    candidate.proof.mutation.kind === "RECOVER"
      ? candidate.proof.pickupIndex!
      : candidate.proof.releaseIndex!;
  const actionSample = candidate.proof.route[actionIndex];

  const prefix = `${String(nextWorld.sequence).padStart(9, "0")}-${safeFilePart(
    candidate.id,
  )}`;
  const proofPath = resolve(proofsDirectory, `${prefix}.json`);
  const proofArtifact = `world/proofs/${prefix}.json`;
  const eventWithoutHash = {
    eventVersion: "1.0.0" as const,
    sequence: nextWorld.sequence,
    candidateId: candidate.id,
    candidateHash: verification.candidateHash,
    agentId: candidate.agentId,
    parentWorldHash: verdict.canonicalParent,
    worldHash: nextWorld.worldHash,
    terrainHash: candidate.terrainHash,
    engineHash,
    action: candidate.proof.mutation.kind,
    stoneId: candidate.proof.mutation.stoneId,
    outcome: verdict.nextIdentityStatus!,
    altitudeM: actionSample.altitudeM,
    oxygenUsed: verdict.route!.oxygenUsed,
    energyKj: verdict.route!.energyKj,
    score: verdict.score!,
    proofArtifact,
    traceArtifact: null,
    receiptKeyId: receipt.signature?.keyId ?? null,
  };
  const event: CanonicalExpeditionEvent = {
    ...eventWithoutHash,
    eventHash: sha256(canonicalJson(eventWithoutHash)),
  };

  const eventPath = resolve(eventsDirectory, `${prefix}.json`);
  const receiptPath = resolve(receiptsDirectory, `${prefix}.json`);
  const proofBytes = await readFile(resolve(candidatePath));
  const snapshotText = `${JSON.stringify(nextWorld, null, 2)}\n`;
  const eventText = `${JSON.stringify(event, null, 2)}\n`;
  const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;

  await Promise.all([
    mkdir(dirname(outputPath), { recursive: true }),
    mkdir(eventsDirectory, { recursive: true }),
    mkdir(receiptsDirectory, { recursive: true }),
    mkdir(proofsDirectory, { recursive: true }),
  ]);
  await writeUniqueOrConfirm(proofPath, proofBytes.toString("utf8"));
  await writeUniqueOrConfirm(receiptPath, receiptText);
  await writeUniqueOrConfirm(eventPath, eventText);

  const temporarySnapshot = resolve(
    dirname(outputPath),
    `.${basename(outputPath)}.${process.pid}.tmp`,
  );
  await writeFile(temporarySnapshot, snapshotText, { flag: "wx" });
  await rename(temporarySnapshot, outputPath);

  console.log(
    JSON.stringify(
      {
        accepted: true,
        idempotent: false,
        sequence: nextWorld.sequence,
        candidateId: candidate.id,
        worldHash: nextWorld.worldHash,
        eventPath,
        receiptPath,
        receiptKeyId: receipt.signature?.keyId ?? null,
      },
      null,
      2,
    ),
  );
}
