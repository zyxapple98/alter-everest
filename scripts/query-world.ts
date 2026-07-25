import { voxelCenter } from "../engine/mutation";
import { loadCanonicalWorld } from "./expedition-kit";

const MAXIMUM_RESULTS = 200;

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function numericArgument(name: string, fallback?: number) {
  const raw = argument(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(
      "Usage: npm run world:query -- --x <metres> --z <metres> [--radius <metres>] [--world <snapshot.json>]",
    );
  }
  return value;
}

if (process.argv.includes("--help")) {
  console.log(
    "Usage: npm run world:query -- --x <metres> --z <metres> [--radius <metres>] [--world <snapshot.json>]",
  );
  process.exit(0);
}

const x = numericArgument("--x");
const z = numericArgument("--z");
const radiusM = numericArgument("--radius", 200);
if (radiusM <= 0 || radiusM > 5_000) {
  throw new Error("--radius must be greater than 0 and at most 5000 metres.");
}

const world = await loadCanonicalWorld(argument("--world"));
const withinRadius = (point: { x: number; z: number }) =>
  Math.hypot(point.x - x, point.z - z) <= radiusM;
const withDistance = <T extends { position: { x: number; z: number } }>(
  entry: T,
) => ({
  ...entry,
  distanceM: Math.hypot(
    entry.position.x - x,
    entry.position.z - z,
  ),
});
const sortByDistance = <T extends { distanceM: number }>(entries: T[]) =>
  entries.sort(
    (left, right) => left.distanceM - right.distanceM,
  );

const matchingStones = sortByDistance(
  world.stones
    .map((stone) =>
      withDistance({
        id: stone.id,
        cell: stone.cell,
        position: voxelCenter(stone.cell),
      }),
    )
    .filter((stone) => withinRadius(stone.position)),
);
const matchingRemovedTerrain = sortByDistance(
  world.removedTerrainVoxels
    .map((cell) =>
      withDistance({ cell, position: voxelCenter(cell) }),
    )
    .filter((voxel) => withinRadius(voxel.position)),
);
const matchingTombstones = sortByDistance(
  world.tombstones
    .map((tombstone) =>
      withDistance({
        id: tombstone.id,
        agentId: tombstone.agentId,
        expeditionId: tombstone.expeditionId,
        altitudeM: tombstone.altitudeM,
        position: tombstone.position,
      }),
    )
    .filter((tombstone) => withinRadius(tombstone.position)),
);

console.log(
  JSON.stringify(
    {
      world: {
        sequence: world.sequence,
        worldHash: world.worldHash,
        terrainHash: world.terrainHash,
      },
      query: { x, z, radiusM },
      counts: {
        stones: matchingStones.length,
        removedTerrainVoxels: matchingRemovedTerrain.length,
        tombstones: matchingTombstones.length,
      },
      truncated: {
        stones: matchingStones.length > MAXIMUM_RESULTS,
        removedTerrainVoxels:
          matchingRemovedTerrain.length > MAXIMUM_RESULTS,
        tombstones: matchingTombstones.length > MAXIMUM_RESULTS,
      },
      stones: matchingStones.slice(0, MAXIMUM_RESULTS),
      removedTerrainVoxels: matchingRemovedTerrain.slice(
        0,
        MAXIMUM_RESULTS,
      ),
      tombstones: matchingTombstones.slice(0, MAXIMUM_RESULTS),
      next:
        "Use terrain:query at exact interaction points; this spatial result is canonical matter, not a physics verdict.",
    },
    null,
    2,
  ),
);
