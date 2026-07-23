import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateCandidateCommit } from "../engine/commit";
import type { CandidateCommit } from "../engine/types";
import { applyAcceptedCandidate } from "../engine/world";
import {
  loadCanonicalWorld,
  loadDemBundle,
  worldForCandidate,
} from "./expedition-kit";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

const candidatePath = process.argv[2];
if (!candidatePath) {
  throw new Error(
    "Usage: npm run expedition:apply -- <candidate.json> [--out <world.json>]",
  );
}
const candidate = JSON.parse(
  await readFile(resolve(candidatePath), "utf8"),
) as CandidateCommit;
const [canonicalWorld, terrain] = await Promise.all([
  loadCanonicalWorld(),
  loadDemBundle(),
]);
const validationWorld = worldForCandidate(
  canonicalWorld,
  terrain,
  candidate,
);
const verdict = await validateCandidateCommit(candidate, validationWorld, {
  baseCamp: validationWorld.baseCamp,
  extractionZones: validationWorld.extractionZones,
  terrain: terrain.oracle,
});
if (!verdict.accepted) {
  console.error(JSON.stringify(verdict, null, 2));
  process.exitCode = 1;
} else {
  const applied = await applyAcceptedCandidate(
    candidate,
    { ...canonicalWorld, terrain: [] },
    verdict,
  );
  const output = resolve(argument("--out") ?? "world/next-snapshot.json");
  await writeFile(output, `${JSON.stringify(applied, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        accepted: true,
        output,
        worldHash: applied.worldHash,
        identity: applied.identities.find(
          (identity) => identity.id === candidate.agentId,
        ),
        tombstone:
          applied.tombstones.find(
            (entry) => entry.expeditionId === candidate.id,
          ) ?? null,
      },
      null,
      2,
    ),
  );
}
