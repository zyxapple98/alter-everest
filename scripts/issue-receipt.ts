import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  receiptBody,
  signReceiptBody,
  unsignedReceipt,
} from "../lib/receipt";
import { computeVerifierHash } from "./verifier-integrity";
import { verifyCandidateFile } from "./verification";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

const candidatePath = process.argv[2];
if (!candidatePath) {
  throw new Error(
    "Usage: npm run expedition:receipt -- <candidate.json> [--out <receipt.json>]",
  );
}

const expectedAgent = argument("--expected-agent");
const requireSignature = process.argv.includes("--require-signature");
const privateKey = process.env.VERIFIER_PRIVATE_KEY_PKCS8_BASE64 ?? null;
if (requireSignature && !privateKey) {
  throw new Error("A verifier signing key is required.");
}

const [verification, engineHash] = await Promise.all([
  verifyCandidateFile(candidatePath, {
    expectedAgent,
    worldPath: argument("--world") ?? undefined,
    terrainConfigPath: argument("--terrain-config") ?? undefined,
  }),
  computeVerifierHash(),
]);

if (
  !verification.accepted ||
  !verification.candidate ||
  !verification.candidateHash ||
  !verification.verdict
) {
  console.error(JSON.stringify(verification, null, 2));
  process.exitCode = 1;
} else {
  const body = receiptBody(
    verification.candidate,
    verification.verdict,
    verification.candidateHash,
    engineHash,
  );
  const receipt = privateKey
    ? signReceiptBody(body, privateKey)
    : unsignedReceipt(body);
  const text = `${JSON.stringify(receipt, null, 2)}\n`;
  const output = argument("--out");
  if (output) {
    await writeFile(resolve(output), text, { flag: "wx" });
  }
  console.log(text.trimEnd());
}
