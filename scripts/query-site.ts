import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CLIMBER, TERRAIN } from "../engine/constants";
import { voxelCenter } from "../engine/mutation";
import { currentTopVoxel } from "../engine/surface";
import { loadCanonicalWorld, loadDemBundle } from "./expedition-kit";

const METERS_PER_DEGREE_LATITUDE = 111_320;

function usage() {
  return "Usage: npm run site:query -- --site <site-id-or-name> [--world <snapshot.json>]";
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
const worldPath = argument("--world");
const [world, terrain, siteDocument] = await Promise.all([
  loadCanonicalWorld(worldPath),
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

const safeStopCandidates = [];
const radialSteps = 6;
const angularSteps = 16;
for (let radialStep = 0; radialStep <= radialSteps; radialStep += 1) {
  const radiusM = (site.radiusM * radialStep) / radialSteps;
  const samples = radialStep === 0 ? 1 : angularSteps;
  for (let angularStep = 0; angularStep < samples; angularStep += 1) {
    const angle = (Math.PI * 2 * angularStep) / samples;
    const candidateX = x + Math.cos(angle) * radiusM;
    const candidateZ = z + Math.sin(angle) * radiusM;
    const candidateTruth = terrain.oracle.sample(candidateX, candidateZ);
    if (
      !candidateTruth ||
      candidateTruth.slopeDegrees > CLIMBER.maxWalkSlopeDegrees
    ) {
      continue;
    }
    safeStopCandidates.push({
      x: candidateX,
      y: candidateTruth.y,
      z: candidateZ,
      altitudeM:
        terrain.config.registration.verticalDatumM + candidateTruth.y,
      slopeDegrees: candidateTruth.slopeDegrees,
      surface: candidateTruth.surface,
      safeStop: true,
      distanceFromAnchorM: radiusM,
    });
  }
}
const nearbySafeStops = safeStopCandidates
  .sort(
    (left, right) =>
      left.distanceFromAnchorM - right.distanceFromAnchorM ||
      left.slopeDegrees - right.slopeDegrees,
  )
  .slice(0, 5);

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
const worldSuffix = worldPath ? ` --world "${worldPath}"` : "";

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
      nearbySafeStops: {
        maximumWalkSlopeDegrees: CLIMBER.maxWalkSlopeDegrees,
        samples: nearbySafeStops,
        note:
          "Route-terminal planning hints within the site radius. Recheck route clearance and the full verifier.",
      },
      next: [
        `npm run world:query -- --x ${x} --z ${z} --radius ${site.radiusM}${worldSuffix}`,
        `npm run terrain:query -- --x ${x} --z ${z}${worldSuffix}`,
      ],
    },
    null,
    2,
  ),
);
