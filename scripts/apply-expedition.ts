import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { applyAcceptedCandidate } from "../engine/world";
import { verifyCandidateFile } from "./verification";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

const candidatePath = process.argv[2];
const usage =
  "Usage: npm run expedition:apply -- <candidate.json> [--world <snapshot.json>] [--out <world.json>]";
if (!candidatePath || candidatePath === "--help") {
  console.log(usage);
  process.exit(0);
}

const result = await verifyCandidateFile(candidatePath, {
  worldPath: argument("--world") ?? undefined,
});
if (
  !result.accepted ||
  !result.candidate ||
  !result.canonicalWorld ||
  !result.verdict
) {
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} else {
  const applied = await applyAcceptedCandidate(
    result.candidate,
    result.canonicalWorld,
    result.verdict,
  );
  const output = resolve(argument("--out") ?? "world/next-snapshot.json");
  await writeFile(output, `${JSON.stringify(applied, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        accepted: true,
        output,
        sequence: applied.sequence,
        worldHash: applied.worldHash,
        identity: applied.identities.find(
          (identity) => identity.id === result.candidate!.agentId,
        ),
        tombstone:
          applied.tombstones.find(
            (entry) => entry.expeditionId === result.candidate!.id,
          ) ?? null,
      },
      null,
      2,
    ),
  );
}
