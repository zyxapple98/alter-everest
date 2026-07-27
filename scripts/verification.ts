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
  operationLabel,
  operationSummary,
} from "../engine/mutation";
import {
  loadCanonicalWorld,
  loadDemBundle,
} from "./expedition-kit";
import { guidanceForCode } from "../lib/player-rules";

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
  let candidateStat;
  try {
    candidateStat = await stat(resolvedCandidatePath);
  } catch {
    return {
      accepted: false,
      stage: "INPUT",
      errors: ["candidate file could not be read"],
      candidate: null,
      candidateHash: null,
      candidateBytes: 0,
      canonicalWorld: null,
      verdict: null,
    };
  }
  if (!candidateStat.isFile()) {
    return {
      accepted: false,
      stage: "INPUT",
      errors: ["candidate path must name one file"],
      candidate: null,
      candidateHash: null,
      candidateBytes: 0,
      canonicalWorld: null,
      verdict: null,
    };
  }
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

  let bytes: Buffer;
  try {
    bytes = await readFile(resolvedCandidatePath);
  } catch {
    return {
      accepted: false,
      stage: "INPUT",
      errors: ["candidate file could not be read"],
      candidate: null,
      candidateHash: null,
      candidateBytes: 0,
      canonicalWorld: null,
      verdict: null,
    };
  }
  const candidateHash = createHash("sha256").update(bytes).digest("hex");
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
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

  const shape = validateCandidateShape(parsed);
  if (!shape.valid) {
    return {
      accepted: false,
      stage: "SCHEMA",
      errors: shape.errors,
      candidate: null,
      candidateHash,
      candidateBytes: bytes.byteLength,
      canonicalWorld: null,
      verdict: null,
    };
  }
  const candidate = parsed as CandidateCommit;

  const expectedAgent = options.expectedAgent ?? null;
  const enforceDirectoryIdentity =
    options.enforceDirectoryIdentity ?? false;
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
  const actions = result.candidate?.proof.actions ?? [];
  const actionableCode =
    (result.accepted ? verdict?.code : null) ??
    verdict?.physics?.code ??
    (verdict?.route?.code === "ROUTE_VALID"
      ? verdict.code
      : verdict?.route?.code) ??
    verdict?.code ??
    (result.stage === "INPUT"
      ? "INPUT_INVALID"
      : result.stage === "IDENTITY"
        ? "IDENTITY_MISMATCH"
        : result.stage === "SCHEMA"
          ? "SCHEMA_INVALID"
          : null);
  return {
    accepted: result.accepted,
    stage: result.stage,
    errors: result.errors,
    candidateHash: result.candidateHash,
    candidateBytes: result.candidateBytes,
    code: verdict?.code ?? null,
    operation: actions.length > 0 ? operationSummary(actions) : null,
    operations: actions.map(operationLabel),
    actionCount: actions.length,
    routeCode: verdict?.route?.code ?? null,
    outcome: verdict?.nextIdentityStatus ?? null,
    footprintDelta: verdict?.footprintDelta ?? null,
    distanceMillimeters: verdict?.route?.distanceMillimeters ?? null,
    maximumAltitudeM: verdict?.route?.maximumAltitudeM ?? null,
    terminalAltitudeM: verdict?.route?.terminalAltitudeM ?? null,
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
    failureContext: verdict?.failureContext ?? null,
    actionableCode,
    rule: guidanceForCode(actionableCode),
  };
}
