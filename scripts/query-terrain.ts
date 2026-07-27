import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { CLIMBER, TERRAIN } from "../engine/constants";
import { alterationStateForWorld } from "../engine/footprint";
import { voxelCenter, voxelKey } from "../engine/mutation";
import {
  chunkForVoxel,
  currentTopVoxel,
  isExposedTerrainVoxel,
  isSolidTerrainVoxel,
  tileForVoxel,
} from "../engine/surface";
import type { VoxelCoordinate } from "../engine/types";
import { formatPlayerHelp, PLAYER_DOCS } from "../lib/player-rules";
import { loadCanonicalWorld, loadDemBundle } from "./expedition-kit";

const usage =
  "npm run terrain:query -- (--x <metres> --z <metres> | --points <points.json> | --cell-x <int> --cell-y <int> --cell-z <int> | --cells <cells.json> | --chunk <x:z>) [--compact | --summary] [--out <result.json>] [--world <snapshot.json>]";
const help = formatPlayerHelp({
  command: "terrain:query",
  purpose:
    "Inspect exact 20 cm cells, surface columns, batches or one complete 32 m physics chunk without choosing a route.",
  usage,
  sections: [
    {
      heading: "Modes",
      lines: [
        "--x/--z or --points       query surface columns in metre coordinates",
        "--cell-x/--cell-y/--cell-z or --cells   query exact voxel occupancy",
        "--chunk <x:z>             return all 25,600 exact surface columns in one physics chunk",
        "--compact                 encode a chunk as ordered numeric arrays plus sparse stones",
        "--summary                 return chunk bounds and counts without columns",
        "--out <result.json>       recommended for chunk output",
        "--world <snapshot.json>   include current excavation and stones",
      ],
    },
  ],
  output:
    "Canonical terrain/world hashes plus exact occupancy, support, surface, chunk and provenance facts.",
  next: [
    "Use move:check for one proposed exact transition.",
    "Use route:encode only after the full trace has been chosen.",
  ],
  docs: [PLAYER_DOCS.route, PLAYER_DOCS.matter, PLAYER_DOCS.physics],
});

if (process.argv.includes("--help")) {
  console.log(help);
  process.exit(0);
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function jsonArray(path: string, maximum: number) {
  const value = JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    throw new Error(`${path} must contain 1–${maximum} entries.`);
  }
  return value;
}

interface QueryPoint {
  x: number;
  z: number;
  label?: string;
}

interface QueryCell extends VoxelCoordinate {
  label?: string;
}

const [world, terrain] = await Promise.all([
  loadCanonicalWorld(argument("--world")),
  loadDemBundle(),
]);
const removed = new Set(world.removedTerrainVoxels.map(voxelKey));
const stonesByCell = new Map(
  world.stones.map((stone) => [voxelKey(stone.cell), stone]),
);
const alterations = alterationStateForWorld(world);
const removalFacts = new Map(
  alterations.terrainRemovals.map((fact) => [voxelKey(fact.cell), fact]),
);

function columnResult(columnX: number, columnZ: number, label?: string) {
  const x = (columnX + 0.5) * TERRAIN.voxelEdgeM;
  const z = (columnZ + 0.5) * TERRAIN.voxelEdgeM;
  const topY = currentTopVoxel(
    terrain.oracle,
    world.removedTerrainVoxels,
    columnX,
    columnZ,
  );
  if (topY === null) throw new Error(`OUTSIDE_TERRAIN at ${columnX}:${columnZ}`);
  const top = { x: columnX, y: topY, z: columnZ };
  const stance = { x: columnX, y: topY + 1, z: columnZ };
  const truth = terrain.oracle.sample(x, z)!;
  const distanceFromBaseM = Math.hypot(
    x - world.baseCamp.x,
    z - world.baseCamp.z,
  );
  return {
    ...(label === undefined ? {} : { label }),
    column: { x: columnX, z: columnZ },
    positionM: { x, z },
    truth,
    topTerrainVoxel: top,
    exactSurfaceStance: stance,
    stanceOccupiedByStoneId:
      stonesByCell.get(voxelKey(stance))?.id ?? null,
    zones: {
      insideBaseCamp:
        distanceFromBaseM <= CLIMBER.baseCampRadiusM + 1e-6,
      insideSpawnCore:
        distanceFromBaseM < CLIMBER.protectedSpawnRadiusM,
    },
    chunk: chunkForVoxel(top),
    tile: tileForVoxel(top),
  };
}

function cellResult(cell: QueryCell) {
  const key = voxelKey(cell);
  const stone = stonesByCell.get(key) ?? null;
  const solidTerrain = isSolidTerrainVoxel(
    terrain.oracle,
    removed,
    cell,
  );
  return {
    ...(cell.label === undefined ? {} : { label: cell.label }),
    cell: { x: cell.x, y: cell.y, z: cell.z },
    centerM: voxelCenter(cell),
    solidTerrain,
    removedTerrain: removalFacts.get(key) ?? null,
    stone,
    occupied: solidTerrain || stone !== null,
    exposedTerrain:
      solidTerrain &&
      isExposedTerrainVoxel(
        terrain.oracle,
        world.removedTerrainVoxels,
        cell,
      ),
    supportForStanceAbove: solidTerrain || stone !== null,
    chunk: chunkForVoxel(cell),
    tile: tileForVoxel(cell),
  };
}

let payload: unknown;
let count = 0;
const chunk = argument("--chunk");
const cellsPath = argument("--cells");
const pointsPath = argument("--points");
if (chunk) {
  const match = /^(-?\d+):(-?\d+)$/.exec(chunk);
  if (!match) throw new Error("--chunk must use integer x:z.");
  const chunkX = Number(match[1]);
  const chunkZ = Number(match[2]);
  const columnsPerChunk =
    TERRAIN.physicsChunkEdgeM / TERRAIN.voxelEdgeM;
  const columns = [];
  for (let localX = 0; localX < columnsPerChunk; localX += 1) {
    for (let localZ = 0; localZ < columnsPerChunk; localZ += 1) {
      columns.push(
        columnResult(
          chunkX * columnsPerChunk + localX,
          chunkZ * columnsPerChunk + localZ,
        ),
      );
    }
  }
  count = columns.length;
  const topY = columns.map((column) => column.topTerrainVoxel.y);
  const query = { chunk: { x: chunkX, z: chunkZ } };
  if (process.argv.includes("--summary")) {
    payload = {
      query,
      topTerrainVoxelY: {
        minimum: Math.min(...topY),
        maximum: Math.max(...topY),
      },
      occupiedSurfaceStances: columns.filter(
        (column) => column.stanceOccupiedByStoneId !== null,
      ).length,
    };
  } else if (process.argv.includes("--compact")) {
    payload = {
      query,
      encoding: "ae-surface-columns-v1",
      order: "x-major-z-minor",
      originColumn: {
        x: chunkX * columnsPerChunk,
        z: chunkZ * columnsPerChunk,
      },
      width: columnsPerChunk,
      depth: columnsPerChunk,
      voxelEdgeM: TERRAIN.voxelEdgeM,
      topTerrainVoxelY: topY,
      altitudeM: columns.map((column) => column.truth.altitudeM),
      slopeDegrees: columns.map(
        (column) => column.truth.slopeDegrees,
      ),
      surfaceStanceStones: columns.flatMap((column, index) =>
        column.stanceOccupiedByStoneId === null
          ? []
          : [
              {
                index,
                stoneId: column.stanceOccupiedByStoneId,
              },
            ],
      ),
      zones: {
        baseCamp: world.baseCamp,
        baseCampRadiusM: CLIMBER.baseCampRadiusM,
        protectedSpawnRadiusM: CLIMBER.protectedSpawnRadiusM,
      },
    };
  } else {
    payload = { query, columns };
  }
} else if (cellsPath) {
  const raw = await jsonArray(cellsPath, 4096);
  const cells = raw.map((value, index) => {
    const cell = value as QueryCell;
    if (
      !cell ||
      !Number.isSafeInteger(cell.x) ||
      !Number.isSafeInteger(cell.y) ||
      !Number.isSafeInteger(cell.z) ||
      (cell.label !== undefined && typeof cell.label !== "string")
    ) {
      throw new Error(`cell ${index} requires integer x/y/z.`);
    }
    return cellResult(cell);
  });
  count = cells.length;
  payload = { cells };
} else if (argument("--cell-x") !== undefined) {
  const cell = {
    x: Number(argument("--cell-x")),
    y: Number(argument("--cell-y")),
    z: Number(argument("--cell-z")),
  };
  if (
    !Number.isSafeInteger(cell.x) ||
    !Number.isSafeInteger(cell.y) ||
    !Number.isSafeInteger(cell.z)
  ) {
    throw new Error("Exact cell mode requires integer --cell-x/--cell-y/--cell-z.");
  }
  count = 1;
  payload = cellResult(cell);
} else {
  let points: QueryPoint[];
  if (pointsPath) {
    const raw = await jsonArray(pointsPath, 4096);
    points = raw as QueryPoint[];
    if (
      points.some(
        (point) =>
          !Number.isFinite(point.x) ||
          !Number.isFinite(point.z) ||
          (point.label !== undefined && typeof point.label !== "string"),
      )
    ) {
      throw new Error("--points entries require finite x/z.");
    }
  } else {
    const x = Number(argument("--x"));
    const z = Number(argument("--z"));
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      throw new Error(`Usage: ${usage}`);
    }
    points = [{ x, z }];
  }
  const columns = points.map((point) =>
    columnResult(
      Math.floor(point.x / TERRAIN.voxelEdgeM),
      Math.floor(point.z / TERRAIN.voxelEdgeM),
      point.label,
    ),
  );
  count = columns.length;
  payload = pointsPath ? { columns } : columns[0];
}

const document = {
  world: {
    sequence: world.sequence,
    worldHash: world.worldHash,
    terrainHash: world.terrainHash,
  },
  count,
  payload,
};
const output = `${JSON.stringify(document, null, 2)}\n`;
const outputPath = argument("--out");
if (outputPath) {
  const resolved = resolve(outputPath);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, output);
  console.log(JSON.stringify({ wrote: resolved, count }, null, 2));
} else {
  process.stdout.write(output);
}
