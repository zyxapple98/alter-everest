import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  evaluateRouteEndurance,
  validateRoute,
} from "../engine/route";
import { validateRouteTerrain } from "../engine/terrain";
import type { CandidateCommit } from "../engine/types";
import { loadCanonicalWorld, loadDemBundle } from "./expedition-kit";

const candidatePath = process.argv[2];
const usage =
  "Usage: npm run route:evaluate -- <candidate.json> [--world <snapshot.json>] [--summary]";
if (!candidatePath || candidatePath === "--help") {
  console.log(usage);
  process.exit(0);
}
const worldIndex = process.argv.indexOf("--world");
const worldPath =
  worldIndex === -1 ? undefined : process.argv[worldIndex + 1];

const [candidate, world, terrain] = await Promise.all([
  readFile(resolve(candidatePath), "utf8").then(
    (text) => JSON.parse(text) as CandidateCommit,
  ),
  loadCanonicalWorld(worldPath),
  loadDemBundle(),
]);
const route = validateRoute(candidate.proof, world.baseCamp);
const terrainVerdict = validateRouteTerrain(
  candidate.proof.route,
  terrain.oracle,
  world,
);
const endurance = evaluateRouteEndurance(candidate.proof);
const preflightAccepted = route.valid && terrainVerdict.valid;
const summary = process.argv.includes("--summary");

console.log(
  JSON.stringify(
    {
      scope: "ROUTE_PREFLIGHT_ONLY",
      route,
      endurance: summary
        ? {
            capacity: endurance.capacity,
            kilojoulesPerEndurance:
              endurance.kilojoulesPerEndurance,
            energyKj: endurance.energyKj,
            enduranceUsed: endurance.enduranceUsed,
            enduranceRemaining: endurance.enduranceRemaining,
            segmentCount: endurance.segments.length,
          }
        : endurance,
      terrain: terrainVerdict,
      enduranceLedger:
        "Independent full-route energy calculation; it may remain nonzero when route validation stops at an earlier lifecycle error.",
      preflightAccepted,
      accepted: preflightAccepted,
      fullCandidateAccepted: null,
      next:
        "Run expedition:check for matter actions, post-action clearance, physics, identity and score.",
    },
    null,
    2,
  ),
);
