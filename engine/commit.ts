import { validateActionBinding } from "./action";
import { validateRouteClearance } from "./clearance";
import {
  simulateMutation,
  validateStaticServiceLoadCases,
} from "./physics";
import { isCarryingStone, validateRoute } from "./route";
import { calculateReward } from "./scoring";
import { voxelKey } from "./mutation";
import { CLIMBER, PHYSICS, TERRAIN } from "./constants";
import {
  validateRouteTerrain,
  type TerrainOracle,
} from "./terrain";
import type {
  CandidateCommit,
  CanonicalWorld,
  CommitVerdict,
  PhysicsSnapshot,
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

function withoutSource(
  world: PhysicsSnapshot,
  candidate: CandidateCommit,
): PhysicsSnapshot {
  const { source } = candidate.proof.mutation;
  return {
    worldHash: world.worldHash,
    stones:
      source.kind === "STONE"
        ? world.stones.filter((stone) => stone.id !== source.stoneId)
        : world.stones,
    removedTerrainVoxels:
      source.kind === "TERRAIN"
        ? [...world.removedTerrainVoxels, source.voxel]
        : world.removedTerrainVoxels,
  };
}

function phaseSlices(
  candidate: CandidateCommit,
  current: PhysicsSnapshot,
  carried: PhysicsSnapshot,
  final: PhysicsSnapshot,
) {
  const { proof } = candidate;
  const pickup = proof.pickupIndex ?? -1;
  const release = proof.releaseIndex ?? -1;
  const terrain: Array<{
    route: typeof proof.route;
    world: PhysicsSnapshot;
  }> = [];
  const clearance: Array<{
    route: typeof proof.route;
    world: PhysicsSnapshot;
  }> = [];
  const addTerrain = (
    route: typeof proof.route,
    world: PhysicsSnapshot,
  ) => {
    if (route.length > 0) terrain.push({ route, world });
  };
  const addClearance = (
    route: typeof proof.route,
    world: PhysicsSnapshot,
  ) => {
    if (route.length > 1) clearance.push({ route, world });
  };

  if (proof.mutation.source.kind === "BASE") {
    addTerrain(proof.route.slice(0, release + 1), current);
    addTerrain(proof.route.slice(release + 1), final);
    addClearance(proof.route.slice(0, release + 1), current);
    addClearance(proof.route.slice(release), final);
  } else if (proof.mutation.destination.kind === "BASE") {
    addTerrain(proof.route.slice(0, pickup + 1), current);
    addTerrain(proof.route.slice(pickup + 1), carried);
    addClearance(proof.route.slice(0, pickup + 1), current);
    addClearance(proof.route.slice(pickup), carried);
  } else {
    addTerrain(proof.route.slice(0, pickup + 1), current);
    addTerrain(proof.route.slice(pickup + 1, release + 1), carried);
    addTerrain(proof.route.slice(release + 1), final);
    addClearance(proof.route.slice(0, pickup + 1), current);
    addClearance(proof.route.slice(pickup, release + 1), carried);
    addClearance(proof.route.slice(release), final);
  }
  return { terrain, clearance };
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
  );
  if (!route.valid) {
    return rejected(
      stale ? "STALE_CONFLICT" : "ROUTE_INVALID",
      canonicalParent,
      stale,
      route,
    );
  }

  const action = validateActionBinding(candidate.proof, currentWorld);
  if (!action.valid) {
    route = invalidateRoute(
      route,
      action.code as Exclude<typeof action.code, "ACTION_BOUND">,
    );
    return rejected(
      stale ? "STALE_CONFLICT" : "ROUTE_INVALID",
      canonicalParent,
      stale,
      route,
    );
  }

  const physicsContext = context.terrain
    ? { terrain: context.terrain }
    : undefined;
  if (
    candidate.proof.mutation.source.kind !== "BASE" &&
    candidate.proof.mutation.destination.kind === "WORLD"
  ) {
    const pickupPhysics = await simulateMutation(
      currentWorld,
      {
        ...candidate.proof.mutation,
        destination: { kind: "BASE" },
      },
      physicsContext,
    );
    if (!pickupPhysics.valid) {
      return rejected(
        stale ? "STALE_CONFLICT" : "PHYSICS_INVALID",
        canonicalParent,
        stale,
        route,
        pickupPhysics,
      );
    }
  }

  const physics = await simulateMutation(
    currentWorld,
    candidate.proof.mutation,
    physicsContext,
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

  const carriedWorld = withoutSource(currentWorld, candidate);
  const finalWorld: PhysicsSnapshot = {
    worldHash: currentWorld.worldHash,
    stones: physics.finalStones,
    removedTerrainVoxels: carriedWorld.removedTerrainVoxels,
  };
  const phases = phaseSlices(
    candidate,
    currentWorld,
    carriedWorld,
    finalWorld,
  );

  if (context.terrain) {
    for (const phase of phases.terrain) {
      const terrain = validateRouteTerrain(
        phase.route,
        context.terrain,
        phase.world,
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
  }

  for (const phase of phases.clearance) {
    const clearance = await validateRouteClearance(
      phase.world,
      phase.route,
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
  }

  if (context.terrain) {
    const pickup = candidate.proof.pickupIndex ?? -1;
    const release = candidate.proof.releaseIndex ?? -1;
    const worldAtSample = (index: number) => {
      if (
        candidate.proof.mutation.destination.kind === "WORLD" &&
        index > release
      ) {
        return finalWorld;
      }
      if (
        candidate.proof.mutation.source.kind !== "BASE" &&
        index > pickup
      ) {
        return carriedWorld;
      }
      return currentWorld;
    };
    const stoneCellsByWorld = new Map<
      PhysicsSnapshot,
      Map<string, { x: number; y: number; z: number }>
    >();
    for (const world of [currentWorld, carriedWorld, finalWorld]) {
      stoneCellsByWorld.set(
        world,
        new Map(
          world.stones.map((stone) => [
            voxelKey(stone.cell),
            stone.cell,
          ]),
        ),
      );
    }
    const uniqueLoads = new Map<
      string,
      {
        world: PhysicsSnapshot;
        supportCell: { x: number; y: number; z: number };
        stoneWeightEquivalent: number;
      }
    >();
    candidate.proof.route.forEach((sample, index) => {
      const sampleWorld = worldAtSample(index);
      const stoneCells = stoneCellsByWorld.get(sampleWorld)!;
      const supportCell = {
        x: Math.floor(sample.x / TERRAIN.voxelEdgeM),
        y:
          Math.floor(
            (sample.y + TERRAIN.voxelEdgeM * 0.25) /
              TERRAIN.voxelEdgeM,
          ) - 1,
        z: Math.floor(sample.z / TERRAIN.voxelEdgeM),
      };
      const stoneCell = stoneCells.get(voxelKey(supportCell));
      if (!stoneCell) return;
      const carrying = isCarryingStone(
        candidate.proof,
        Math.max(0, index - 1),
      );
      const stoneWeightEquivalent =
        CLIMBER.bodyMassKg / PHYSICS.stoneMassKg + (carrying ? 1 : 0);
      const key = `${sampleWorld === currentWorld ? "C" : sampleWorld === carriedWorld ? "M" : "F"}:${voxelKey(stoneCell)}:${carrying ? 1 : 0}`;
      uniqueLoads.set(key, {
        world: sampleWorld,
        supportCell: stoneCell,
        stoneWeightEquivalent,
      });
    });
    const loadsByWorld = new Map<
      PhysicsSnapshot,
      Array<{
        supportCell: { x: number; y: number; z: number };
        stoneWeightEquivalent: number;
      }>
    >();
    for (const load of uniqueLoads.values()) {
      const loads = loadsByWorld.get(load.world) ?? [];
      loads.push({
        supportCell: load.supportCell,
        stoneWeightEquivalent: load.stoneWeightEquivalent,
      });
      loadsByWorld.set(load.world, loads);
    }
    for (const [loadWorld, loads] of loadsByWorld) {
      const loaded = validateStaticServiceLoadCases(
        loadWorld,
        loads,
        context.terrain,
      );
      if (!loaded.valid) {
        return rejected(
          stale ? "STALE_CONFLICT" : "PHYSICS_INVALID",
          canonicalParent,
          stale,
          route,
          loaded,
        );
      }
    }
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
