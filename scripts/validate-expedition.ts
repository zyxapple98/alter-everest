import { computeVerifierHash } from "./verifier-integrity";
import {
  verificationSummary,
  verifyCandidateFile,
} from "./verification";
import { diagnoseExpedition } from "./diagnose-expedition";
import { loadDemBundle } from "./expedition-kit";
import { formatPlayerHelp, PLAYER_DOCS } from "../lib/player-rules";

const candidatePath = process.argv[2];
const usage =
  "npm run expedition:check -- <candidate.json> [--world <snapshot.json>] [--diagnose]";
const help = formatPlayerHelp({
  command: "expedition:check",
  purpose:
    "Run the complete local candidate verifier: identity, exact route, ordered matter actions, clearance, static physics, outcome, distance, and footprint delta.",
  usage,
  sections: [
    {
      heading: "Options",
      lines: [
        "--world <snapshot.json>   verify an isolated local chain",
        "--diagnose                replay phases and identify the first physical obstruction or failure",
      ],
    },
  ],
  output:
    "JSON complete verdict, failing step guidance, Endurance, distance, outcome, footprint delta, and physics.",
  next: [
    "On rejection, follow rule.next and rerun.",
    "On acceptance, optionally expedition:apply to a local world, then follow the submission boundary.",
  ],
  docs: [PLAYER_DOCS.errors, PLAYER_DOCS.submission],
});
if (!candidatePath || candidatePath === "--help") {
  console.log(help);
  process.exit(0);
}

const expectedAgentIndex = process.argv.indexOf("--expected-agent");
const expectedAgent =
  expectedAgentIndex === -1
    ? null
    : process.argv[expectedAgentIndex + 1] ?? null;
const worldIndex = process.argv.indexOf("--world");
const worldPath =
  worldIndex === -1 ? undefined : process.argv[worldIndex + 1];

const [result, engineHash] = await Promise.all([
  verifyCandidateFile(candidatePath, { expectedAgent, worldPath }),
  computeVerifierHash(),
]);

const diagnostics =
  process.argv.includes("--diagnose") &&
  result.candidate &&
  result.canonicalWorld
    ? await diagnoseExpedition(
        result.candidate,
        result.canonicalWorld,
        (await loadDemBundle()).oracle,
        result.verdict,
      )
    : null;
const summary = {
  ...verificationSummary(result),
  engineHash,
  ...(diagnostics ? { diagnostics } : {}),
};
const output = JSON.stringify(summary, null, 2);
if (result.accepted) {
  console.log(output);
} else {
  console.error(output);
  process.exitCode = 1;
}
