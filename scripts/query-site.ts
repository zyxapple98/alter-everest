import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CLIMBER, TERRAIN } from "../engine/constants";
import { voxelCenter } from "../engine/mutation";
import { currentTopVoxel } from "../engine/surface";
import { loadCanonicalWorld, loadDemBundle } from "./expedition-kit";

const METERS_PER_DEGREE_LATITUDE = 111_320;

function usage() {
  return "Usage: npm run site:query -- --site <site-id-or-name>";
}

function siteArgument() {
  if (process.argv.includes("--help")) {
    console.log(usage());
    process.exit(0);
  }
  const index = process.argv.indexOf("--site");
  const value = index < 0 ? "" : (process.argv[index + 1] ?? "").trim();
  if (!value) throw new Error(usage());
  return value;
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function sameCell(
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number },
) {
  return left.x === right.x && left.y === right.y && left.z === right.z;
}

const requestedSite = siteArgument();
const [world, terrain, siteDocument] = await Promise.all([
  loadCanonicalWorld(argument("--world")),
  loadDemBundle(),
  readFile(resolve("world", "sites.json"), "utf8").then(JSON.parse),
]);
const normalized = requestedSite.toLowerCase();
const site = siteDocument.sites.find(
  (entry: { id: string; name: string }) =>
    entry.id.toLowerCase() === normalized ||
    entry.name.toLowerCase() === normalized,
);
if (!site) {
  throw new Error(
    `Unknown site "${requestedSite}". Available: ${siteDocument.sites
      .map((entry: { id: string }) => entry.id)
      .join(", ")}`,
  );
}

const registration = terrain.config.registration;
const metresPerDegreeLongitude =
  METERS_PER_DEGREE_LATITUDE *
  Math.cos((registration.originLatitude * Math.PI) / 180);
const x =
  (site.longitude - registration.originLongitude) *
  metresPerDegreeLongitude;
const z =
  (registration.originLatitude - site.latitude) *
  METERS_PER_DEGREE_LATITUDE;
const truth = terrain.oracle.sample(x, z);
if (!truth) throw new Error(`Site ${site.id} is outside authoritative terrain.`);

const columnX = Math.floor(x / TERRAIN.voxelEdgeM);
const columnZ = Math.floor(z / TERRAIN.voxelEdgeM);
const topY = currentTopVoxel(
  terrain.oracle,
  world.removedTerrainVoxels,
  columnX,
  columnZ,
);
if (topY === null) throw new Error(`Site ${site.id} has no terrain column.`);
const groundedCell = { x: columnX, y: topY + 1, z: columnZ };
const occupied = world.stones.find((stone) =>
  sameCell(stone.cell, groundedCell),
);
const distanceFromBaseM = Math.hypot(
  x - world.baseCamp.x,
  z - world.baseCamp.z,
);

console.log(
  JSON.stringify(
    {
      site,
      localAnchor: { x, y: truth.y, z },
      terrain: truth,
      distanceFromBaseM,
      zones: {
        insideBaseCamp:
          distanceFromBaseM <= CLIMBER.baseCampRadiusM + 1e-6,
        insideSpawnCore:
          distanceFromBaseM < CLIMBER.protectedSpawnRadiusM,
      },
      exposedTerrainVoxel: { x: columnX, y: topY, z: columnZ },
      candidateGroundedCell: {
        cell: groundedCell,
        center: voxelCenter(groundedCell),
        occupiedByStoneId: occupied?.id ?? null,
        note:
          "A planning hint only. Recheck interaction reach, route clearance, occupancy and full static physics.",
      },
      next: [
        `npm run world:query -- --x ${x} --z ${z} --radius ${site.radius}`,
        `npm run terrain:query -- --x ${x} --z ${z}`,
      ],
    },
    null,
    2,
  ),
);
