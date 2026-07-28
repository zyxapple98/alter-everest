import { CLIMBER, TERRAIN } from "./constants";
import {
  solidAt,
  type MovementWorldView,
} from "./movement";
import {
  isInsideBaseCamp,
  isInsideSpawnCore,
  mutationDestinationCell,
  voxelCenter,
  voxelKey,
} from "./mutation";
import type {
  CanonicalWorld,
  ExpeditionAction,
  StoneState,
  Vec3,
  VoxelCoordinate,
} from "./types";

export interface ActionBindingVerdict {
  valid: boolean;
  code:
    | "ACTION_BOUND"
    | "ACTION_POSITION_MISMATCH"
    | "ACTION_OCCLUDED"
    | "SPAWN_CORE_PROTECTED"
    | "BASE_IMPORT_INSIDE_CAMP"
    | "BASE_PICKUP_OUTSIDE_CAMP"
    | "BASE_RELEASE_OUTSIDE_CAMP";
}

export interface ActionBindingContext {
  baseCamp: CanonicalWorld["baseCamp"];
  view: MovementWorldView;
}

function stoneById(
  world: Pick<CanonicalWorld, "stones">,
  stoneId: string,
): StoneState | null {
  return world.stones.find((stone) => stone.id === stoneId) ?? null;
}

function interactionReachValid(stance: Vec3, target: Vec3) {
  const horizontalM = Math.hypot(
    stance.x - target.x,
    stance.z - target.z,
  );
  const relativeHeightM = target.y - stance.y;
  return (
    horizontalM <=
      CLIMBER.maximumInteractionHorizontalReachM + 1e-9 &&
    relativeHeightM >= CLIMBER.minimumInteractionHeightM - 1e-9 &&
    relativeHeightM <= CLIMBER.maximumInteractionHeightM + 1e-9
  );
}

function pointCell(point: Vec3): VoxelCoordinate {
  return {
    x: Math.floor(point.x / TERRAIN.voxelEdgeM),
    y: Math.floor(point.y / TERRAIN.voxelEdgeM),
    z: Math.floor(point.z / TERRAIN.voxelEdgeM),
  };
}

function interactionVisible(
  stance: Vec3,
  target: Vec3,
  targetCell: VoxelCoordinate,
  view: MovementWorldView,
) {
  const origin = {
    x: stance.x,
    y: stance.y + CLIMBER.clearanceHeightM * 0.55,
    z: stance.z,
  };
  const distanceM = Math.hypot(
    target.x - origin.x,
    target.y - origin.y,
    target.z - origin.z,
  );
  const subdivisions = Math.max(
    1,
    Math.ceil(distanceM / CLIMBER.interactionVisibilitySampleM),
  );
  const targetKey = voxelKey(targetCell);
  for (let part = 1; part < subdivisions; part += 1) {
    const fraction = part / subdivisions;
    const cell = pointCell({
      x: origin.x + (target.x - origin.x) * fraction,
      y: origin.y + (target.y - origin.y) * fraction,
      z: origin.z + (target.z - origin.z) * fraction,
    });
    if (voxelKey(cell) !== targetKey && solidAt(view, cell)) {
      return false;
    }
  }
  return true;
}

function validateInteraction(
  stance: Vec3,
  target: Vec3,
  targetCell: VoxelCoordinate,
  view: MovementWorldView,
): ActionBindingVerdict | null {
  if (!interactionReachValid(stance, target)) {
    return { valid: false, code: "ACTION_POSITION_MISMATCH" };
  }
  if (!interactionVisible(stance, target, targetCell, view)) {
    return { valid: false, code: "ACTION_OCCLUDED" };
  }
  return null;
}

export function validateActionPickupBinding(
  action: ExpeditionAction,
  pickupPoint: Vec3,
  context: ActionBindingContext,
): ActionBindingVerdict {
  const { baseCamp, view } = context;
  if (
    action.source.kind === "BASE" &&
    !isInsideBaseCamp(
      pickupPoint,
      { baseCamp },
      view.terrain,
    )
  ) {
    return { valid: false, code: "BASE_PICKUP_OUTSIDE_CAMP" };
  }

  if (action.source.kind !== "BASE") {
    const targetCell =
      action.source.kind === "STONE"
        ? stoneById(view.world, action.matterId)?.cell
        : action.source.voxel;
    if (!targetCell) {
      return { valid: false, code: "ACTION_POSITION_MISMATCH" };
    }
    const interaction = validateInteraction(
      pickupPoint,
      voxelCenter(targetCell),
      targetCell,
      view,
    );
    if (interaction) return interaction;
  }

  if (
    action.source.kind !== "BASE" &&
    isInsideSpawnCore(
      action.source.kind === "TERRAIN"
        ? voxelCenter(action.source.voxel)
        : (() => {
            const stone = stoneById(view.world, action.matterId);
            return stone ? voxelCenter(stone.cell) : baseCamp;
          })(),
      { baseCamp },
    )
  ) {
    return { valid: false, code: "SPAWN_CORE_PROTECTED" };
  }

  return { valid: true, code: "ACTION_BOUND" };
}

export function validateActionReleaseBinding(
  action: ExpeditionAction,
  releasePoint: Vec3,
  context: ActionBindingContext,
): ActionBindingVerdict {
  const { baseCamp, view } = context;
  if (
    action.destination.kind === "BASE" &&
    !isInsideBaseCamp(
      releasePoint,
      { baseCamp },
      view.terrain,
    )
  ) {
    return { valid: false, code: "BASE_RELEASE_OUTSIDE_CAMP" };
  }

  const destinationCell = mutationDestinationCell(action);
  const destinationPoint = destinationCell
    ? voxelCenter(destinationCell)
    : null;
  if (destinationCell && destinationPoint) {
    const interaction = validateInteraction(
      releasePoint,
      destinationPoint,
      destinationCell,
      view,
    );
    if (interaction) return interaction;
  }
  if (
    destinationPoint &&
    action.source.kind === "BASE" &&
    isInsideBaseCamp(
      destinationPoint,
      { baseCamp },
      view.terrain,
    )
  ) {
    return { valid: false, code: "BASE_IMPORT_INSIDE_CAMP" };
  }
  if (
    destinationPoint &&
    isInsideSpawnCore(destinationPoint, { baseCamp })
  ) {
    return { valid: false, code: "SPAWN_CORE_PROTECTED" };
  }
  return { valid: true, code: "ACTION_BOUND" };
}
