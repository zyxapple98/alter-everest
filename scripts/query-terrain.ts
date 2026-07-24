import { TERRAIN } from "../engine/constants";
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

const x = numericArgument("--x");
const z = numericArgument("--z");
const [world, terrain] = await Promise.all([
  loadCanonicalWorld(),
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
const measured = terrain.oracle.sample(x, z)!;

console.log(
  JSON.stringify(
    {
      query: { x, z },
      measured,
      exposedVoxel: voxel,
      exposedVoxelCenter: voxelCenter(voxel),
      chunk: chunkForVoxel(voxel),
      tile: tileForVoxel(voxel),
      terrainHash: terrain.config.terrainHash,
    },
    null,
    2,
  ),
);
