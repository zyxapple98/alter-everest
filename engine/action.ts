import { CLIMBER } from "./constants";
import type {
  CanonicalWorld,
  ExpeditionProof,
  RouteSample,
  StoneState,
  Vec3,
} from "./types";

export interface ActionBindingVerdict {
  valid: boolean;
  code: "ACTION_BOUND" | "ACTION_POSITION_MISMATCH";
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
  if (
    proof.mutation.kind !== "RECOVER" &&
    (!releaseSample ||
      distance(releaseSample, proof.mutation.releasePose.translation) >
        CLIMBER.interactionReachM)
  ) {
    return { valid: false, code: "ACTION_POSITION_MISMATCH" };
  }

  if (proof.mutation.kind !== "ADD") {
    const pickupSample = sampleAt(proof.route, proof.pickupIndex);
    const target = stoneById(world, proof.mutation.stoneId);
    if (
      !pickupSample ||
      !target ||
      distance(pickupSample, target.pose.translation) >
        CLIMBER.interactionReachM
    ) {
      return { valid: false, code: "ACTION_POSITION_MISMATCH" };
    }
  }

  return { valid: true, code: "ACTION_BOUND" };
}
