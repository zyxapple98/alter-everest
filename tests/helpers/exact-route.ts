import { currentTopVoxel } from "../../engine/surface";
import type { TerrainOracle } from "../../engine/terrain";
import type {
  PhysicsSnapshot,
  RouteStance,
} from "../../engine/types";

export function surfaceLine(
  terrain: TerrainOracle,
  world: Pick<PhysicsSnapshot, "removedTerrainVoxels">,
  input: {
    startX: number;
    startZ: number;
    endX: number;
    endZ: number;
  },
) {
  const dx = input.endX - input.startX;
  const dz = input.endZ - input.startZ;
  const steps = Math.max(Math.abs(dx), Math.abs(dz));
  if (steps < 1) throw new Error("surfaceLine requires distinct columns.");
  const stances: Omit<RouteStance, "step">[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(input.startX + (dx * step) / steps);
    const z = Math.round(input.startZ + (dz * step) / steps);
    const top = currentTopVoxel(
      terrain,
      world.removedTerrainVoxels,
      x,
      z,
    );
    if (top === null) throw new Error(`No terrain at ${x}:${z}.`);
    stances.push({
      cell: { x, y: top + 1, z },
    });
  }
  return stances;
}

export function roundTrip(
  outbound: readonly Omit<RouteStance, "step">[],
) {
  if (outbound.length < 2) throw new Error("roundTrip needs an outbound path.");
  return [
    ...outbound.map((stance) => ({
      cell: { ...stance.cell },
    })),
    ...outbound
      .slice(0, -1)
      .reverse()
      .map((stance) => ({
        cell: { ...stance.cell },
      })),
  ];
}
