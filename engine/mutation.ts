import { CLIMBER, TERRAIN } from "./constants";
import type {
  CanonicalWorld,
  ExpeditionAction,
  ExpeditionOperation,
  MatterMutation,
  MutationOperation,
  VoxelCoordinate,
} from "./types";

export function mutationDestinationCell(
  mutation: MatterMutation,
): VoxelCoordinate | null {
  return mutation.destination.kind === "WORLD"
    ? mutation.destination.cell
    : null;
}

export function mutationStoneId(mutation: MatterMutation) {
  return mutation.matterId;
}

export function voxelKey(voxel: VoxelCoordinate) {
  return `${voxel.x}:${voxel.y}:${voxel.z}`;
}

export function parseVoxelKey(key: string): VoxelCoordinate {
  const [x, y, z] = key.split(":").map(Number);
  return { x, y, z };
}

export function voxelCenter(voxel: VoxelCoordinate) {
  return {
    x: (voxel.x + 0.5) * TERRAIN.voxelEdgeM,
    y: (voxel.y + 0.5) * TERRAIN.voxelEdgeM,
    z: (voxel.z + 0.5) * TERRAIN.voxelEdgeM,
  };
}

export function voxelTopCenter(voxel: VoxelCoordinate) {
  const center = voxelCenter(voxel);
  return { ...center, y: (voxel.y + 1) * TERRAIN.voxelEdgeM };
}

export function isInsideSpawnCore(
  point: { x: number; y: number; z: number },
  world: Pick<CanonicalWorld, "baseCamp">,
) {
  return (
    Math.hypot(
      point.x - world.baseCamp.x,
      point.z - world.baseCamp.z,
    ) < CLIMBER.protectedSpawnRadiusM
  );
}

export function isInsideBaseCamp(
  point: { x: number; y: number; z: number },
  world: Pick<CanonicalWorld, "baseCamp">,
) {
  return (
    Math.hypot(
      point.x - world.baseCamp.x,
      point.z - world.baseCamp.z,
    ) <= CLIMBER.baseCampRadiusM + 1e-6
  );
}

export function operationLabel(
  mutation: MatterMutation,
): MutationOperation {
  if (mutation.source.kind === "BASE") return "ADD";
  if (mutation.destination.kind === "BASE") return "RECOVER";
  if (mutation.source.kind === "TERRAIN") return "QUARRY";
  return "MOVE";
}

export function operationSummary(
  actions: readonly ExpeditionAction[],
): ExpeditionOperation {
  return actions.length === 1 ? operationLabel(actions[0]) : "MULTI";
}

export function actionStoneIds(actions: readonly ExpeditionAction[]) {
  return [...new Set(actions.map(mutationStoneId))];
}
