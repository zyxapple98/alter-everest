import { computeVerifierHash } from "./verifier-integrity";
import {
  verificationSummary,
  verifyCandidateFile,
} from "./verification";

const candidatePath = process.argv[2];
const usage =
  "Usage: npm run expedition:check -- <candidate.json> [--world <snapshot.json>]";
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

const summary = { ...verificationSummary(result), engineHash };
const output = JSON.stringify(summary, null, 2);
if (result.accepted) {
  console.log(output);
} else {
  console.error(output);
  process.exitCode = 1;
}
