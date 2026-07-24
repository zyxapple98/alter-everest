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
if (!candidatePath) {
  throw new Error("Usage: npm run route:evaluate -- <candidate.json>");
}

const [candidate, world, terrain] = await Promise.all([
  readFile(resolve(candidatePath), "utf8").then(
    (text) => JSON.parse(text) as CandidateCommit,
  ),
  loadCanonicalWorld(),
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
