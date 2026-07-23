import { PHYSICS } from "./constants";
import { loadPhysicsRuntime } from "./physics";
import type { PhysicsSnapshot, RouteSample } from "./types";

const CLIMBER_RADIUS_M = 0.3;
const CLIMBER_HEIGHT_M = 1.72;

export interface ClearanceVerdict {
  clear: boolean;
  blockedSegmentIndex: number | null;
  stoneId: string | null;
}

export async function validateRouteClearance(
  snapshot: PhysicsSnapshot,
  route: RouteSample[],
  excludedStoneIds: ReadonlySet<string> = new Set(),
): Promise<ClearanceVerdict> {
  const RAPIER = await loadPhysicsRuntime();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const colliderToStone = new Map<number, string>();
  const halfEdge = PHYSICS.stoneEdgeM / 2;

  for (const stone of [...snapshot.stones].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    // A MOVE or RECOVER proof may terminate its approach at the target stone.
    // The caller excludes that stone because it becomes carried at pickup;
    // every other contributed stone remains a hard collision obstacle.
    if (excludedStoneIds.has(stone.id)) continue;

    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfEdge, halfEdge, halfEdge)
        .setTranslation(
          stone.pose.translation.x,
          stone.pose.translation.y,
          stone.pose.translation.z,
        )
        .setRotation(stone.pose.rotation),
    );
    colliderToStone.set(collider.handle, stone.id);
  }

  world.propagateModifiedBodyPositionsToColliders();
  world.step();
  const capsule = new RAPIER.Capsule(
    (CLIMBER_HEIGHT_M - CLIMBER_RADIUS_M * 2) / 2,
    CLIMBER_RADIUS_M,
  );
  const rotation = { x: 0, y: 0, z: 0, w: 1 };

  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1];
    const to = route[index];
    const center = {
      x: from.x,
      y: from.y + CLIMBER_HEIGHT_M / 2,
      z: from.z,
    };
    const velocity = {
      x: to.x - from.x,
      y: to.y - from.y,
      z: to.z - from.z,
    };
    const hit = world.castShape(
      center,
      rotation,
      velocity,
      capsule,
      0,
      1,
      true,
    );
    if (hit) {
      const stoneId = colliderToStone.get(hit.collider.handle) ?? null;
      world.free();
      return {
        clear: false,
        blockedSegmentIndex: index - 1,
        stoneId,
      };
    }
  }

  world.free();
  return { clear: true, blockedSegmentIndex: null, stoneId: null };
}
