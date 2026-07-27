import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { applyAcceptedCandidate } from "../engine/world";
import {
  verificationSummary,
  verifyCandidateFile,
} from "./verification";
import { formatPlayerHelp, PLAYER_DOCS } from "../lib/player-rules";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

const candidatePath = process.argv[2];
const usage =
  "npm run expedition:apply -- <candidate.json> [--world <snapshot.json>] [--out <world.json>]";
const help = formatPlayerHelp({
  command: "expedition:apply",
  purpose:
    "Verify and apply an accepted candidate into an explicitly selected local snapshot. It never changes the canonical mountain.",
  usage,
  sections: [
    {
      heading: "Safety",
      lines: [
        "Write under work/ for rehearsal. Never target world/snapshot.json.",
      ],
    },
  ],
  output:
    "A local next-world JSON plus sequence, hashes, identity outcome, and tombstone.",
  next: [
    "Inspect the output with agent:inspect --world.",
    "For a real expedition, compile and verify against the latest canonical world.",
  ],
  docs: [PLAYER_DOCS.firstExpedition, PLAYER_DOCS.submission],
});
if (!candidatePath || candidatePath === "--help") {
  console.log(help);
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
  console.error(JSON.stringify(verificationSummary(result), null, 2));
  process.exitCode = 1;
} else {
  const applied = await applyAcceptedCandidate(
    result.candidate,
    result.canonicalWorld,
    result.verdict,
  );
  const output = resolve(argument("--out") ?? "world/next-snapshot.json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(applied, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        accepted: true,
        output,
        sequence: applied.sequence,
        worldHash: applied.worldHash,
        identity: applied.identities.find(
          (identity) =>
            identity.id.toLowerCase() ===
            result.candidate!.agentId.toLowerCase(),
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
