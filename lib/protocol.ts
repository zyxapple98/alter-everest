import type {
  CandidateCommit,
  ExactRoute,
  ExpeditionAction,
} from "../engine/types";
import { CANDIDATE_LIMITS } from "../engine/constants";
import protocolManifest from "../protocol/manifest.json";

export const PROTOCOL_VERSION = protocolManifest.protocolVersion;
export { CANDIDATE_LIMITS };

export interface ShapeValidationResult {
  valid: boolean;
  errors: string[];
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

function validVoxel(value: unknown) {
  return (
    value !== null &&
    typeof value === "object" &&
    hasOnlyKeys(value, ["x", "y", "z"]) &&
    ["x", "y", "z"].every((key) =>
      Number.isSafeInteger((value as Record<string, unknown>)[key]),
    )
  );
}

function validAction(value: unknown): value is ExpeditionAction {
  if (!value || typeof value !== "object") return false;
  const mutation = value as Record<string, unknown>;
  if (
    mutation.kind !== "RELOCATE" ||
    !safeIdentifier(mutation.matterId) ||
    !hasOnlyKeys(mutation, [
      "kind",
      "matterId",
      "source",
      "destination",
      "pickupStep",
      "releaseStep",
    ]) ||
    !Number.isSafeInteger(mutation.pickupStep) ||
    !Number.isSafeInteger(mutation.releaseStep) ||
    (mutation.pickupStep as number) < 0 ||
    (mutation.releaseStep as number) < 0
  ) {
    return false;
  }
  const source = mutation.source as Record<string, unknown> | null;
  const destination = mutation.destination as Record<string, unknown> | null;
  if (!source || !destination) return false;
  const validSource =
    (source.kind === "BASE" && hasOnlyKeys(source, ["kind"])) ||
    (source.kind === "STONE" &&
      hasOnlyKeys(source, ["kind"])) ||
    (source.kind === "TERRAIN" &&
      hasOnlyKeys(source, ["kind", "voxel"]) &&
      validVoxel(source.voxel));
  const validDestination =
    (destination.kind === "BASE" &&
      hasOnlyKeys(destination, ["kind"])) ||
    (destination.kind === "WORLD" &&
      hasOnlyKeys(destination, ["kind", "cell"]) &&
      validVoxel(destination.cell));
  return Boolean(
    validSource &&
      validDestination &&
      !(source.kind === "BASE" && destination.kind === "BASE"),
  );
}

function validRoute(value: unknown): value is ExactRoute {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const route = value as Record<string, unknown>;
  return (
    hasOnlyKeys(route, [
      "codec",
      "start",
      "stepCount",
      "program",
      "safeStop",
    ]) &&
    route.codec === "ae-microtrace-v1" &&
    validVoxel(route.start) &&
    Number.isSafeInteger(route.stepCount) &&
    (route.stepCount as number) >= 1 &&
    (route.stepCount as number) <=
      CANDIDATE_LIMITS.maximumDecodedRouteSteps &&
    typeof route.program === "string" &&
    /^[A-Za-z0-9_-]*$/.test(route.program) &&
    (route.safeStop === undefined || typeof route.safeStop === "boolean")
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
        "actions",
      ])
    ) {
      errors.push("proof contains unsupported properties");
    }
    if (!validRoute(candidate.proof.route)) {
      errors.push(
        `proof.route must be a bounded ae-microtrace-v1 route with at most ${CANDIDATE_LIMITS.maximumDecodedRouteSteps} steps`,
      );
    }
    if (
      !Array.isArray(candidate.proof.actions) ||
      candidate.proof.actions.length < 1
    ) {
      errors.push("proof.actions must contain at least one action");
    } else if (
      candidate.proof.actions.length > CANDIDATE_LIMITS.maximumActions
    ) {
      errors.push(
        `proof.actions may contain at most ${CANDIDATE_LIMITS.maximumActions} actions`,
      );
    } else if (candidate.proof.actions.some((action) => !validAction(action))) {
      errors.push("proof.actions contains an invalid action");
    }
  }

  return { valid: errors.length === 0, errors };
}
