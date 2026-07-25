import { CLIMBER } from "./constants";
import {
  isInsideSpawnCore,
  mutationDestinationCell,
  voxelCenter,
} from "./mutation";
import type {
  CanonicalWorld,
  ExpeditionProof,
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
    | "BASE_IMPORT_INSIDE_CAMP";
}

function distance(a: Vec3, b: Vec3) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function sampleAt(route: RouteSample[], index: number | undefined) {
  return index === undefined ? null : route[index] ?? null;
}

function stoneById(world: CanonicalWorld, stoneId: string): StoneState | null {
  return world.stones.find((stone) => stone.id === stoneId) ?? null;
}

export function validateActionBinding(
  proof: ExpeditionProof,
  world: CanonicalWorld,
): ActionBindingVerdict {
  const releaseSample = sampleAt(proof.route, proof.releaseIndex);
  const destinationCell = mutationDestinationCell(proof.mutation);
  const releasePoint = destinationCell ? voxelCenter(destinationCell) : null;
  if (
    releasePoint &&
    (!releaseSample ||
      distance(releaseSample, releasePoint) > CLIMBER.interactionReachM)
  ) {
    return { valid: false, code: "ACTION_POSITION_MISMATCH" };
  }

  if (
    releasePoint &&
    proof.mutation.source.kind === "BASE" &&
    distance(releasePoint, world.baseCamp) <= CLIMBER.baseCampRadiusM
  ) {
    return { valid: false, code: "BASE_IMPORT_INSIDE_CAMP" };
  }
  if (releasePoint && isInsideSpawnCore(releasePoint, world)) {
    return { valid: false, code: "SPAWN_CORE_PROTECTED" };
  }

  if (proof.mutation.source.kind !== "BASE") {
    const pickupSample = sampleAt(proof.route, proof.pickupIndex);
    const target =
      proof.mutation.source.kind === "STONE"
        ? (() => {
            const stone = stoneById(world, proof.mutation.source.stoneId);
            return stone ? voxelCenter(stone.cell) : undefined;
          })()
        : voxelCenter(proof.mutation.source.voxel);
    if (
      !pickupSample ||
      !target ||
      distance(pickupSample, target) >
        CLIMBER.interactionReachM
    ) {
      return { valid: false, code: "ACTION_POSITION_MISMATCH" };
    }
  }

  if (
    proof.mutation.source.kind !== "BASE" &&
    isInsideSpawnCore(
      proof.mutation.source.kind === "TERRAIN"
        ? voxelCenter(proof.mutation.source.voxel)
        : (() => {
            const stone = stoneById(world, proof.mutation.source.stoneId);
            return stone ? voxelCenter(stone.cell) : world.baseCamp;
          })(),
      world,
    )
  ) {
    return { valid: false, code: "SPAWN_CORE_PROTECTED" };
  }

  return { valid: true, code: "ACTION_BOUND" };
}
