import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CLIMBER, PHYSICS, TERRAIN } from "../engine/constants";
import { loadCanonicalWorld, loadTerrainConfig } from "./expedition-kit";

const [world, terrain, sites] = await Promise.all([
  loadCanonicalWorld(),
  loadTerrainConfig(),
  readFile(resolve("world", "sites.json"), "utf8").then(JSON.parse),
]);

console.log(
  JSON.stringify(
    {
      protocol: "0.4.0",
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
        mutation: "RELOCATE",
        stoneEdgeM: PHYSICS.stoneEdgeM,
        legalSources: ["BASE", "STONE", "TERRAIN"],
        legalDestinations: ["WORLD", "BASE"],
        forbidden: ["BASE_TO_BASE", "NO_STATE_CHANGE"],
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
