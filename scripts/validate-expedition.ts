import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { validateCandidateCommit } from "../engine/commit";
import type { CandidateCommit } from "../engine/types";
import { validateCandidateShape } from "../lib/protocol";
import {
  loadCanonicalWorld,
  loadDemBundle,
  worldForCandidate,
} from "./expedition-kit";

const candidatePath = process.argv[2];
if (!candidatePath) {
  throw new Error("Usage: npm run expedition:check -- <candidate.json>");
}
const candidate = JSON.parse(
  await readFile(resolve(candidatePath), "utf8"),
) as CandidateCommit;
const shape = validateCandidateShape(candidate);
const expectedAgentIndex = process.argv.indexOf("--expected-agent");
const expectedAgent =
  expectedAgentIndex === -1
    ? null
    : process.argv[expectedAgentIndex + 1] ?? null;
const candidateDirectory = basename(dirname(resolve(candidatePath)));
if (candidate.agentId !== candidateDirectory) {
  console.error(
    JSON.stringify(
      {
        accepted: false,
        stage: "IDENTITY",
        errors: [
          "agentId must match the candidate directory name",
        ],
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} else if (expectedAgent && candidate.agentId !== expectedAgent) {
  console.error(
    JSON.stringify(
      {
        accepted: false,
        stage: "IDENTITY",
        errors: [
          `agentId must match the pull-request author: ${expectedAgent}`,
        ],
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} else if (!shape.valid) {
  console.error(JSON.stringify({ accepted: false, stage: "SCHEMA", ...shape }, null, 2));
  process.exitCode = 1;
} else {
  const [canonicalWorld, terrain] = await Promise.all([
    loadCanonicalWorld(),
    loadDemBundle(),
  ]);
  const world = worldForCandidate(canonicalWorld, terrain, candidate);
  const verdict = await validateCandidateCommit(candidate, world, {
    baseCamp: world.baseCamp,
    extractionZones: world.extractionZones,
    terrain: terrain.oracle,
  });
  console.log(
    JSON.stringify(
      {
        accepted: verdict.accepted,
        code: verdict.code,
        routeCode: verdict.route?.code ?? null,
        outcome: verdict.nextIdentityStatus,
        score: verdict.score,
        oxygen: verdict.route
          ? {
              used: Number(verdict.route.oxygenUsed.toFixed(2)),
              remaining: Number(verdict.route.oxygenRemaining.toFixed(2)),
            }
          : null,
        energyKj: verdict.route
          ? Number(verdict.route.energyKj.toFixed(2))
          : null,
        physics: verdict.physics
          ? {
              code: verdict.physics.code,
              contactModel: verdict.physics.contactModel,
              affectedStoneIds: verdict.physics.affectedStoneIds,
            }
          : null,
      },
      null,
      2,
    ),
  );
  if (!verdict.accepted) process.exitCode = 1;
}
