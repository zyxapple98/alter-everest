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
  "Usage: npm run route:evaluate -- <candidate.json> [--world <snapshot.json>]";
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
);

console.log(
  JSON.stringify(
    {
      route,
      endurance: evaluateRouteEndurance(candidate.proof),
      terrain: terrainVerdict,
      accepted: route.valid && terrainVerdict.valid,
    },
    null,
    2,
  ),
);
