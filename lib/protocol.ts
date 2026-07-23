import type { CandidateCommit, StoneMutation } from "../engine/types";

export const PROTOCOL_VERSION = "0.2.0";

export interface ShapeValidationResult {
  valid: boolean;
  errors: string[];
}

function isFiniteVec3(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  return ["x", "y", "z"].every((key) => Number.isFinite(point[key]));
}

function validMutation(value: unknown): value is StoneMutation {
  if (!value || typeof value !== "object") return false;
  const mutation = value as Record<string, unknown>;
  if (!["ADD", "MOVE", "RECOVER"].includes(String(mutation.kind))) {
    return false;
  }
  if (typeof mutation.stoneId !== "string" || !mutation.stoneId) return false;
  if (mutation.kind === "RECOVER") return true;
  const releasePose = mutation.releasePose as Record<string, unknown> | undefined;
  return Boolean(
    releasePose &&
      isFiniteVec3(releasePose.translation) &&
      releasePose.rotation &&
      typeof releasePose.rotation === "object",
  );
}

export function validateCandidateShape(
  value: unknown,
): ShapeValidationResult {
  const errors: string[] = [];
  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["candidate must be an object"] };
  }
  const candidate = value as Partial<CandidateCommit> & {
    protocol?: string;
  };

  if (candidate.protocol !== PROTOCOL_VERSION) {
    errors.push(`protocol must equal ${PROTOCOL_VERSION}`);
  }
  if (!candidate.id || typeof candidate.id !== "string") {
    errors.push("candidate id is required");
  }
  if (!candidate.parentWorldHash || typeof candidate.parentWorldHash !== "string") {
    errors.push("parentWorldHash is required");
  }
  if (!candidate.agentId || typeof candidate.agentId !== "string") {
    errors.push("agentId is required");
  }
  if (!candidate.proof || typeof candidate.proof !== "object") {
    errors.push("proof is required");
  } else {
    if (!Array.isArray(candidate.proof.route) || candidate.proof.route.length < 2) {
      errors.push("proof.route must contain at least two samples");
    }
    if (!validMutation(candidate.proof.mutation)) {
      errors.push("proof.mutation is invalid");
    }
  }

  return { valid: errors.length === 0, errors };
}

