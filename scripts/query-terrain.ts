import { CLIMBER, TERRAIN } from "../engine/constants";
import { chunkForVoxel, currentTopVoxel, tileForVoxel } from "../engine/surface";
import { voxelCenter } from "../engine/mutation";
import { loadCanonicalWorld, loadDemBundle } from "./expedition-kit";

function numericArgument(name: string) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? Number.NaN : Number(process.argv[index + 1]);
  if (!Number.isFinite(value)) {
    throw new Error(`Usage: npm run terrain:query -- --x <metres> --z <metres>`);
  }
  return value;
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const x = numericArgument("--x");
const z = numericArgument("--z");
const [world, terrain] = await Promise.all([
  loadCanonicalWorld(argument("--world")),
  loadDemBundle(),
]);
const columnX = Math.floor(x / TERRAIN.voxelEdgeM);
const columnZ = Math.floor(z / TERRAIN.voxelEdgeM);
const y = currentTopVoxel(
  terrain.oracle,
  world.removedTerrainVoxels,
  columnX,
  columnZ,
);
if (y === null) throw new Error("OUTSIDE_TERRAIN");
const voxel = { x: columnX, y, z: columnZ };
const groundedCell = { x: columnX, y: y + 1, z: columnZ };
const measured = terrain.oracle.sample(x, z)!;
const distanceFromBaseM = Math.hypot(
  x - world.baseCamp.x,
  z - world.baseCamp.z,
);
const occupied = world.stones.find(
  (stone) =>
    stone.cell.x === groundedCell.x &&
    stone.cell.y === groundedCell.y &&
    stone.cell.z === groundedCell.z,
);

console.log(
  JSON.stringify(
    {
      query: { x, z },
      measured,
      distanceFromBaseM,
      zones: {
        insideBaseCamp:
          distanceFromBaseM <= CLIMBER.baseCampRadiusM + 1e-6,
        insideSpawnCore:
          distanceFromBaseM < CLIMBER.protectedSpawnRadiusM,
      },
      exposedVoxel: voxel,
      exposedVoxelCenter: voxelCenter(voxel),
      candidateGroundedCell: {
        cell: groundedCell,
        center: voxelCenter(groundedCell),
        occupiedByStoneId: occupied?.id ?? null,
        baseImportAllowed:
          distanceFromBaseM > CLIMBER.baseCampRadiusM + 1e-6,
        matterMutationAllowed:
          distanceFromBaseM >= CLIMBER.protectedSpawnRadiusM,
        note:
          "A planning hint only. Recheck interaction reach, route clearance, occupancy and full static physics.",
      },
      chunk: chunkForVoxel(voxel),
      tile: tileForVoxel(voxel),
      terrainHash: terrain.config.terrainHash,
    },
    null,
    2,
  ),
);
