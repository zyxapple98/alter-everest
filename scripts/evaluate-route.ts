import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateRoute } from "../engine/route";
import type { CandidateCommit } from "../engine/types";
import {
  formatPlayerHelp,
  guidanceForCode,
  PLAYER_DOCS,
} from "../lib/player-rules";
import { loadCanonicalWorld, loadDemBundle } from "./expedition-kit";

const candidatePath = process.argv[2];
const usage =
  "npm run route:evaluate -- <candidate.json> [--world <snapshot.json>] [--summary]";
const help = formatPlayerHelp({
  command: "route:evaluate",
  purpose:
    "Decode and replay the exact route against one current world without applying matter mutations.",
  usage,
  sections: [
    {
      heading: "Boundary",
      lines: [
        "A passing preflight is not a candidate verdict; pickup/release physics and post-action world changes are excluded.",
      ],
    },
  ],
  output:
    "Exact route verdict, decoded-step failure, distance and Endurance ledger.",
  next: ["Run expedition:check for the complete candidate verdict."],
  docs: [PLAYER_DOCS.route, PLAYER_DOCS.errors],
});
if (!candidatePath || candidatePath === "--help") {
  console.log(help);
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
const evaluation = validateRoute(candidate.proof, world, terrain.oracle);
const summary = process.argv.includes("--summary");
const actionableCode = evaluation.verdict.valid
  ? null
  : evaluation.verdict.code;

console.log(
  JSON.stringify(
    {
      scope: "ROUTE_PREFLIGHT_ONLY",
      route: evaluation.verdict,
      decodedSteps: candidate.proof.route.stepCount,
      endurance: summary
        ? {
            capacity: evaluation.endurance.capacity,
            kilojoulesPerEndurance:
              evaluation.endurance.kilojoulesPerEndurance,
            energyKj: evaluation.endurance.energyKj,
            enduranceUsed: evaluation.endurance.enduranceUsed,
            enduranceRemaining:
              evaluation.endurance.enduranceRemaining,
            segmentCount: evaluation.endurance.segmentCount,
          }
        : evaluation.endurance,
      preflightAccepted: evaluation.verdict.valid,
      fullCandidateAccepted: null,
      actionableCode,
      rule: guidanceForCode(actionableCode),
      next:
        "Run expedition:check for ordered matter actions, temporal world changes, static physics, identity and footprint.",
    },
    null,
    2,
  ),
);
