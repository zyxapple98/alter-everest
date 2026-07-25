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
  RouteSample,
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

function sampleAt(route: RouteSample[], index: number | undefined) {
  return index === undefined ? null : route[index] ?? null;
}

function stoneById(
  world: Pick<CanonicalWorld, "stones">,
  stoneId: string,
): StoneState | null {
  return world.stones.find((stone) => stone.id === stoneId) ?? null;
}

export function validateActionBinding(
  action: ExpeditionAction,
  route: RouteSample[],
  world: Pick<CanonicalWorld, "baseCamp" | "stones">,
): ActionBindingVerdict {
  const pickupSample = sampleAt(route, action.pickupIndex);
  const releaseSample = sampleAt(route, action.releaseIndex);
  if (!pickupSample || !releaseSample) {
    return { valid: false, code: "ACTION_POSITION_MISMATCH" };
  }

  if (
    action.source.kind === "BASE" &&
    !isInsideBaseCamp(pickupSample, world)
  ) {
    return { valid: false, code: "BASE_PICKUP_OUTSIDE_CAMP" };
  }
  if (
    action.destination.kind === "BASE" &&
    !isInsideBaseCamp(releaseSample, world)
  ) {
    return { valid: false, code: "BASE_RELEASE_OUTSIDE_CAMP" };
  }

  const destinationCell = mutationDestinationCell(action);
  const releasePoint = destinationCell ? voxelCenter(destinationCell) : null;
  if (
    releasePoint &&
    distance(releaseSample, releasePoint) > CLIMBER.interactionReachM
  ) {
    return { valid: false, code: "ACTION_POSITION_MISMATCH" };
  }

  if (
    releasePoint &&
    action.source.kind === "BASE" &&
    isInsideBaseCamp(releasePoint, world)
  ) {
    return { valid: false, code: "BASE_IMPORT_INSIDE_CAMP" };
  }
  if (releasePoint && isInsideSpawnCore(releasePoint, world)) {
    return { valid: false, code: "SPAWN_CORE_PROTECTED" };
  }

  if (action.source.kind !== "BASE") {
    const target =
      action.source.kind === "STONE"
        ? (() => {
            const stone = stoneById(world, action.source.stoneId);
            return stone ? voxelCenter(stone.cell) : undefined;
          })()
        : voxelCenter(action.source.voxel);
    if (
      !target ||
      distance(pickupSample, target) >
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
            const stone = stoneById(world, action.source.stoneId);
            return stone ? voxelCenter(stone.cell) : world.baseCamp;
          })(),
      world,
    )
  ) {
    return { valid: false, code: "SPAWN_CORE_PROTECTED" };
  }

  return { valid: true, code: "ACTION_BOUND" };
}
