import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { CLIMBER, TERRAIN } from "../engine/constants";
import { chunkForVoxel, currentTopVoxel, tileForVoxel } from "../engine/surface";
import { voxelCenter } from "../engine/mutation";
import { loadCanonicalWorld, loadDemBundle } from "./expedition-kit";

const usage =
  "Usage: npm run terrain:query -- (--x <metres> --z <metres> | --points <points.json>) [--summary] [--out <result.json>] [--world <snapshot.json>]";

if (process.argv.includes("--help")) {
  console.log(usage);
  process.exit(0);
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

interface QueryPoint {
  x: number;
  z: number;
  label?: string;
}

const pointsPath = argument("--points");
let points: QueryPoint[];
if (pointsPath) {
  const document = JSON.parse(
    await readFile(resolve(pointsPath), "utf8"),
  ) as unknown;
  if (
    !Array.isArray(document) ||
    document.length < 1 ||
    document.length > 512 ||
    document.some(
      (point) =>
        typeof point !== "object" ||
        point === null ||
        !Number.isFinite((point as QueryPoint).x) ||
        !Number.isFinite((point as QueryPoint).z) ||
        ((point as QueryPoint).label !== undefined &&
          typeof (point as QueryPoint).label !== "string"),
    )
  ) {
    throw new Error(
      "--points must contain 1-512 objects with finite x/z and an optional string label.",
    );
  }
  points = document as QueryPoint[];
} else {
  const x = Number(argument("--x"));
  const z = Number(argument("--z"));
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    throw new Error(usage);
  }
  points = [{ x, z }];
}

const [world, terrain] = await Promise.all([
  loadCanonicalWorld(argument("--world")),
  loadDemBundle(),
]);

function queryPoint({ x, z, label }: QueryPoint) {
  const columnX = Math.floor(x / TERRAIN.voxelEdgeM);
  const columnZ = Math.floor(z / TERRAIN.voxelEdgeM);
  const y = currentTopVoxel(
    terrain.oracle,
    world.removedTerrainVoxels,
    columnX,
    columnZ,
  );
  if (y === null) throw new Error(`OUTSIDE_TERRAIN at (${x}, ${z})`);
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

  return {
      ...(label === undefined ? {} : { label }),
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
  };
}

const results = points.map(queryPoint);
const summary = process.argv.includes("--summary");
const outputResults = summary
  ? results.map((result) => ({
      ...("label" in result ? { label: result.label } : {}),
      query: result.query,
      terrain: {
        altitudeM:
          terrain.config.registration.verticalDatumM +
          result.measured.y,
        slopeDegrees: result.measured.slopeDegrees,
        surface: result.measured.surface,
      },
      zones: result.zones,
      exposedVoxel: result.exposedVoxel,
      candidateGroundedCell: result.candidateGroundedCell,
      chunk: result.chunk,
      tile: result.tile,
    }))
  : results;
const outputPayload = pointsPath
  ? {
      count: outputResults.length,
      results: outputResults,
      terrainHash: terrain.config.terrainHash,
    }
  : outputResults[0];
const output = `${JSON.stringify(
  outputPayload,
    null,
    2,
  )}\n`;
const outputPath = argument("--out");
if (outputPath) {
  const resolvedOutput = resolve(outputPath);
  await mkdir(dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, output);
  console.log(
    JSON.stringify(
      {
        wrote: resolvedOutput,
        count: outputResults.length,
        summary,
      },
      null,
      2,
    ),
  );
} else {
  process.stdout.write(output);
}
