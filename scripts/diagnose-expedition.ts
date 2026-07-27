import { decodeCandidateRoute } from "../engine/route";
import { voxelKey } from "../engine/mutation";
import {
  isExposedTerrainVoxel,
  isSolidTerrainVoxel,
} from "../engine/surface";
import type { TerrainOracle } from "../engine/terrain";
import type {
  CandidateCommit,
  CommitVerdict,
  PhysicsSnapshot,
} from "../engine/types";

export async function diagnoseExpedition(
  candidate: CandidateCommit,
  canonicalWorld: PhysicsSnapshot,
  terrain: TerrainOracle,
  verdict?: CommitVerdict | null,
) {
  let decoded;
  try {
    decoded = decodeCandidateRoute(candidate.proof);
  } catch (error) {
    return {
      valid: false,
      stage: "ROUTE_DECODE",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const routeVerdict = verdict?.route ?? null;
  const failureStep =
    verdict?.failureContext?.step ?? routeVerdict?.failureStep ?? null;
  const inferredActionIndex =
    failureStep === null
      ? -1
      : candidate.proof.actions.findIndex(
          (action) =>
            failureStep >= action.pickupStep &&
            failureStep <= action.releaseStep,
        );
  const actionIndex =
    verdict?.failureContext?.actionIndex !== null &&
    verdict?.failureContext?.actionIndex !== undefined
      ? verdict.failureContext.actionIndex - 1
      : inferredActionIndex;
  const activeAction =
    actionIndex < 0
      ? null
      : candidate.proof.actions[actionIndex];
  const from = failureStep === null ? 0 : Math.max(0, failureStep - 2);
  const to =
    failureStep === null
      ? Math.min(decoded.stances.length - 1, 4)
      : Math.min(decoded.stances.length - 1, failureStep + 2);
  const removed = new Set(
    canonicalWorld.removedTerrainVoxels.map(voxelKey),
  );
  const destinationCell =
    activeAction?.destination.kind === "WORLD"
      ? activeAction.destination.cell
      : null;
  const actionContext = activeAction
    ? {
        actionNumber: actionIndex + 1,
        matterId: activeAction.matterId,
        source: activeAction.source,
        destination: activeAction.destination,
        pickupStep: activeAction.pickupStep,
        releaseStep: activeAction.releaseStep,
        startingWorldFacts: {
          sourceStone:
            activeAction.source.kind === "STONE"
              ? canonicalWorld.stones.find(
                  (stone) => stone.id === activeAction.matterId,
                ) ?? null
              : null,
          sourceTerrainExposed:
            activeAction.source.kind === "TERRAIN"
              ? isExposedTerrainVoxel(
                  terrain,
                  canonicalWorld.removedTerrainVoxels,
                  activeAction.source.voxel,
                )
              : null,
          destinationOccupancy: destinationCell
            ? {
                stone:
                  canonicalWorld.stones.find(
                    (stone) =>
                      voxelKey(stone.cell) ===
                      voxelKey(destinationCell),
                  ) ?? null,
                solidTerrain: isSolidTerrainVoxel(
                  terrain,
                  removed,
                  destinationCell,
                ),
              }
            : null,
        },
      }
    : null;
  return {
    valid: verdict?.accepted ?? routeVerdict?.valid ?? true,
    stage:
      verdict?.failureContext?.stage ??
      (routeVerdict?.valid === false ? "ROUTE" : "TRACE_DECODED"),
    routeCode: routeVerdict?.code ?? null,
    physicsCode: verdict?.physics?.code ?? null,
    failureStep,
    obstacle: routeVerdict?.obstacle ?? null,
    actionIndex: actionIndex < 0 ? null : actionIndex + 1,
    actionContext,
    carrying:
      activeAction !== null &&
      failureStep !== null &&
      failureStep < activeAction.releaseStep,
    localTrace: decoded.stances.slice(from, to + 1),
    timeline: candidate.proof.actions.map((action, index) => ({
      actionNumber: index + 1,
      matterId: action.matterId,
      flow: `${action.source.kind} -> ${action.destination.kind}`,
      pickupStep: action.pickupStep,
      releaseStep: action.releaseStep,
    })),
  };
}
