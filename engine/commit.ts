import protocolManifest from "../protocol/manifest.json";
import { validateActionBinding } from "./action";
import { validateRouteClearance } from "./clearance";
import { CLIMBER, PHYSICS, TERRAIN } from "./constants";
import { voxelKey } from "./mutation";
import {
  simulateMutation,
  validateStaticServiceLoadCases,
} from "./physics";
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
  ExpeditionAction,
  MatterMutation,
  PhysicsSnapshot,
  PhysicsVerdict,
  RouteFailureCode,
  RouteSample,
  RouteVerdict,
  Vec3,
} from "./types";

export interface ValidationContext {
  baseCamp: Vec3;
  extractionZones?: readonly Vec3[];
  terrain?: TerrainOracle;
}

interface RoutePhase {
  route: RouteSample[];
  world: PhysicsSnapshot;
  carrying: boolean;
}

interface PhysicsTotals {
  evaluatedStoneCells: number;
  cavityCellsChecked: number;
  affectedStoneIds: Set<string>;
}

const expeditionLimits = protocolManifest.candidate;

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

function snapshotAfter(
  parent: PhysicsSnapshot,
  action: ExpeditionAction,
  physics: PhysicsVerdict,
): PhysicsSnapshot {
  return {
    worldHash: parent.worldHash,
    stones: physics.finalStones,
    removedTerrainVoxels:
      action.source.kind === "TERRAIN"
        ? [...parent.removedTerrainVoxels, action.source.voxel]
        : parent.removedTerrainVoxels,
  };
}

function pickupMutation(action: ExpeditionAction): MatterMutation {
  return {
    kind: "RELOCATE",
    matterId: action.matterId,
    source: action.source,
    destination: { kind: "BASE" },
  };
}

function addPhase(
  phases: RoutePhase[],
  route: RouteSample[],
  startIndex: number,
  endIndex: number,
  world: PhysicsSnapshot,
  carrying: boolean,
) {
  if (startIndex > endIndex) return;
  phases.push({
    route: route.slice(startIndex, endIndex + 1),
    world,
    carrying,
  });
}

function accumulatePhysics(
  totals: PhysicsTotals,
  physics: PhysicsVerdict,
) {
  totals.evaluatedStoneCells += physics.evaluatedStoneCells;
  totals.cavityCellsChecked += physics.cavityCellsChecked;
  physics.affectedStoneIds.forEach((id) => totals.affectedStoneIds.add(id));
}

function physicsBudgetExceeded(totals: PhysicsTotals) {
  return (
    totals.evaluatedStoneCells >
      expeditionLimits.maximumCumulativeEvaluatedStoneCells ||
    totals.cavityCellsChecked >
      expeditionLimits.maximumCumulativeCavityWindowCells
  );
}

function budgetFailure(world: PhysicsSnapshot, totals: PhysicsTotals): PhysicsVerdict {
  return {
    valid: false,
    code: "EXPEDITION_PHYSICS_BUDGET_EXCEEDED",
    finalStones: world.stones,
    affectedStoneIds: [...totals.affectedStoneIds].sort(),
    evaluatedStoneCells: totals.evaluatedStoneCells,
    cavityCellsChecked: totals.cavityCellsChecked,
    contactModel: "VOXEL_STATIC_V2_1",
  };
}

function stablePhysics(
  world: PhysicsSnapshot,
  totals: PhysicsTotals,
): PhysicsVerdict {
  return {
    valid: true,
    code: "STABLE",
    finalStones: world.stones,
    affectedStoneIds: [...totals.affectedStoneIds].sort(),
    evaluatedStoneCells: totals.evaluatedStoneCells,
    cavityCellsChecked: totals.cavityCellsChecked,
    contactModel: "VOXEL_STATIC_V2_1",
  };
}

function sameSpatialState(
  left: PhysicsSnapshot,
  right: PhysicsSnapshot,
) {
  if (
    left.stones.length !== right.stones.length ||
    left.removedTerrainVoxels.length !== right.removedTerrainVoxels.length
  ) {
    return false;
  }
  const leftStones = new Map(
    left.stones.map((stone) => [stone.id, voxelKey(stone.cell)]),
  );
  if (
    right.stones.some(
      (stone) => leftStones.get(stone.id) !== voxelKey(stone.cell),
    )
  ) {
    return false;
  }
  const leftTerrain = new Set(left.removedTerrainVoxels.map(voxelKey));
  return right.removedTerrainVoxels.every((voxel) =>
    leftTerrain.has(voxelKey(voxel)),
  );
}

function supportCellFor(sample: RouteSample) {
  return {
    x: Math.floor(sample.x / TERRAIN.voxelEdgeM),
    y:
      Math.floor(
        (sample.y + TERRAIN.voxelEdgeM * 0.25) /
          TERRAIN.voxelEdgeM,
      ) - 1,
    z: Math.floor(sample.z / TERRAIN.voxelEdgeM),
  };
}

async function validatePhasedRoute(
  phases: RoutePhase[],
  context: ValidationContext,
  totals: PhysicsTotals,
  canonicalWorld: PhysicsSnapshot,
): Promise<
  | { valid: true }
  | {
      valid: false;
      routeCode?: RouteFailureCode;
      physics?: PhysicsVerdict;
    }
> {
  if (context.terrain) {
    for (const phase of phases) {
      const terrainRoute = phase.carrying
        ? phase.route.slice(1)
        : phase.route;
      if (terrainRoute.length === 0) continue;
      const terrain = validateRouteTerrain(
        terrainRoute,
        context.terrain,
        phase.world,
      );
      if (!terrain.valid) {
        return {
          valid: false,
          routeCode:
            terrain.code === "OUTSIDE_TERRAIN"
              ? "OUTSIDE_TERRAIN"
              : "TERRAIN_MISMATCH",
        };
      }
    }
  }

  for (const phase of phases) {
    if (phase.route.length < 2) continue;
    const clearance = await validateRouteClearance(
      phase.world,
      phase.route,
    );
    if (!clearance.clear) {
      return { valid: false, routeCode: "ROUTE_OBSTRUCTED" };
    }
  }

  if (!context.terrain) return { valid: true };

  const stateIds = new Map<PhysicsSnapshot, number>();
  const stoneCellsByWorld = new Map<
    PhysicsSnapshot,
    Map<string, { x: number; y: number; z: number }>
  >();
  const uniqueLoads = new Map<
    string,
    {
      world: PhysicsSnapshot;
      supportCell: { x: number; y: number; z: number };
      stoneWeightEquivalent: number;
    }
  >();
  for (const phase of phases) {
    if (!stateIds.has(phase.world)) {
      stateIds.set(phase.world, stateIds.size);
      stoneCellsByWorld.set(
        phase.world,
        new Map(
          phase.world.stones.map((stone) => [
            voxelKey(stone.cell),
            stone.cell,
          ]),
        ),
      );
    }
    const stateId = stateIds.get(phase.world)!;
    const stoneCells = stoneCellsByWorld.get(phase.world)!;
    for (const sample of phase.route) {
      const stoneCell = stoneCells.get(voxelKey(supportCellFor(sample)));
      if (!stoneCell) continue;
      const stoneWeightEquivalent =
        CLIMBER.bodyMassKg / PHYSICS.stoneMassKg +
        (phase.carrying ? 1 : 0);
      uniqueLoads.set(
        `${stateId}:${voxelKey(stoneCell)}:${phase.carrying ? 1 : 0}`,
        {
          world: phase.world,
          supportCell: stoneCell,
          stoneWeightEquivalent,
        },
      );
    }
  }

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
    accumulatePhysics(totals, loaded);
    if (!loaded.valid) {
      return { valid: false, physics: loaded };
    }
    if (physicsBudgetExceeded(totals)) {
      return {
        valid: false,
        physics: budgetFailure(canonicalWorld, totals),
      };
    }
  }
  return { valid: true };
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
  let route = validateRoute(candidate.proof, context.baseCamp);
  if (!route.valid) {
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
  const phases: RoutePhase[] = [];
  const totals: PhysicsTotals = {
    evaluatedStoneCells: 0,
    cavityCellsChecked: 0,
    affectedStoneIds: new Set(),
  };
  let working: PhysicsSnapshot = currentWorld;
  let cursor = 0;

  for (const action of candidate.proof.actions) {
    const binding = validateActionBinding(
      action,
      candidate.proof.route,
      {
        baseCamp: currentWorld.baseCamp,
        stones: working.stones,
      },
    );
    if (!binding.valid) {
      route = invalidateRoute(
        route,
        binding.code as Exclude<typeof binding.code, "ACTION_BOUND">,
      );
      return rejected(
        stale ? "STALE_CONFLICT" : "ROUTE_INVALID",
        canonicalParent,
        stale,
        route,
      );
    }

    addPhase(
      phases,
      candidate.proof.route,
      cursor,
      action.pickupIndex,
      working,
      false,
    );

    let carried = working;
    if (action.source.kind !== "BASE") {
      const pickupPhysics = await simulateMutation(
        working,
        pickupMutation(action),
        physicsContext,
      );
      accumulatePhysics(totals, pickupPhysics);
      if (!pickupPhysics.valid) {
        return rejected(
          stale ? "STALE_CONFLICT" : "PHYSICS_INVALID",
          canonicalParent,
          stale,
          route,
          pickupPhysics,
        );
      }
      if (physicsBudgetExceeded(totals)) {
        return rejected(
          stale ? "STALE_CONFLICT" : "PHYSICS_INVALID",
          canonicalParent,
          stale,
          route,
          budgetFailure(currentWorld, totals),
        );
      }
      carried = snapshotAfter(working, action, pickupPhysics);
    }

    addPhase(
      phases,
      candidate.proof.route,
      action.pickupIndex,
      action.releaseIndex,
      carried,
      true,
    );

    let finalWorld = carried;
    if (action.destination.kind === "WORLD") {
      const placementPhysics = await simulateMutation(
        working,
        action,
        physicsContext,
      );
      accumulatePhysics(totals, placementPhysics);
      if (!placementPhysics.valid) {
        return rejected(
          stale ? "STALE_CONFLICT" : "PHYSICS_INVALID",
          canonicalParent,
          stale,
          route,
          placementPhysics,
        );
      }
      if (physicsBudgetExceeded(totals)) {
        return rejected(
          stale ? "STALE_CONFLICT" : "PHYSICS_INVALID",
          canonicalParent,
          stale,
          route,
          budgetFailure(currentWorld, totals),
        );
      }
      finalWorld = snapshotAfter(working, action, placementPhysics);
    }

    working = finalWorld;
    cursor = action.releaseIndex;
  }

  addPhase(
    phases,
    candidate.proof.route,
    cursor,
    candidate.proof.route.length - 1,
    working,
    false,
  );

  const phasedRoute = await validatePhasedRoute(
    phases,
    context,
    totals,
    currentWorld,
  );
  if (!phasedRoute.valid) {
    if (phasedRoute.routeCode) {
      route = invalidateRoute(route, phasedRoute.routeCode);
      return rejected(
        stale ? "STALE_CONFLICT" : "ROUTE_INVALID",
        canonicalParent,
        stale,
        route,
      );
    }
    return rejected(
      stale ? "STALE_CONFLICT" : "PHYSICS_INVALID",
      canonicalParent,
      stale,
      route,
      phasedRoute.physics ?? null,
    );
  }

  if (sameSpatialState(currentWorld, working)) {
    return rejected(
      stale ? "STALE_CONFLICT" : "PHYSICS_INVALID",
      canonicalParent,
      stale,
      route,
      {
        ...stablePhysics(currentWorld, totals),
        valid: false,
        code: "NO_STATE_CHANGE",
      },
    );
  }

  const physics = stablePhysics(working, totals);
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
