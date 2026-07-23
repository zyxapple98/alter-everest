import { simulateMutation } from "./physics";
import { validateRoute } from "./route";
import { validateRouteClearance } from "./clearance";
import type {
  CandidateCommit,
  CanonicalWorld,
  CommitVerdict,
  Vec3,
} from "./types";

export async function validateCandidateCommit(
  candidate: CandidateCommit,
  currentWorld: CanonicalWorld,
  baseCamp: Vec3,
): Promise<CommitVerdict> {
  const canonicalParent = currentWorld.worldHash;
  const stale = candidate.parentWorldHash !== canonicalParent;
  const identity = currentWorld.identities.find(
    (entry) => entry.id === candidate.agentId,
  );

  if (identity?.status === "RETIRED") {
    return {
      accepted: false,
      code: "IDENTITY_RETIRED",
      canonicalParent,
      revalidatedAgainstHead: stale,
      route: null,
      physics: null,
      nextIdentityStatus: null,
    };
  }

  // Stale proofs are not rejected merely for naming an older parent. The same
  // proof is replayed in full against current HEAD. This is the optimistic
  // concurrency rule used by the merge queue.
  const route = validateRoute(candidate.proof, baseCamp);
  if (!route.valid) {
    return {
      accepted: false,
      code: stale ? "STALE_CONFLICT" : "ROUTE_INVALID",
      canonicalParent,
      revalidatedAgainstHead: stale,
      route,
      physics: null,
      nextIdentityStatus: null,
    };
  }

  const carriedStoneIds =
    candidate.proof.mutation.kind === "ADD"
      ? new Set<string>()
      : new Set([candidate.proof.mutation.stoneId]);
  const clearance = await validateRouteClearance(
    currentWorld,
    candidate.proof.route,
    carriedStoneIds,
  );
  if (!clearance.clear) {
    const obstructedRoute = {
      ...route,
      valid: false as const,
      code: "ROUTE_OBSTRUCTED" as const,
    };
    return {
      accepted: false,
      code: stale ? "STALE_CONFLICT" : "ROUTE_INVALID",
      canonicalParent,
      revalidatedAgainstHead: stale,
      route: obstructedRoute,
      physics: null,
      nextIdentityStatus: null,
    };
  }

  const physics = await simulateMutation(
    currentWorld,
    candidate.proof.mutation,
  );
  if (!physics.valid) {
    return {
      accepted: false,
      code: stale ? "STALE_CONFLICT" : "PHYSICS_INVALID",
      canonicalParent,
      revalidatedAgainstHead: stale,
      route,
      physics,
      nextIdentityStatus: null,
    };
  }

  return {
    accepted: true,
    code: "ACCEPTED",
    canonicalParent,
    revalidatedAgainstHead: stale,
    route,
    physics,
    nextIdentityStatus: route.outcome,
  };
}
