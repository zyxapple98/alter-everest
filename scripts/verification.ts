import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { validateCandidateCommit } from "../engine/commit";
import type {
  CandidateCommit,
  CanonicalWorld,
  CommitVerdict,
} from "../engine/types";
import {
  CANDIDATE_LIMITS,
  validateCandidateShape,
} from "../lib/protocol";
import {
  loadCanonicalWorld,
  loadDemBundle,
} from "./expedition-kit";

export interface VerificationOptions {
  expectedAgent?: string | null;
  enforceDirectoryIdentity?: boolean;
  worldPath?: string;
  terrainConfigPath?: string;
}

export interface CandidateVerification {
  accepted: boolean;
  stage: "INPUT" | "IDENTITY" | "SCHEMA" | "VERIFIER";
  errors: string[];
  candidate: CandidateCommit | null;
  candidateHash: string | null;
  candidateBytes: number;
  canonicalWorld: CanonicalWorld | null;
  verdict: CommitVerdict | null;
}

export async function verifyCandidateFile(
  candidatePath: string,
  options: VerificationOptions = {},
): Promise<CandidateVerification> {
  const resolvedCandidatePath = resolve(candidatePath);
  const candidateStat = await stat(resolvedCandidatePath);
  if (candidateStat.size > CANDIDATE_LIMITS.maximumBytes) {
    return {
      accepted: false,
      stage: "INPUT",
      errors: [`candidate exceeds ${CANDIDATE_LIMITS.maximumBytes} bytes`],
      candidate: null,
      candidateHash: null,
      candidateBytes: candidateStat.size,
      canonicalWorld: null,
      verdict: null,
    };
  }

  const bytes = await readFile(resolvedCandidatePath);
  const candidateHash = createHash("sha256").update(bytes).digest("hex");
  let candidate: CandidateCommit;
  try {
    candidate = JSON.parse(bytes.toString("utf8")) as CandidateCommit;
  } catch {
    return {
      accepted: false,
      stage: "INPUT",
      errors: ["candidate must be valid UTF-8 JSON"],
      candidate: null,
      candidateHash,
      candidateBytes: bytes.byteLength,
      canonicalWorld: null,
      verdict: null,
    };
  }

  const expectedAgent = options.expectedAgent ?? null;
  const enforceDirectoryIdentity =
    options.enforceDirectoryIdentity ?? expectedAgent === null;
  const candidateDirectory = basename(dirname(resolvedCandidatePath));
  if (
    enforceDirectoryIdentity &&
    candidate.agentId.toLowerCase() !== candidateDirectory.toLowerCase()
  ) {
    return {
      accepted: false,
      stage: "IDENTITY",
      errors: ["agentId must match the candidate directory name"],
      candidate,
      candidateHash,
      candidateBytes: bytes.byteLength,
      canonicalWorld: null,
      verdict: null,
    };
  }
  if (
    expectedAgent &&
    candidate.agentId.toLowerCase() !== expectedAgent.toLowerCase()
  ) {
    return {
      accepted: false,
      stage: "IDENTITY",
      errors: [`agentId must match the pull-request author: ${expectedAgent}`],
      candidate,
      candidateHash,
      candidateBytes: bytes.byteLength,
      canonicalWorld: null,
      verdict: null,
    };
  }

  const shape = validateCandidateShape(candidate);
  if (!shape.valid) {
    return {
      accepted: false,
      stage: "SCHEMA",
      errors: shape.errors,
      candidate,
      candidateHash,
      candidateBytes: bytes.byteLength,
      canonicalWorld: null,
      verdict: null,
    };
  }

  const [canonicalWorld, terrain] = await Promise.all([
    loadCanonicalWorld(options.worldPath),
    loadDemBundle(options.terrainConfigPath),
  ]);
  const validationWorld = canonicalWorld;
  const verdict = await validateCandidateCommit(candidate, validationWorld, {
    baseCamp: validationWorld.baseCamp,
    extractionZones: validationWorld.extractionZones,
    terrain: terrain.oracle,
  });

  return {
    accepted: verdict.accepted,
    stage: "VERIFIER",
    errors: verdict.accepted ? [] : [verdict.code],
    candidate,
    candidateHash,
    candidateBytes: bytes.byteLength,
    canonicalWorld,
    verdict,
  };
}

export function verificationSummary(result: CandidateVerification) {
  const verdict = result.verdict;
  return {
    accepted: result.accepted,
    stage: result.stage,
    errors: result.errors,
    candidateHash: result.candidateHash,
    candidateBytes: result.candidateBytes,
    code: verdict?.code ?? null,
    routeCode: verdict?.route?.code ?? null,
    outcome: verdict?.nextIdentityStatus ?? null,
    score: verdict?.score ?? null,
    endurance: verdict?.route
      ? {
          used: Number(verdict.route.enduranceUsed.toFixed(2)),
          remaining: Number(verdict.route.enduranceRemaining.toFixed(2)),
        }
      : null,
    energyKj: verdict?.route
      ? Number(verdict.route.energyKj.toFixed(2))
      : null,
    physics: verdict?.physics
      ? {
          code: verdict.physics.code,
          contactModel: verdict.physics.contactModel,
          affectedStoneIds: verdict.physics.affectedStoneIds,
        }
      : null,
  };
}
