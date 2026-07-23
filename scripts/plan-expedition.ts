import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  loadCanonicalWorld,
  loadDemBundle,
  planCandidate,
} from "./expedition-kit";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

const agentId = argument("--agent");
if (!agentId) {
  throw new Error("Usage: npm run expedition:plan -- --agent <id> [--one-way] [--out <file>]");
}
const output = resolve(
  argument("--out") ?? `candidates/${agentId}/planned-expedition.json`,
);
const [world, terrain] = await Promise.all([
  loadCanonicalWorld(),
  loadDemBundle(),
]);
const candidate = planCandidate(
  terrain,
  world,
  agentId,
  process.argv.includes("--one-way"),
);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(candidate, null, 2)}\n`);
console.log(output);
