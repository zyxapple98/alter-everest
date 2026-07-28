import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateCandidateCommit } from "../engine/commit";
import type { CandidateCommit } from "../engine/types";
import { validateCandidateShape } from "../lib/protocol";
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
    "Replay one candidate read-only through the same temporal verifier used by expedition:check.",
  usage,
  sections: [
    {
      heading: "Boundary",
      lines: [
        "The replay includes ordered matter mutations and physics but never writes the world.",
      ],
    },
  ],
  output:
    "Complete read-only verdict plus exact route distance and Endurance ledger.",
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
const shape = validateCandidateShape(candidate);
if (!shape.valid) {
  throw new Error(`Candidate shape invalid:\n- ${shape.errors.join("\n- ")}`);
}
const verdict = await validateCandidateCommit(candidate, world, {
  baseCamp: world.baseCamp,
  extractionZones: world.extractionZones,
  terrain: terrain.oracle,
});
const summary = process.argv.includes("--summary");
const route = verdict.route;
const actionableCode = verdict.accepted
  ? null
  : route?.code ?? verdict.physics?.code ?? verdict.code;

console.log(
  JSON.stringify(
    {
      scope: "FULL_READ_ONLY_REPLAY",
      route,
      decodedSteps: candidate.proof.route.stepCount,
      endurance: route
        ? {
            energyKj: route.energyKj,
            enduranceUsed: route.enduranceUsed,
            enduranceRemaining: route.enduranceRemaining,
          }
        : null,
      physics: summary
        ? verdict.physics && {
            valid: verdict.physics.valid,
            code: verdict.physics.code,
            evaluatedStoneCells: verdict.physics.evaluatedStoneCells,
            cavityCellsChecked: verdict.physics.cavityCellsChecked,
          }
        : verdict.physics,
      fullCandidateAccepted: verdict.accepted,
      candidateCode: verdict.code,
      actionableCode,
      rule: guidanceForCode(actionableCode),
      next:
        "expedition:check reports the same verifier result with submission-oriented diagnostics.",
    },
    null,
    2,
  ),
);
