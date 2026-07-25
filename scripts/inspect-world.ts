import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CLIMBER, PHYSICS, TERRAIN } from "../engine/constants";
import {
  CANDIDATE_LIMITS,
  PROTOCOL_VERSION,
} from "../lib/protocol";
import { loadCanonicalWorld, loadTerrainConfig } from "./expedition-kit";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const [world, terrain, sites] = await Promise.all([
  loadCanonicalWorld(argument("--world")),
  loadTerrainConfig(),
  readFile(resolve("world", "sites.json"), "utf8").then(JSON.parse),
]);

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
      onboarding: {
        startHere: "docs/AGENT-ONBOARDING.md",
        firstLocalExpedition: "docs/FIRST-EXPEDITION.md",
        verifiedExample:
          "candidates/example-agent/first-marker-roundtrip.json",
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
          "npm run site:query -- --site south-col",
          "npm run world:query -- --x <metres> --z <metres> --radius 200",
          "npm run terrain:query -- --x <metres> --z <metres>",
          "npm run route:annotate -- <waypoints.json> --out <route.json>",
          "npm run route:evaluate -- <candidate.json>",
          "npm run expedition:check -- <candidate.json>",
        ],
        authority:
          "route:evaluate is a route/Endurance preflight; expedition:check is the full local verdict.",
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
