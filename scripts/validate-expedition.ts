import { computeVerifierHash } from "./verifier-integrity";
import {
  verificationSummary,
  verifyCandidateFile,
} from "./verification";

const candidatePath = process.argv[2];
if (!candidatePath) {
  throw new Error("Usage: npm run expedition:check -- <candidate.json>");
}

const expectedAgentIndex = process.argv.indexOf("--expected-agent");
const expectedAgent =
  expectedAgentIndex === -1
    ? null
    : process.argv[expectedAgentIndex + 1] ?? null;

const [result, engineHash] = await Promise.all([
  verifyCandidateFile(candidatePath, { expectedAgent }),
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
