import { voxelCenter } from "../engine/mutation";
import { TERRAIN } from "../engine/constants";
import { alterationStateForWorld } from "../engine/footprint";
import { formatPlayerHelp, PLAYER_DOCS } from "../lib/player-rules";
import { loadCanonicalWorld } from "./expedition-kit";

const MAXIMUM_RESULTS = 200;
const usage =
  "npm run world:query -- --x <metres> --z <metres> [--radius <metres>] [--world <snapshot.json>]";
const help = formatPlayerHelp({
  command: "world:query",
  purpose:
    "Inspect current stones, excavations, tombstones, and complete face-connected stone groups around a local anchor.",
  usage,
  sections: [
    {
      heading: "Authority",
      lines: [
        "Groups are geometric context only; they do not establish ownership, Build membership, or stability.",
      ],
    },
  ],
  output:
    "JSON world hashes, nearby matter, tombstones, group bounds, truncation state, and distances.",
  next: [
    "Use terrain:query at exact pickup and placement points.",
    "If changing visible shared work, inspect related Community Build context.",
  ],
  docs: [PLAYER_DOCS.matter, PLAYER_DOCS.physics, PLAYER_DOCS.community],
});

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function numericArgument(name: string, fallback?: number) {
  const raw = argument(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(
      `Usage: ${usage}`,
    );
  }
  return value as number;
}

if (process.argv.includes("--help")) {
  console.log(help);
  process.exit(0);
}

const x = numericArgument("--x");
const z = numericArgument("--z");
const radiusM = numericArgument("--radius", 200);
if (radiusM <= 0 || radiusM > 5_000) {
  throw new Error("--radius must be greater than 0 and at most 5000 metres.");
}

const world = await loadCanonicalWorld(argument("--world"));
const alterations = alterationStateForWorld(world);
const placementByStone = new Map(
  alterations.stonePlacements.map((fact) => [fact.stoneId, fact]),
);
const removalByCell = new Map(
  alterations.terrainRemovals.map((fact) => [
    `${fact.cell.x}:${fact.cell.y}:${fact.cell.z}`,
    fact,
  ]),
);
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
        provenance: placementByStone.get(stone.id) ?? null,
        position: voxelCenter(stone.cell),
      }),
    )
    .filter((stone) => withinRadius(stone.position)),
);
const matchingRemovedTerrain = sortByDistance(
  world.removedTerrainVoxels
    .map((cell) =>
      withDistance({
        cell,
        provenance:
          removalByCell.get(`${cell.x}:${cell.y}:${cell.z}`) ?? null,
        position: voxelCenter(cell),
      }),
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

const cellKey = (cell: { x: number; y: number; z: number }) =>
  `${cell.x}:${cell.y}:${cell.z}`;
const stonesByCell = new Map(
  world.stones.map((stone) => [cellKey(stone.cell), stone]),
);
const visitedStoneIds = new Set<string>();
const faceConnectedStoneGroups = matchingStones
  .map((seed) => {
    if (visitedStoneIds.has(seed.id)) return null;
    const members: typeof world.stones = [];
    const pending: typeof world.stones = [seed];
    visitedStoneIds.add(seed.id);
    while (pending.length > 0) {
      const stone = pending.pop()!;
      members.push(stone);
      for (const [dx, dy, dz] of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ]) {
        const neighbor = stonesByCell.get(
          cellKey({
            x: stone.cell.x + dx,
            y: stone.cell.y + dy,
            z: stone.cell.z + dz,
          }),
        );
        if (neighbor && !visitedStoneIds.has(neighbor.id)) {
          visitedStoneIds.add(neighbor.id);
          pending.push(neighbor);
        }
      }
    }
    if (members.length < 2) return null;
    members.sort((left, right) => left.id.localeCompare(right.id));
    const minimum = {
      x: Math.min(...members.map((stone) => stone.cell.x)),
      y: Math.min(...members.map((stone) => stone.cell.y)),
      z: Math.min(...members.map((stone) => stone.cell.z)),
    };
    const maximum = {
      x: Math.max(...members.map((stone) => stone.cell.x)),
      y: Math.max(...members.map((stone) => stone.cell.y)),
      z: Math.max(...members.map((stone) => stone.cell.z)),
    };
    return {
      id: `face-group:${members[0].id}`,
      stoneCount: members.length,
      localStoneCount: members.filter((stone) =>
        withinRadius(voxelCenter(stone.cell)),
      ).length,
      extendsBeyondQuery: members.some(
        (stone) => !withinRadius(voxelCenter(stone.cell)),
      ),
      complete: true,
      stoneIds: members.slice(0, 50).map((stone) => stone.id),
      stoneIdsTruncated: members.length > 50,
      bounds: { minimum, maximum },
      dimensionsM: {
        x: Number(
          ((maximum.x - minimum.x + 1) * TERRAIN.voxelEdgeM).toFixed(3),
        ),
        y: Number(
          ((maximum.y - minimum.y + 1) * TERRAIN.voxelEdgeM).toFixed(3),
        ),
        z: Number(
          ((maximum.z - minimum.z + 1) * TERRAIN.voxelEdgeM).toFixed(3),
        ),
      },
      distanceM: Math.min(
        ...members.map((stone) => {
          const position = voxelCenter(stone.cell);
          return Math.hypot(position.x - x, position.z - z);
        }),
      ),
    };
  })
  .filter((group) => group !== null)
  .sort(
    (left, right) =>
      right.stoneCount - left.stoneCount ||
      left.distanceM - right.distanceM,
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
        faceConnectedStoneGroups: faceConnectedStoneGroups.length,
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
      faceConnectedStoneGroups,
      next:
        "Face-connected groups include the complete world component even when it extends beyond the query radius. They are geometric hints, not project ownership or a physics verdict. Use terrain:query at exact interaction points.",
    },
    null,
    2,
  ),
);
