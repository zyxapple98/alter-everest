import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  CLIMBER,
  PHYSICS,
  TERRAIN,
} from "../engine/constants";
import { footprintForAgent } from "../engine/footprint";
import {
  CANDIDATE_LIMITS,
  PROTOCOL_VERSION,
} from "../lib/protocol";
import {
  formatPlayerHelp,
  PLAYER_DOCS,
  PLAYER_RULES,
} from "../lib/player-rules";
import { loadCanonicalWorld, loadTerrainConfig } from "./expedition-kit";

const execute = promisify(execFile);
const help = formatPlayerHelp({
  command: "agent:inspect",
  purpose:
    "Inspect the live world, player identity, public rules, available matter operations, and the next player-facing commands.",
  usage:
    "npm run agent:inspect -- [--agent <github-login-or-local-id>] [--world <snapshot.json>]",
  sections: [
    {
      heading: "Identity",
      lines: [
        "--agent is optional; the command best-effort detects GITHUB_ACTOR or the current gh login.",
        "--world selects an isolated local snapshot and is carried into follow-up commands.",
      ],
    },
  ],
  output:
    "JSON containing world hashes, identity lifecycle and footprint, rules, capabilities, docs, and next commands.",
  next: [
    "First interaction: complete docs/player/FIRST-EXPEDITION.md.",
    "Then obtain the human's intention before planning a real candidate.",
  ],
  docs: [
    PLAYER_DOCS.entry,
    PLAYER_DOCS.firstExpedition,
    PLAYER_DOCS.intentions,
  ],
});

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv.includes("--help")) {
  console.log(help);
  process.exit(0);
}

async function detectAgent() {
  const explicit = argument("--agent");
  if (explicit) return { id: explicit, source: "ARGUMENT" };
  const actor = process.env.GITHUB_ACTOR?.trim();
  if (actor) return { id: actor, source: "GITHUB_ACTOR" };
  try {
    const result = await execute("gh", ["api", "user", "--jq", ".login"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5_000,
    });
    const login = result.stdout.trim();
    if (login) return { id: login, source: "GH_CLI" };
  } catch {
    // Anonymous inspection remains useful and never requires authentication.
  }
  return { id: null, source: "NOT_DETECTED" };
}

const detectedAgent = await detectAgent();
const [world, terrain, sites] = await Promise.all([
  loadCanonicalWorld(argument("--world")),
  loadTerrainConfig(),
  readFile(resolve("world", "sites.json"), "utf8").then(JSON.parse),
]);
const requestedAgent = detectedAgent.id;
const worldPath = argument("--world");
const worldSuffix = worldPath ? ` --world "${worldPath}"` : "";
const requestedAgentKey = requestedAgent?.toLowerCase() ?? null;
const identity = requestedAgent
  ? world.identities.find(
      (entry) => entry.id.toLowerCase() === requestedAgentKey,
    )
  : null;
const agentTombstones = requestedAgent
  ? world.tombstones.filter(
      (tombstone) =>
        tombstone.agentId.toLowerCase() === requestedAgentKey,
    )
  : [];
const footprint = requestedAgent
  ? footprintForAgent(world, requestedAgent)
  : null;

console.log(
  JSON.stringify(
    {
      protocol: PROTOCOL_VERSION,
      world: {
        sequence: world.sequence,
        worldHash: world.worldHash,
        terrainHash: world.terrainHash,
        stones: world.stones.length,
        removedTerrainVoxels: world.removedTerrainVoxels.length,
        livingIdentities: world.identities.filter(
          (identity) => identity.status === "ACTIVE",
        ).length,
      },
      player: requestedAgent
        ? {
            id: identity?.id ?? requestedAgent,
            requestedId: requestedAgent,
            source: detectedAgent.source,
            status: identity?.status ?? "NEW",
            footprint,
            tombstones: agentTombstones,
          }
        : {
            id: null,
            status: "NOT_REQUESTED",
            source: detectedAgent.source,
            hint:
              "Pass --agent <github-login-or-local-id> to inspect one player's lifecycle and footprint.",
          },
      start: {
        side: "SOUTH",
        center: world.baseCamp,
        radiusM: CLIMBER.baseCampRadiusM,
        protectedCoreRadiusM: CLIMBER.protectedSpawnRadiusM,
      },
      resources: {
        name: "Endurance",
        capacity: CLIMBER.enduranceCapacity,
        kilojoulesPerUnit: CLIMBER.kilojoulesPerEndurance,
      },
      matter: {
        action: "RELOCATE",
        maximumActionsPerExpedition: CANDIDATE_LIMITS.maximumActions,
        maximumBaseWithdrawalsPerExpedition:
          CANDIDATE_LIMITS.maximumBaseWithdrawals,
        ruleset: PHYSICS.rulesetVersion,
        cellEdgeM: PHYSICS.voxelEdgeM,
        legalSources: ["BASE", "STONE", "TERRAIN"],
        legalDestinations: ["WORLD", "BASE"],
        forbidden: ["BASE_TO_BASE", "NO_STATE_CHANGE"],
      },
      locomotion: PLAYER_RULES.climber.locomotion,
      onboarding: {
        startHere: PLAYER_DOCS.entry,
        firstLocalExpedition: PLAYER_DOCS.firstExpedition,
        intentions: PLAYER_DOCS.intentions,
        sequence: [
          "COMPLETE_LOCAL_REHEARSAL",
          "OBTAIN_HUMAN_INTENT",
          "OBSERVE_RELEVANT_WORLD",
          "PLAN_EXACT_EXPEDITION",
          "VERIFY_AND_CHECK_FRESHNESS",
          "SUBMIT_CANDIDATE_ONLY_PR",
        ],
        intentInterview: PLAYER_RULES.onboarding.intentInterview,
        starterMissions: PLAYER_RULES.onboarding.starterMissions,
        rehearsalWorld:
          "examples/example-agent/rehearsal-world.json",
        verifiedExample:
          "examples/example-agent/first-marker-roundtrip.json",
        authoringExample:
          "examples/example-agent/first-marker-plan.json",
        gameplayChoices: [
          {
            operation: "ADD",
            flow: "BASE -> WORLD",
            currentlyPossible: true,
            constraint: "At most one Base withdrawal per expedition.",
          },
          {
            operation: "MOVE",
            flow: "STONE -> WORLD",
            currentlyPossible: world.stones.length > 0,
            availableStones: world.stones.length,
          },
          {
            operation: "QUARRY",
            flow: "TERRAIN -> WORLD",
            currentlyPossible: true,
            constraint: "Start from an exposed face.",
          },
          {
            operation: "RECOVER",
            flow: "STONE/TERRAIN -> BASE",
            currentlyPossible: true,
            constraint: "Carry matter back before the route ends.",
          },
        ],
        nextCommands: [
          `npm run site:query -- --site south-col${worldSuffix}`,
          `npm run world:query -- --x <metres> --z <metres> --radius 200${worldSuffix}`,
          `npm run terrain:query -- --chunk <x:z> --compact --out work/chunk.json${worldSuffix}`,
          "npm run move:check -- --help",
          "npm run matter:check -- --help",
          "npm run route:encode -- <exact-route.json> --out <encoded-route.json>",
          "npm run route:decode -- <candidate.json> --summary",
          `npm run expedition:compile -- <plan.json>${worldSuffix}`,
          `npm run route:evaluate -- <candidate.json> --summary${worldSuffix}`,
          `npm run expedition:check -- <candidate.json>${worldSuffix}`,
          `npm run expedition:apply -- <candidate.json> --out work/next-world.json${worldSuffix}`,
          "npm run authority:check -- --fetch",
        ],
        authority:
          "route:evaluate is a route/Endurance preflight; expedition:check is the full local verdict.",
      },
      playerInterface: {
        rules: "protocol/player-rules.json",
        candidateSchema: "schemas/candidate.schema.json",
        authoringPlanSchema:
          "schemas/expedition-plan.schema.json",
        docs: PLAYER_DOCS,
        authority: {
          physical:
            "world/snapshot.json, world/terrain.json and world/sites.json",
          social:
            "Community Build discussions express intent but never physical truth",
          legal:
            "protocol/player-rules.json and schemas/candidate.schema.json",
          verdict:
            "expedition:check is the complete local candidate verdict",
        },
      },
      storage: {
        measuredDemM: 30,
        voxelM: TERRAIN.voxelEdgeM,
        physicsChunkM: TERRAIN.physicsChunkEdgeM,
        streamTileM: TERRAIN.streamTileEdgeM,
        naturalization: terrain.naturalization,
      },
      sites,
    },
    null,
    2,
  ),
);
