import { validateActionBinding } from "./action";
import { validateRouteClearance } from "./clearance";
import { simulateMutation } from "./physics";
import { validateRoute } from "./route";
import { calculateReward } from "./scoring";
import {
  validateRouteTerrain,
  type TerrainOracle,
} from "./terrain";
import type {
  CandidateCommit,
  CanonicalWorld,
  CommitVerdict,
  RouteFailureCode,
  RouteVerdict,
  Vec3,
} from "./types";

export interface ValidationContext {
  baseCamp: Vec3;
  extractionZones?: readonly Vec3[];
  terrain?: TerrainOracle;
}

function contextFrom(
  world: CanonicalWorld,
  supplied?: Vec3 | ValidationContext,
): ValidationContext {
  if (!supplied) {
    return {
      baseCamp: world.baseCamp,
      extractionZones: world.extractionZones,
    };
  }
  if ("baseCamp" in supplied) return supplied;
  return {
    baseCamp: supplied,
    extractionZones: world.extractionZones,
  };
}

function rejected(
  code: CommitVerdict["code"],
  canonicalParent: string,
  stale: boolean,
  route: RouteVerdict | null = null,
  physics: CommitVerdict["physics"] = null,
): CommitVerdict {
  return {
    accepted: false,
    code,
    canonicalParent,
    revalidatedAgainstHead: stale,
    route,
    physics,
    nextIdentityStatus: null,
    score: null,
  };
}

function invalidateRoute(
  route: RouteVerdict,
  code: RouteFailureCode,
): RouteVerdict {
  return { ...route, valid: false, code };
}

export async function validateCandidateCommit(
  candidate: CandidateCommit,
  currentWorld: CanonicalWorld,
  suppliedContext?: Vec3 | ValidationContext,
): Promise<CommitVerdict> {
  const canonicalParent = currentWorld.worldHash;
  const stale =
    candidate.parentWorldHash !== canonicalParent ||
    candidate.terrainHash !== currentWorld.terrainHash;
  const identity = currentWorld.identities.find(
    (entry) => entry.id === candidate.agentId,
  );

  if (
    currentWorld.expeditions.some(
      (expedition) => expedition.id === candidate.id,
    )
  ) {
    return rejected(
      "CANDIDATE_ALREADY_APPLIED",
      canonicalParent,
      stale,
    );
  }
  if (identity?.status === "DEAD") {
    return rejected(
      "IDENTITY_DEAD",
      canonicalParent,
      stale,
    );
  }
  if (candidate.terrainHash !== currentWorld.terrainHash) {
    return rejected("STALE_CONFLICT", canonicalParent, true);
  }

  const context = contextFrom(currentWorld, suppliedContext);
  let route = validateRoute(
    candidate.proof,
    context.baseCamp,
    context.extractionZones,
  );
  if (!route.valid) {
    return rejected(
      stale ? "STALE_CONFLICT" : "ROUTE_INVALID",
      canonicalParent,
      stale,
      route,
    );
  }

  if (context.terrain) {
    const terrain = validateRouteTerrain(
      candidate.proof.route,
      context.terrain,
    );
    if (!terrain.valid) {
      const terrainFailure: RouteFailureCode =
        terrain.code === "OUTSIDE_TERRAIN"
          ? "OUTSIDE_TERRAIN"
          : "TERRAIN_MISMATCH";
      route = invalidateRoute(route, terrainFailure);
      return rejected(
        stale ? "STALE_CONFLICT" : "ROUTE_INVALID",
        canonicalParent,
        stale,
        route,
      );
    }
  }

  const action = validateActionBinding(candidate.proof, currentWorld);
  if (!action.valid) {
    route = invalidateRoute(route, "ACTION_POSITION_MISMATCH");
    return rejected(
      stale ? "STALE_CONFLICT" : "ROUTE_INVALID",
      canonicalParent,
      stale,
      route,
    );
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
    route = invalidateRoute(route, "ROUTE_OBSTRUCTED");
    return rejected(
      stale ? "STALE_CONFLICT" : "ROUTE_INVALID",
      canonicalParent,
      stale,
      route,
    );
  }

  const physics = await simulateMutation(
    currentWorld,
    candidate.proof.mutation,
  );
  if (!physics.valid) {
    return rejected(
      stale ? "STALE_CONFLICT" : "PHYSICS_INVALID",
      canonicalParent,
      stale,
      route,
      physics,
    );
  }

  const reward = calculateReward(candidate, currentWorld, route);
  return {
    accepted: true,
    code: "ACCEPTED",
    canonicalParent,
    revalidatedAgainstHead: stale,
    route,
    physics,
    nextIdentityStatus: route.outcome,
    score: reward.total,
  };
}
