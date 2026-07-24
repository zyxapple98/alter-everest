import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import type {
  CandidateCommit,
  CommitVerdict,
  IdentityOutcome,
  StoneMutation,
} from "../engine/types";

export interface ReceiptBody {
  receiptVersion: "1.0.0";
  candidateHash: string;
  candidateId: string;
  agentId: string;
  canonicalParent: string;
  terrainHash: string;
  engineHash: string;
  issuedAt: string | null;
  result: {
    accepted: boolean;
    code: CommitVerdict["code"];
    action: StoneMutation["kind"];
    outcome: IdentityOutcome | null;
    oxygenUsed: number | null;
    energyKj: number | null;
    score: number | null;
    physicsCode: string | null;
    affectedStoneIds: string[];
  };
}

export interface ReceiptSignature {
  algorithm: "Ed25519";
  keyId: string;
  value: string;
}

export interface VerifierReceipt extends ReceiptBody {
  signature: ReceiptSignature | null;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalValue(value));
}

export function receiptBody(
  candidate: CandidateCommit,
  verdict: CommitVerdict,
  candidateHash: string,
  engineHash: string,
  issuedAt: string | null = null,
): ReceiptBody {
  return {
    receiptVersion: "1.0.0",
    candidateHash,
    candidateId: candidate.id,
    agentId: candidate.agentId,
    canonicalParent: verdict.canonicalParent,
    terrainHash: candidate.terrainHash,
    engineHash,
    issuedAt,
    result: {
      accepted: verdict.accepted,
      code: verdict.code,
      action: candidate.proof.mutation.kind,
      outcome: verdict.nextIdentityStatus,
      oxygenUsed: verdict.route
        ? Number(verdict.route.oxygenUsed.toFixed(6))
        : null,
      energyKj: verdict.route
        ? Number(verdict.route.energyKj.toFixed(6))
        : null,
      score: verdict.score,
      physicsCode: verdict.physics?.code ?? null,
      affectedStoneIds: verdict.physics?.affectedStoneIds ?? [],
    },
  };
}

export function signReceiptBody(
  body: ReceiptBody,
  privateKeyPkcs8Base64: string,
): VerifierReceipt {
  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyPkcs8Base64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey);
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  const payload = Buffer.from(canonicalJson(body));
  const signature = sign(null, payload, privateKey);

  return {
    ...body,
    signature: {
      algorithm: "Ed25519",
      keyId: createHash("sha256").update(publicDer).digest("hex").slice(0, 24),
      value: signature.toString("base64"),
    },
  };
}

export function unsignedReceipt(body: ReceiptBody): VerifierReceipt {
  return { ...body, signature: null };
}

export function verifyReceiptSignature(
  receipt: VerifierReceipt,
  publicKeySpkiBase64: string,
) {
  if (!receipt.signature || receipt.signature.algorithm !== "Ed25519") {
    return false;
  }
  const { signature, ...body } = receipt;
  const publicKey = createPublicKey({
    key: Buffer.from(publicKeySpkiBase64, "base64"),
    format: "der",
    type: "spki",
  });
  const expectedKeyId = createHash("sha256")
    .update(publicKey.export({ format: "der", type: "spki" }))
    .digest("hex")
    .slice(0, 24);
  if (expectedKeyId !== signature.keyId) return false;
  return verify(
    null,
    Buffer.from(canonicalJson(body)),
    publicKey,
    Buffer.from(signature.value, "base64"),
  );
}
