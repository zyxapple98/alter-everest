import { TERRAIN } from "./constants";
import { voxelCenter } from "./mutation";
import type { PhysicsSnapshot, RouteSample } from "./types";

const CLIMBER_RADIUS_M = 0.3;
const CLIMBER_HEIGHT_M = 1.72;

export interface ClearanceVerdict {
  clear: boolean;
  blockedSegmentIndex: number | null;
  stoneId: string | null;
}

interface Bounds {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

function segmentIntersectsBounds(
  from: RouteSample,
  to: RouteSample,
  bounds: Bounds,
) {
  let minimum = 0;
  let maximum = 1;
  for (const axis of ["x", "y", "z"] as const) {
    const delta = to[axis] - from[axis];
    if (Math.abs(delta) < 1e-12) {
      if (from[axis] < bounds.min[axis] || from[axis] > bounds.max[axis]) {
        return false;
      }
      continue;
    }
    const first = (bounds.min[axis] - from[axis]) / delta;
    const second = (bounds.max[axis] - from[axis]) / delta;
    const entry = Math.min(first, second);
    const exit = Math.max(first, second);
    minimum = Math.max(minimum, entry);
    maximum = Math.min(maximum, exit);
    if (minimum > maximum) return false;
  }
  return true;
}

function isWalkableTop(
  from: RouteSample,
  to: RouteSample,
  stoneTopY: number,
) {
  const tolerance = TERRAIN.voxelEdgeM * 0.15;
  if (
    from.y >= stoneTopY - tolerance &&
    to.y >= stoneTopY - tolerance
  ) {
    return true;
  }
  const step = Math.abs(to.y - from.y);
  return (
    step <= TERRAIN.voxelEdgeM * 2.1 &&
    (Math.abs(from.y - stoneTopY) <= tolerance ||
      Math.abs(to.y - stoneTopY) <= tolerance)
  );
}

export async function validateRouteClearance(
  snapshot: PhysicsSnapshot,
  route: RouteSample[],
  excludedStoneIds: ReadonlySet<string> = new Set(),
): Promise<ClearanceVerdict> {
  const edge = TERRAIN.voxelEdgeM;
  const obstacles = snapshot.stones
    .filter((stone) => !excludedStoneIds.has(stone.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((stone) => {
      const center = voxelCenter(stone.cell);
      return {
        id: stone.id,
        topY: center.y + edge / 2,
        bounds: {
          min: {
            x: center.x - edge / 2 - CLIMBER_RADIUS_M,
            y: center.y - edge / 2 - CLIMBER_HEIGHT_M,
            z: center.z - edge / 2 - CLIMBER_RADIUS_M,
          },
          max: {
            x: center.x + edge / 2 + CLIMBER_RADIUS_M,
            y: center.y + edge / 2 - 1e-6,
            z: center.z + edge / 2 + CLIMBER_RADIUS_M,
          },
        },
      };
    });

  for (let index = 0; index < route.length; index += 1) {
    const sample = route[index];
    for (const obstacle of obstacles) {
      if (isWalkableTop(sample, sample, obstacle.topY)) continue;
      if (segmentIntersectsBounds(sample, sample, obstacle.bounds)) {
        return {
          clear: false,
          blockedSegmentIndex: Math.max(0, index - 1),
          stoneId: obstacle.id,
        };
      }
    }
  }

  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1];
    const to = route[index];
    for (const obstacle of obstacles) {
      if (isWalkableTop(from, to, obstacle.topY)) continue;
      if (segmentIntersectsBounds(from, to, obstacle.bounds)) {
        return {
          clear: false,
          blockedSegmentIndex: index - 1,
          stoneId: obstacle.id,
        };
      }
    }
  }
  return { clear: true, blockedSegmentIndex: null, stoneId: null };
}
