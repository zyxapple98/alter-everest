import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CLIMBER } from "../engine/constants";
import type { LocomotionMode } from "../engine/types";
import { loadDemBundle } from "./expedition-kit";

const MODES = new Set<LocomotionMode>(["WALK", "SCRAMBLE", "CLIMB"]);
const usage =
  "Usage: npm run route:annotate -- <waypoints.json> [--out <route.json>]";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

const waypointPath = process.argv[2];
if (!waypointPath || waypointPath === "--help") {
  console.log(usage);
  process.exit(0);
}

const waypoints = JSON.parse(
  await readFile(resolve(waypointPath), "utf8"),
) as unknown;
if (!Array.isArray(waypoints) || waypoints.length < 2 || waypoints.length > 4096) {
  throw new Error("waypoints must be a JSON array containing 2–4096 entries.");
}

const terrain = await loadDemBundle();
const route = waypoints.map((value, index) => {
  if (!value || typeof value !== "object") {
    throw new Error(`waypoint ${index} must be an object.`);
  }
  const waypoint = value as Record<string, unknown>;
  const x = Number(waypoint.x);
  const z = Number(waypoint.z);
  const mode = waypoint.mode as LocomotionMode;
  if (!Number.isFinite(x) || !Number.isFinite(z) || !MODES.has(mode)) {
    throw new Error(
      `waypoint ${index} requires finite x/z and mode WALK, SCRAMBLE or CLIMB.`,
    );
  }
  if (
    waypoint.protected !== undefined &&
    typeof waypoint.protected !== "boolean"
  ) {
    throw new Error(`waypoint ${index} protected must be boolean.`);
  }
  if (
    waypoint.safeStop !== undefined &&
    typeof waypoint.safeStop !== "boolean"
  ) {
    throw new Error(`waypoint ${index} safeStop must be boolean.`);
  }
  const truth = terrain.oracle.sample(x, z);
  if (!truth) throw new Error(`waypoint ${index} is outside terrain.`);
  return {
    x,
    y: truth.y,
    z,
    altitudeM: truth.altitudeM,
    slopeDegrees: truth.slopeDegrees,
    surface: truth.surface,
    mode,
    ...(waypoint.protected === undefined
      ? {}
      : { protected: waypoint.protected }),
    ...(waypoint.safeStop === undefined
      ? {}
      : { safeStop: waypoint.safeStop }),
  };
});

for (let index = 1; index < route.length; index += 1) {
  const horizontalM = Math.hypot(
    route[index].x - route[index - 1].x,
    route[index].z - route[index - 1].z,
  );
  if (horizontalM > CLIMBER.maxProofSegmentM + 1e-6) {
    throw new Error(
      `segment ${index - 1}->${index} is ${horizontalM.toFixed(2)} m; maximum is ${CLIMBER.maxProofSegmentM} m.`,
    );
  }
}

const output = `${JSON.stringify(route, null, 2)}\n`;
const outputPath = argument("--out");
if (outputPath) {
  const resolvedOutput = resolve(outputPath);
  await writeFile(resolvedOutput, output);
  console.log(
    JSON.stringify(
      {
        output: resolvedOutput,
        samples: route.length,
        note:
          "Terrain fields were annotated, but route lifecycle, carrying slopes, protection, clearance and Endurance are not approved until verification.",
      },
      null,
      2,
    ),
  );
} else {
  process.stdout.write(output);
}
