import { CLIMBER } from "./constants";
import {
  isInsideBaseCamp,
  isInsideSpawnCore,
  mutationDestinationCell,
  voxelCenter,
} from "./mutation";
import type {
  CanonicalWorld,
  ExpeditionAction,
  StoneState,
  Vec3,
} from "./types";

export interface ActionBindingVerdict {
  valid: boolean;
  code:
    | "ACTION_BOUND"
    | "ACTION_POSITION_MISMATCH"
    | "SPAWN_CORE_PROTECTED"
    | "BASE_IMPORT_INSIDE_CAMP"
    | "BASE_PICKUP_OUTSIDE_CAMP"
    | "BASE_RELEASE_OUTSIDE_CAMP";
}

function distance(a: Vec3, b: Vec3) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function stoneById(
  world: Pick<CanonicalWorld, "stones">,
  stoneId: string,
): StoneState | null {
  return world.stones.find((stone) => stone.id === stoneId) ?? null;
}

export function validateActionPickupBinding(
  action: ExpeditionAction,
  pickupPoint: Vec3,
  world: Pick<CanonicalWorld, "baseCamp" | "stones">,
): ActionBindingVerdict {
  if (
    action.source.kind === "BASE" &&
    !isInsideBaseCamp(pickupPoint, world)
  ) {
    return { valid: false, code: "BASE_PICKUP_OUTSIDE_CAMP" };
  }

  if (action.source.kind !== "BASE") {
    const target =
      action.source.kind === "STONE"
        ? (() => {
            const stone = stoneById(world, action.matterId);
            return stone ? voxelCenter(stone.cell) : undefined;
          })()
        : voxelCenter(action.source.voxel);
    if (
      !target ||
      distance(pickupPoint, target) >
        CLIMBER.interactionReachM
    ) {
      return { valid: false, code: "ACTION_POSITION_MISMATCH" };
    }
  }

  if (
    action.source.kind !== "BASE" &&
    isInsideSpawnCore(
      action.source.kind === "TERRAIN"
        ? voxelCenter(action.source.voxel)
        : (() => {
            const stone = stoneById(world, action.matterId);
            return stone ? voxelCenter(stone.cell) : world.baseCamp;
          })(),
      world,
    )
  ) {
    return { valid: false, code: "SPAWN_CORE_PROTECTED" };
  }

  return { valid: true, code: "ACTION_BOUND" };
}

export function validateActionReleaseBinding(
  action: ExpeditionAction,
  releasePoint: Vec3,
  world: Pick<CanonicalWorld, "baseCamp" | "stones">,
): ActionBindingVerdict {
  if (
    action.destination.kind === "BASE" &&
    !isInsideBaseCamp(releasePoint, world)
  ) {
    return { valid: false, code: "BASE_RELEASE_OUTSIDE_CAMP" };
  }

  const destinationCell = mutationDestinationCell(action);
  const destinationPoint = destinationCell
    ? voxelCenter(destinationCell)
    : null;
  if (
    destinationPoint &&
    distance(releasePoint, destinationPoint) >
      CLIMBER.interactionReachM
  ) {
    return { valid: false, code: "ACTION_POSITION_MISMATCH" };
  }
  if (
    destinationPoint &&
    action.source.kind === "BASE" &&
    isInsideBaseCamp(destinationPoint, world)
  ) {
    return { valid: false, code: "BASE_IMPORT_INSIDE_CAMP" };
  }
  if (
    destinationPoint &&
    isInsideSpawnCore(destinationPoint, world)
  ) {
    return { valid: false, code: "SPAWN_CORE_PROTECTED" };
  }
  return { valid: true, code: "ACTION_BOUND" };
}
