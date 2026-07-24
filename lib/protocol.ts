import type { CandidateCommit, StoneMutation } from "../engine/types";
import protocolManifest from "../protocol/manifest.json";

export const PROTOCOL_VERSION = protocolManifest.protocolVersion;
export const CANDIDATE_LIMITS = protocolManifest.candidate;

export interface ShapeValidationResult {
  valid: boolean;
  errors: string[];
}

function isFiniteVec3(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  return ["x", "y", "z"].every((key) => Number.isFinite(point[key]));
}

function isFiniteQuaternion(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const rotation = value as Record<string, unknown>;
  return (
    hasOnlyKeys(rotation, ["x", "y", "z", "w"]) &&
    ["x", "y", "z", "w"].every((key) =>
      Number.isFinite(rotation[key]),
    )
  );
}

function hasOnlyKeys(value: unknown, allowed: readonly string[]) {
  if (!value || typeof value !== "object") return false;
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function safeIdentifier(value: unknown, maximumLength = 128) {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximumLength &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
  );
}

function githubLogin(value: unknown) {
  return (
    typeof value === "string" &&
    value.length <= 39 &&
    /^[a-z\d](?:[a-z\d]|-(?=[a-z\d]))*$/i.test(value)
  );
}

function validMutation(value: unknown): value is StoneMutation {
  if (!value || typeof value !== "object") return false;
  const mutation = value as Record<string, unknown>;
  if (!["ADD", "MOVE", "RECOVER"].includes(String(mutation.kind))) {
    return false;
  }
  if (!safeIdentifier(mutation.stoneId)) return false;
  if (mutation.kind === "RECOVER") {
    return hasOnlyKeys(mutation, ["kind", "stoneId"]);
  }
  if (!hasOnlyKeys(mutation, ["kind", "stoneId", "releasePose"])) {
    return false;
  }
  const releasePose = mutation.releasePose as Record<string, unknown> | undefined;
  return Boolean(
    releasePose &&
      hasOnlyKeys(releasePose, ["translation", "rotation"]) &&
      hasOnlyKeys(
        releasePose.translation as Record<string, unknown>,
        ["x", "y", "z"],
      ) &&
      isFiniteVec3(releasePose.translation) &&
      isFiniteQuaternion(releasePose.rotation),
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
  const candidateRecord = candidate as Record<string, unknown>;

  if (
    !hasOnlyKeys(candidateRecord, [
      "protocol",
      "id",
      "parentWorldHash",
      "terrainHash",
      "agentId",
      "proof",
    ])
  ) {
    errors.push("candidate contains unsupported properties");
  }

  if (candidate.protocol !== PROTOCOL_VERSION) {
    errors.push(`protocol must equal ${PROTOCOL_VERSION}`);
  }
  if (!safeIdentifier(candidate.id)) {
    errors.push("candidate id must be a safe identifier of at most 128 characters");
  }
  if (
    typeof candidate.parentWorldHash !== "string" ||
    candidate.parentWorldHash.length < 1 ||
    candidate.parentWorldHash.length > 128
  ) {
    errors.push("parentWorldHash must contain 1 to 128 characters");
  }
  if (
    typeof candidate.terrainHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(candidate.terrainHash)
  ) {
    errors.push("terrainHash must be a lowercase SHA-256 digest");
  }
  if (!githubLogin(candidate.agentId)) {
    errors.push("agentId must be a valid GitHub login");
  }
  if (!candidate.proof || typeof candidate.proof !== "object") {
    errors.push("proof is required");
  } else {
    const proof = candidate.proof as unknown as Record<string, unknown>;
    if (
      !hasOnlyKeys(proof, [
        "route",
        "mutation",
        "pickupIndex",
        "releaseIndex",
      ])
    ) {
      errors.push("proof contains unsupported properties");
    }
    if (!Array.isArray(candidate.proof.route) || candidate.proof.route.length < 2) {
      errors.push("proof.route must contain at least two samples");
    } else if (candidate.proof.route.length > CANDIDATE_LIMITS.maximumRouteSamples) {
      errors.push(
        `proof.route may contain at most ${CANDIDATE_LIMITS.maximumRouteSamples} samples`,
      );
    } else if (
      candidate.proof.route.some(
        (sample) =>
          !isFiniteVec3(sample) ||
          !Number.isFinite(sample.altitudeM) ||
          !Number.isFinite(sample.slopeDegrees) ||
          sample.slopeDegrees < 0 ||
          sample.slopeDegrees > 90 ||
          !["ROCK", "SNOW", "ICE"].includes(String(sample.surface)) ||
          !["WALK", "SCRAMBLE", "CLIMB"].includes(String(sample.mode)) ||
          (sample.protected !== undefined &&
            typeof sample.protected !== "boolean") ||
          (sample.safeStop !== undefined &&
            typeof sample.safeStop !== "boolean") ||
          !hasOnlyKeys(sample as unknown as Record<string, unknown>, [
            "x",
            "y",
            "z",
            "altitudeM",
            "slopeDegrees",
            "surface",
            "mode",
            "protected",
            "safeStop",
          ]),
      )
    ) {
      errors.push("proof.route contains an invalid sample");
    }
    if (!validMutation(candidate.proof.mutation)) {
      errors.push("proof.mutation is invalid");
    }
  }

  return { valid: errors.length === 0, errors };
}
