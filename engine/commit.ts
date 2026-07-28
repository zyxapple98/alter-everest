import {
  validateActionPickupBinding,
  validateActionReleaseBinding,
} from "./action";
import {
  CANDIDATE_LIMITS,
  CLIMBER,
  PHYSICS,
} from "./constants";
import {
  createMovementWorldView,
  stancePoint,
  validateMovement,
  validateStance,
} from "./movement";
import {
  iterateRouteTransitions,
  validateRouteProgram,
} from "./route-codec";
import { voxelKey } from "./mutation";
import {
  simulateMutation,
  validateStaticServiceLoadCases,
} from "./physics";
import {
  ExactRouteLedger,
  routeFailure,
  validateActionSteps,
} from "./route";
import type { TerrainOracle } from "./terrain";
import type {
  CandidateCommit,
  CanonicalWorld,
  CommitVerdict,
  ExpeditionAction,
  FootprintDelta,
  MatterMutation,
  PhysicsSnapshot,
  PhysicsVerdict,
  RouteFailureCode,
  RouteSample,
  RouteStance,
  RouteVerdict,
  Vec3,
} from "./types";

export interface ValidationContext {
  baseCamp: Vec3;
  extractionZones?: readonly Vec3[];
  terrain?: TerrainOracle;
}

interface PhysicsTotals {
  evaluatedStoneCells: number;
  cavityCellsChecked: number;
  affectedStoneIds: Set<string>;
}

interface ServiceLoad {
  supportCell: { x: number; y: number; z: number };
  stoneWeightEquivalent: number;
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
  failureContext: CommitVerdict["failureContext"] = null,
): CommitVerdict {
  return {
    accepted: false,
    code,
    canonicalParent,
    revalidatedAgainstHead: stale,
    route,
    physics,
    nextIdentityStatus: null,
    footprintDelta: null,
    failureContext,
  };
}

function snapshotAfter(
  parent: PhysicsSnapshot,
  action: ExpeditionAction,
  physics: PhysicsVerdict,
): PhysicsSnapshot {
  const terrainSource =
    action.source.kind === "TERRAIN" ? action.source.voxel : null;
  const removed =
    terrainSource &&
    !parent.removedTerrainVoxels.some(
      (cell) => voxelKey(cell) === voxelKey(terrainSource),
    )
      ? [...parent.removedTerrainVoxels, terrainSource]
      : parent.removedTerrainVoxels;
  return {
    worldHash: parent.worldHash,
    stones: physics.finalStones,
    removedTerrainVoxels: removed,
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

function placementMutation(action: ExpeditionAction): MatterMutation {
  return {
    kind: "RELOCATE",
    matterId: action.matterId,
    source: { kind: "BASE" },
    destination: action.destination,
  };
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
      CANDIDATE_LIMITS.maximumCumulativeEvaluatedStoneCells ||
    totals.cavityCellsChecked >
      CANDIDATE_LIMITS.maximumCumulativeCavityWindowCells
  );
}

function budgetFailure(
  world: PhysicsSnapshot,
  totals: PhysicsTotals,
): PhysicsVerdict {
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

function footprintDelta(candidate: CandidateCommit): FootprintDelta {
  return {
    terrainRemovalsCreated: candidate.proof.actions.filter(
      (action) => action.source.kind === "TERRAIN",
    ).length,
    stonePlacementsCreated: candidate.proof.actions.filter(
      (action) => action.destination.kind === "WORLD",
    ).length,
    stonePlacementsRemoved: candidate.proof.actions.filter(
      (action) => action.source.kind === "STONE",
    ).length,
  };
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
    (entry) =>
      entry.id.toLowerCase() === candidate.agentId.toLowerCase(),
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
    return rejected("IDENTITY_DEAD", canonicalParent, stale);
  }
  if (candidate.terrainHash !== currentWorld.terrainHash) {
    return rejected("STALE_CONFLICT", canonicalParent, true);
  }

  const context = contextFrom(currentWorld, suppliedContext);
  if (!context.terrain) {
    return rejected(
      stale ? "STALE_CONFLICT" : "ROUTE_INVALID",
      canonicalParent,
      stale,
      routeFailure("OUTSIDE_TERRAIN", 0),
    );
  }
  const terrain = context.terrain;
  if (!validateActionSteps(candidate.proof)) {
    return rejected(
      stale ? "STALE_CONFLICT" : "ROUTE_INVALID",
      canonicalParent,
      stale,
      routeFailure("ACTION_INDEX_INVALID", 0),
    );
  }

  try {
    validateRouteProgram(candidate.proof.route, {
      maximumSteps: CANDIDATE_LIMITS.maximumDecodedRouteSteps,
      requireCanonical: true,
    });
  } catch {
    return rejected(
      stale ? "STALE_CONFLICT" : "ROUTE_INVALID",
      canonicalParent,
      stale,
      routeFailure("ROUTE_PROGRAM_INVALID", 0),
    );
  }

  const totals: PhysicsTotals = {
    evaluatedStoneCells: 0,
    cavityCellsChecked: 0,
    affectedStoneIds: new Set(),
  };
  const serviceLoads = new Map<
    PhysicsSnapshot,
    Map<string, ServiceLoad>
  >();

  const recordLoad = (
    world: PhysicsSnapshot,
    supportStone: { cell: { x: number; y: number; z: number } } | null,
    carrying: boolean,
  ) => {
    if (!supportStone) return;
    const loads = serviceLoads.get(world) ?? new Map<string, ServiceLoad>();
    const key = `${voxelKey(supportStone.cell)}:${carrying ? 1 : 0}`;
    loads.set(key, {
      supportCell: { ...supportStone.cell },
      stoneWeightEquivalent:
        CLIMBER.bodyMassKg / PHYSICS.stoneMassKg +
        (carrying ? 1 : 0),
    });
    serviceLoads.set(world, loads);
  };

  let working: PhysicsSnapshot = currentWorld;
  let view = createMovementWorldView(working, terrain);
  const initialStance: RouteStance = {
    step: 0,
    cell: { ...candidate.proof.route.start },
  };
  const initial = validateStance(view, initialStance);
  if (!initial.valid || !initial.sample) {
    return rejected(
      stale ? "STALE_CONFLICT" : "ROUTE_INVALID",
      canonicalParent,
      stale,
      routeFailure(initial.code as RouteFailureCode, 0, {
        obstacle: initial.obstacle,
      }),
    );
  }
  recordLoad(working, initial.supportStone, false);
  const ledger = new ExactRouteLedger(
    candidate.proof,
    initial.sample,
    context.baseCamp,
    terrain,
  );
  if (ledger.failureOrNull()) {
    return rejected(
      stale ? "STALE_CONFLICT" : "ROUTE_INVALID",
      canonicalParent,
      stale,
      ledger.failureOrNull(),
    );
  }

  type StepEventResult =
    | { valid: true; sample: RouteSample }
    | { valid: false; verdict: CommitVerdict };

  const inspectCurrentStance = (
    stance: RouteStance,
    carrying: boolean,
  ):
    | { valid: true; sample: RouteSample }
    | {
        valid: false;
        code: RouteFailureCode;
        obstacle: string | null;
      } => {
    const result = validateStance(view, stance);
    if (!result.valid || !result.sample) {
      return {
        valid: false,
        code: result.code as RouteFailureCode,
        obstacle: result.obstacle,
      };
    }
    recordLoad(working, result.supportStone, carrying);
    return { valid: true, sample: result.sample };
  };

  const rejectRoute = (
    code: RouteFailureCode,
    step: number,
    obstacle: string | null = null,
  ) =>
    rejected(
      stale ? "STALE_CONFLICT" : "ROUTE_INVALID",
      canonicalParent,
      stale,
      ledger.reject(code, step, obstacle),
    );

  const rejectPhysics = (
    physics: PhysicsVerdict,
    stage: "PICKUP_PHYSICS" | "RELEASE_PHYSICS",
    failedActionIndex: number,
    step: number,
  ) =>
    rejected(
      stale ? "STALE_CONFLICT" : "PHYSICS_INVALID",
      canonicalParent,
      stale,
      null,
      physicsBudgetExceeded(totals)
        ? budgetFailure(currentWorld, totals)
        : physics,
      {
        stage,
        actionIndex: failedActionIndex + 1,
        step,
      },
    );

  let actionIndex = 0;
  let activeAction: ExpeditionAction | null = null;
  const processEventsAtStance = async (
    stance: RouteStance,
    initialSample: RouteSample,
  ): Promise<StepEventResult> => {
    let sample = initialSample;
    if (
      activeAction &&
      activeAction.releaseStep === stance.step
    ) {
      const action = activeAction;
      const binding = validateActionReleaseBinding(
        action,
        stancePoint(stance.cell),
        {
          baseCamp: context.baseCamp,
          view,
        },
      );
      if (!binding.valid) {
        return {
          valid: false,
          verdict: rejectRoute(
            binding.code as RouteFailureCode,
            stance.step,
          ),
        };
      }
      if (action.destination.kind === "WORLD") {
        const placementPhysics = await simulateMutation(
          working,
          placementMutation(action),
          { terrain },
        );
        accumulatePhysics(totals, placementPhysics);
        if (
          !placementPhysics.valid ||
          physicsBudgetExceeded(totals)
        ) {
          return {
            valid: false,
            verdict: rejectPhysics(
              placementPhysics,
              "RELEASE_PHYSICS",
              actionIndex,
              stance.step,
            ),
          };
        }
        working = snapshotAfter(
          working,
          action,
          placementPhysics,
        );
        view = createMovementWorldView(working, terrain);
      }
      activeAction = null;
      actionIndex += 1;
      const afterRelease = inspectCurrentStance(stance, false);
      if (!afterRelease.valid) {
        return {
          valid: false,
          verdict: rejectRoute(
            afterRelease.code,
            stance.step,
            afterRelease.obstacle,
          ),
        };
      }
      sample = afterRelease.sample;
    }

    const nextAction = candidate.proof.actions[actionIndex];
    if (
      !activeAction &&
      nextAction &&
      nextAction.pickupStep === stance.step
    ) {
      const binding = validateActionPickupBinding(
        nextAction,
        stancePoint(stance.cell),
        {
          baseCamp: context.baseCamp,
          view,
        },
      );
      if (!binding.valid) {
        return {
          valid: false,
          verdict: rejectRoute(
            binding.code as RouteFailureCode,
            stance.step,
          ),
        };
      }
      if (nextAction.source.kind !== "BASE") {
        const pickupPhysics = await simulateMutation(
          working,
          pickupMutation(nextAction),
          { terrain },
        );
        accumulatePhysics(totals, pickupPhysics);
        if (
          !pickupPhysics.valid ||
          physicsBudgetExceeded(totals)
        ) {
          return {
            valid: false,
            verdict: rejectPhysics(
              pickupPhysics,
              "PICKUP_PHYSICS",
              actionIndex,
              stance.step,
            ),
          };
        }
        working = snapshotAfter(
          working,
          nextAction,
          pickupPhysics,
        );
        view = createMovementWorldView(working, terrain);
      }
      activeAction = nextAction;
      const afterPickup = inspectCurrentStance(stance, true);
      if (!afterPickup.valid) {
        return {
          valid: false,
          verdict: rejectRoute(
            afterPickup.code,
            stance.step,
            afterPickup.obstacle,
          ),
        };
      }
      sample = afterPickup.sample;
    }
    return { valid: true, sample };
  };

  let previousSample = initial.sample;
  const initialEvents = await processEventsAtStance(
    initialStance,
    previousSample,
  );
  if (!initialEvents.valid) return initialEvents.verdict;
  previousSample = initialEvents.sample;

  try {
    for (const transition of iterateRouteTransitions(
      candidate.proof.route,
      {
        maximumSteps:
          CANDIDATE_LIMITS.maximumDecodedRouteSteps,
        requireCanonical: true,
      },
    )) {
      const carrying = activeAction !== null;
      const stance = inspectCurrentStance(
        transition.to,
        carrying,
      );
      if (!stance.valid) {
        return rejectRoute(
          stance.code,
          transition.to.step,
          stance.obstacle,
        );
      }
      const movement = validateMovement(
        view,
        previousSample,
        stance.sample,
        transition.movement,
        carrying,
      );
      if (!movement.valid) {
        return rejectRoute(
          movement.code as RouteFailureCode,
          transition.to.step,
          movement.obstacle,
        );
      }
      const routeFailureVerdict = ledger.advance(
        previousSample,
        stance.sample,
        transition.movement,
        movement,
        carrying,
      );
      if (routeFailureVerdict) {
        return rejected(
          stale ? "STALE_CONFLICT" : "ROUTE_INVALID",
          canonicalParent,
          stale,
          routeFailureVerdict,
        );
      }
      const events = await processEventsAtStance(
        transition.to,
        stance.sample,
      );
      if (!events.valid) return events.verdict;
      previousSample = events.sample;
    }
  } catch {
    return rejectRoute("ROUTE_PROGRAM_INVALID", 0);
  }

  if (
    activeAction ||
    actionIndex !== candidate.proof.actions.length
  ) {
    return rejectRoute("ACTION_INDEX_INVALID", 0);
  }
  const routeVerdict = ledger.finish();
  if (!routeVerdict.valid) {
    return rejected(
      stale ? "STALE_CONFLICT" : "ROUTE_INVALID",
      canonicalParent,
      stale,
      routeVerdict,
    );
  }

  for (const [loadWorld, loads] of serviceLoads) {
    const loaded = validateStaticServiceLoadCases(
      loadWorld,
      [...loads.values()],
      terrain,
    );
    accumulatePhysics(totals, loaded);
    if (!loaded.valid || physicsBudgetExceeded(totals)) {
      return rejected(
        stale ? "STALE_CONFLICT" : "PHYSICS_INVALID",
        canonicalParent,
        stale,
        null,
        physicsBudgetExceeded(totals)
          ? budgetFailure(currentWorld, totals)
          : loaded,
        {
          stage: "SERVICE_LOAD",
          actionIndex: null,
          step: null,
        },
      );
    }
  }

  if (sameSpatialState(currentWorld, working)) {
    return rejected(
      stale ? "STALE_CONFLICT" : "PHYSICS_INVALID",
      canonicalParent,
      stale,
      routeVerdict,
      {
        ...stablePhysics(currentWorld, totals),
        valid: false,
        code: "NO_STATE_CHANGE",
      },
      {
        stage: "FINAL_STATE",
        actionIndex: null,
        step: null,
      },
    );
  }

  return {
    accepted: true,
    code: "ACCEPTED",
    canonicalParent,
    revalidatedAgainstHead: stale,
    route: routeVerdict,
    physics: stablePhysics(working, totals),
    nextIdentityStatus: routeVerdict.outcome,
    footprintDelta: footprintDelta(candidate),
    failureContext: null,
  };
}
