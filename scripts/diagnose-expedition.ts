import { validateRouteClearance } from "../engine/clearance";
import { simulateMutation } from "../engine/physics";
import { validateRouteTerrain, type TerrainOracle } from "../engine/terrain";
import type {
  CandidateCommit,
  ExpeditionAction,
  MatterMutation,
  PhysicsSnapshot,
} from "../engine/types";

function snapshotAfter(
  parent: PhysicsSnapshot,
  action: ExpeditionAction,
  finalStones: PhysicsSnapshot["stones"],
): PhysicsSnapshot {
  return {
    worldHash: parent.worldHash,
    stones: finalStones,
    removedTerrainVoxels:
      action.source.kind === "TERRAIN"
        ? [...parent.removedTerrainVoxels, action.source.voxel]
        : parent.removedTerrainVoxels,
  };
}

async function inspectPhase(
  candidate: CandidateCommit,
  terrain: TerrainOracle,
  label: string,
  actionIndex: number | null,
  startIndex: number,
  endIndex: number,
  world: PhysicsSnapshot,
  carrying: boolean,
) {
  const route = candidate.proof.route.slice(startIndex, endIndex + 1);
  const terrainRoute = carrying ? route.slice(1) : route;
  const terrainVerdict =
    terrainRoute.length === 0
      ? null
      : validateRouteTerrain(terrainRoute, terrain, world);
  const clearance =
    route.length < 2
      ? null
      : await validateRouteClearance(world, route);
  if (
    terrainVerdict?.valid !== false &&
    (clearance === null || clearance.clear)
  ) {
    return null;
  }
  const localSegment = clearance?.blockedSegmentIndex ?? null;
  const globalSegment =
    localSegment === null ? null : startIndex + localSegment;
  const terrainGlobalSampleIndex =
    terrainVerdict?.valid === false &&
    terrainVerdict.sampleIndex !== null
      ? startIndex +
        (carrying ? 1 : 0) +
        terrainVerdict.sampleIndex
      : null;
  return {
    valid: false,
    stage: "ROUTE_PHASE",
    phase: label,
    actionIndex,
    carrying,
    globalRange: [startIndex, endIndex],
    terrain:
      terrainVerdict?.valid === false
        ? {
            ...terrainVerdict,
            globalSampleIndex: terrainGlobalSampleIndex,
            sample:
              terrainGlobalSampleIndex === null
                ? null
                : candidate.proof.route[terrainGlobalSampleIndex],
          }
        : terrainVerdict,
    clearance:
      clearance === null
        ? null
        : {
            ...clearance,
            globalBlockedSegment: globalSegment,
            segmentSamples:
              globalSegment === null
                ? null
                : candidate.proof.route.slice(
                    globalSegment,
                    globalSegment + 2,
                  ),
          },
  };
}

export async function diagnoseExpedition(
  candidate: CandidateCommit,
  canonicalWorld: PhysicsSnapshot,
  terrain: TerrainOracle,
) {
  let working = canonicalWorld;
  let cursor = 0;

  for (
    let actionIndex = 0;
    actionIndex < candidate.proof.actions.length;
    actionIndex += 1
  ) {
    const action = candidate.proof.actions[actionIndex];
    const before = await inspectPhase(
      candidate,
      terrain,
      `before-action-${actionIndex + 1}`,
      actionIndex + 1,
      cursor,
      action.pickupIndex,
      working,
      false,
    );
    if (before) return before;

    let carried = working;
    if (action.source.kind !== "BASE") {
      const pickup: MatterMutation = {
        kind: "RELOCATE",
        matterId: action.matterId,
        source: action.source,
        destination: { kind: "BASE" },
      };
      const pickupPhysics = await simulateMutation(working, pickup, {
        terrain,
      });
      if (!pickupPhysics.valid) {
        return {
          valid: false,
          stage: "PICKUP_PHYSICS",
          actionIndex: actionIndex + 1,
          physics: pickupPhysics,
        };
      }
      carried = snapshotAfter(
        working,
        action,
        pickupPhysics.finalStones,
      );
    }

    const carrying = await inspectPhase(
      candidate,
      terrain,
      `carrying-action-${actionIndex + 1}`,
      actionIndex + 1,
      action.pickupIndex,
      action.releaseIndex,
      carried,
      true,
    );
    if (carrying) return carrying;

    let finalWorld = carried;
    if (action.destination.kind === "WORLD") {
      const placementPhysics = await simulateMutation(working, action, {
        terrain,
      });
      if (!placementPhysics.valid) {
        return {
          valid: false,
          stage: "PLACEMENT_PHYSICS",
          actionIndex: actionIndex + 1,
          physics: placementPhysics,
        };
      }
      finalWorld = snapshotAfter(
        working,
        action,
        placementPhysics.finalStones,
      );
    }
    working = finalWorld;
    cursor = action.releaseIndex;
  }

  const afterFinal = await inspectPhase(
    candidate,
    terrain,
    "after-final-action",
    null,
    cursor,
    candidate.proof.route.length - 1,
    working,
    false,
  );
  return (
    afterFinal ?? {
      valid: true,
      stage: "ALL_PHASES_CLEAR",
      phases: candidate.proof.actions.length * 2 + 1,
    }
  );
}
