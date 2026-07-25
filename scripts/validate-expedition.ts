import { computeVerifierHash } from "./verifier-integrity";
import {
  verificationSummary,
  verifyCandidateFile,
} from "./verification";
import { diagnoseExpedition } from "./diagnose-expedition";
import { loadDemBundle } from "./expedition-kit";

const candidatePath = process.argv[2];
const usage =
  "Usage: npm run expedition:check -- <candidate.json> [--world <snapshot.json>] [--diagnose]";
if (!candidatePath || candidatePath === "--help") {
  console.log(usage);
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
      )
    : null;
const summary = {
  ...verificationSummary(result),
  actionableCode:
    (result.accepted ? result.verdict?.code : null) ??
    result.verdict?.physics?.code ??
    (result.verdict?.route?.code === "ROUTE_VALID"
      ? result.verdict.code
      : result.verdict?.route?.code) ??
    result.verdict?.code ??
    null,
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
