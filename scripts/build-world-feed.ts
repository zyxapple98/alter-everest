import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  CandidateCommit,
  CanonicalExpeditionEvent,
  CanonicalWorld,
} from "../engine/types";
import { currentHighestPoint } from "../engine/highest-point";
import { CANDIDATE_LIMITS } from "../engine/constants";
import { stancePoint } from "../engine/movement";
import { decodeStoredRouteProgram } from "../engine/route-codec";
import type { TerrainOracle } from "../engine/terrain";
import { loadDemBundle } from "./expedition-kit";
import { agentIdentityStyle } from "../lib/agent-identity";
import {
  FOOTPRINT_RANKING_LIMIT,
  selectFootprintRankingCandidates,
} from "../lib/footprint-ranking";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const usage =
  "Usage: npm run world:feed -- [--world <snapshot.json>] [--output-dir <directory>]";
if (process.argv.includes("--help")) {
  console.log(usage);
  process.exit(0);
}
const inputWorldPath = resolve(
  argument("--world") ?? "world/snapshot.json",
);
const outputDirectory = resolve(
  argument("--output-dir") ?? "public/data/world",
);
const OUTPUT_PATH = resolve(outputDirectory, "latest.json");
const BADGES_OUTPUT_PATH = resolve(outputDirectory, "badges.json");
const SURFACE_TILES_OUTPUT_PATH = resolve(outputDirectory, "tiles");
const usesCanonicalWorld =
  inputWorldPath === resolve("world/snapshot.json");
const MAX_OVERVIEW_EXPEDITIONS = 100;
const METERS_PER_DEGREE_LATITUDE = 111_320;
const MAX_MEMORIAL_CLUSTERS = 512;

interface TerrainConfig {
  registration: {
    originLatitude: number;
    originLongitude: number;
    originRow: number;
    originColumn: number;
    verticalDatumM: number;
  };
  naturalization: {
    voxelEdgeM: number;
    physicsChunkEdgeM: number;
  };
  metadataPath: string;
}

interface DemMetadata {
  sampleSpacingArcSeconds: number;
  bounds: {
    north: number;
    west: number;
  };
}

function actionLabel(
  action: "ADD" | "MOVE" | "RECOVER" | "QUARRY" | "MULTI",
) {
  if (action === "MULTI") return "BUILT";
  if (action === "ADD") return "ADDED";
  if (action === "MOVE") return "MOVED";
  if (action === "QUARRY") return "QUARRIED";
  return "RECOVERED";
}

function operationForAction(
  action: {
    source: { kind: string };
    destination: { kind: string };
  },
) {
  if (action.destination.kind === "BASE") return "RECOVER";
  if (action.source.kind === "BASE") return "ADD";
  if (action.source.kind === "TERRAIN") return "QUARRY";
  return "MOVE";
}

function hashBytes(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function worldCoordinate(
  x: number,
  z: number,
  config: TerrainConfig,
) {
  const latitude =
    config.registration.originLatitude - z / METERS_PER_DEGREE_LATITUDE;
  const longitude =
    config.registration.originLongitude +
    x /
      (METERS_PER_DEGREE_LATITUDE *
        Math.cos((config.registration.originLatitude * Math.PI) / 180));
  return { latitude, longitude };
}

function buildMemorialClusters(
  world: CanonicalWorld,
  config: TerrainConfig,
) {
  let edgeM = 64;
  let clusters = new Map<
    string,
    {
      x: number;
      z: number;
      count: number;
      latestAgent?: string;
    }
  >();

  do {
    clusters = new Map();
    for (const tombstone of world.tombstones) {
      const cellX = Math.floor(tombstone.position.x / edgeM);
      const cellZ = Math.floor(tombstone.position.z / edgeM);
      const id = `${cellX}:${cellZ}`;
      const cluster = clusters.get(id) ?? {
        x: 0,
        z: 0,
        count: 0,
        latestAgent: undefined,
      };
      cluster.x += tombstone.position.x;
      cluster.z += tombstone.position.z;
      cluster.count += 1;
      cluster.latestAgent = tombstone.agentId;
      clusters.set(id, cluster);
    }
    if (clusters.size > MAX_MEMORIAL_CLUSTERS) edgeM *= 2;
  } while (clusters.size > MAX_MEMORIAL_CLUSTERS);

  return [...clusters.entries()]
    .map(([id, cluster]) => ({
      id: `memorial-${edgeM}-${id.replace(":", "-")}`,
      ...worldCoordinate(
        cluster.x / cluster.count,
        cluster.z / cluster.count,
        config,
      ),
      count: cluster.count,
      latestAgent: cluster.latestAgent,
    }))
    .sort(
      (left, right) =>
        right.count - left.count || left.id.localeCompare(right.id),
    );
}

async function loadEvents() {
  const directory = resolve("world/events");
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .reverse();
  return Promise.all(
    names.slice(0, MAX_OVERVIEW_EXPEDITIONS).map(async (name) =>
      JSON.parse(
        await readFile(resolve(directory, name), "utf8"),
      ) as CanonicalExpeditionEvent,
    ),
  );
}

async function traceForEvent(
  event: CanonicalExpeditionEvent,
  config: TerrainConfig,
  metadata: DemMetadata,
  oracle: TerrainOracle,
) {
  const bytes = await readFile(resolve(event.proofArtifact));
  if (hashBytes(bytes) !== event.candidateHash) {
    throw new Error(`Proof hash mismatch for event ${event.eventHash}.`);
  }
  const candidate = JSON.parse(bytes.toString("utf8")) as CandidateCommit;
  const route = decodeStoredRouteProgram(candidate.proof.route, {
    maximumSteps: CANDIDATE_LIMITS.maximumDecodedRouteSteps,
    requireCanonical: true,
  }).stances.map((stance) => {
    const point = stancePoint(stance.cell);
    const truth = oracle.sample(point.x, point.z);
    return {
      ...point,
      altitudeM: truth
        ? truth.altitudeM + (point.y - truth.y)
        : config.registration.verticalDatumM + point.y,
    };
  });
  const actions = candidate.proof.actions;
  const actionIndices = actions.map((action) =>
      action.destination.kind === "BASE"
        ? action.pickupStep
        : action.releaseStep,
  );
  const actionIndex = actionIndices.reduce((highest, index) =>
    route[index].altitudeM > route[highest].altitudeM
      ? index
      : highest,
  );
  const actionIndexSet = new Set(
    actions.flatMap((action) => [
      action.pickupStep,
      action.releaseStep,
    ]),
  );
  const degrees = metadata.sampleSpacingArcSeconds / 3600;
  const stride = Math.max(1, Math.ceil(route.length / 220));
  const trace = route
    .flatMap((sample, index) =>
      index === 0 ||
      index === route.length - 1 ||
      actionIndexSet.has(index) ||
      index % stride === 0
        ? [
            {
              column:
                (config.registration.originLongitude +
                  sample.x /
                    (METERS_PER_DEGREE_LATITUDE *
                      Math.cos(
                        (config.registration.originLatitude *
                          Math.PI) /
                          180,
                      )) -
                  metadata.bounds.west) /
                  degrees -
                0.5,
              row:
                (metadata.bounds.north -
                  (config.registration.originLatitude -
                    sample.z / METERS_PER_DEGREE_LATITUDE)) /
                  degrees -
                0.5,
              x: sample.x,
              y: sample.y,
              z: sample.z,
              altitudeM: sample.altitudeM,
              progress:
                route.length > 1 ? index / (route.length - 1) : 1,
            },
          ]
        : [],
    );
  const actionTimeline = actions.map((action, index) => {
    const pickup = route[action.pickupStep];
    const release = route[action.releaseStep];
    return {
      order: index + 1,
      matterId: action.matterId,
      operation: operationForAction(action),
      sourceKind: action.source.kind,
      destinationKind: action.destination.kind,
      pickupFraction:
        route.length > 1
          ? action.pickupStep / (route.length - 1)
          : 1,
      releaseFraction:
        route.length > 1
          ? action.releaseStep / (route.length - 1)
          : 1,
      pickup: {
        x: pickup.x,
        y: pickup.y,
        z: pickup.z,
        altitudeM: pickup.altitudeM,
      },
      release: {
        x: release.x,
        y: release.y,
        z: release.z,
        altitudeM: release.altitudeM,
      },
      sourceCell:
        action.source.kind === "TERRAIN"
          ? action.source.voxel
          : undefined,
      destinationCell:
        action.destination.kind === "WORLD"
          ? action.destination.cell
          : undefined,
    };
  });
  return {
    trace,
    distanceMillimeters: Math.round(
      route.slice(1).reduce((total, sample, index) => {
        const from = route[index];
        return (
          total +
          Math.hypot(
            sample.x - from.x,
            sample.y - from.y,
            sample.z - from.z,
          )
        );
      }, 0) * 1000,
    ),
    releaseFraction:
      route.length > 1 ? actionIndex / (route.length - 1) : 1,
    actionFractions:
      route.length > 1
        ? actionIndices.map(
            (index) => index / (route.length - 1),
          )
        : actionIndices.map(() => 1),
    actions: actionTimeline,
  };
}

const [world, config, terrain] = await Promise.all([
  readFile(inputWorldPath, "utf8").then(
    (text) => JSON.parse(text) as CanonicalWorld,
  ),
  readFile(resolve("world/terrain.json"), "utf8").then(
    (text) => JSON.parse(text) as TerrainConfig,
  ),
  loadDemBundle(),
]);
const metadata = JSON.parse(
  await readFile(resolve("public/data/everest-dem.json"), "utf8"),
) as DemMetadata;
const events = usesCanonicalWorld ? await loadEvents() : [];
const footprints = world.footprints;
const footprintsByAgent = new Map(
  footprints.map((footprint) => [
    footprint.agentId.toLowerCase(),
    footprint,
  ]),
);
function footprintForFeed(agentId: string) {
  const footprint = footprintsByAgent.get(agentId.toLowerCase());
  if (!footprint) {
    throw new Error(`Missing canonical footprint for ${agentId}.`);
  }
  return footprint;
}
const identities = new Map(
  world.identities.map((identity) => [
    identity.id.toLowerCase(),
    identity.status,
  ]),
);

const recentExpeditions =
  events.length > 0
    ? await Promise.all(
        events.map(async (event) => {
          const route = await traceForEvent(
            event,
            config,
            metadata,
            terrain.oracle,
          );
          return {
            id: event.candidateId,
            agent: event.agentId,
            action: actionLabel(event.action),
            commit: event.eventHash.slice(0, 7),
            color: agentIdentityStyle(
              `${event.agentId}:${event.candidateId}`,
            ).color,
            returned: event.outcome === "ACTIVE",
            outcome: event.outcome,
            enduranceUsed: event.enduranceUsed,
            distanceMillimeters: event.distanceMillimeters,
            alterationDelta: event.alterationDelta,
            releaseFraction: route.releaseFraction,
            actionFractions: route.actionFractions,
            actions: route.actions,
            footprint: footprintForFeed(event.agentId),
            trace: route.trace,
          };
        }),
      )
    : (usesCanonicalWorld
        ? world.expeditions.slice(0, MAX_OVERVIEW_EXPEDITIONS)
        : world.expeditions
            .slice(-MAX_OVERVIEW_EXPEDITIONS)
            .reverse()
      ).map((expedition) => ({
        id: expedition.id,
        agent: expedition.agentId,
        action: actionLabel(expedition.action),
        commit: world.worldHash.slice(-7),
        color: agentIdentityStyle(
          `${expedition.agentId}:${expedition.id}`,
        ).color,
        returned: expedition.outcome === "ACTIVE",
        outcome: expedition.outcome,
        enduranceUsed: expedition.enduranceUsed,
        distanceMillimeters: expedition.distanceMillimeters,
        alterationDelta: expedition.alterationDelta,
        releaseFraction: 0.5,
        actionFractions: [],
        actions: [],
        footprint: footprintForFeed(expedition.agentId),
        trace: null,
      }));

const footprintProfiles = selectFootprintRankingCandidates(
  footprints.map((footprint) => ({
    ...footprint,
    agent: footprint.agentId,
    outcome:
      identities.get(footprint.agentId.toLowerCase()) ?? "ACTIVE",
  })),
  FOOTPRINT_RANKING_LIMIT,
);
const stonesById = new Map(
  world.stones.map((stone) => [stone.id, stone]),
);
const surfaceVoxelEdgeM =
  terrain.config.naturalization.voxelEdgeM;
const surfaceChunkEdgeM =
  terrain.config.naturalization.physicsChunkEdgeM;
const surfaceTileEdgeM = 256;
const surfaceLodCellsM = [
  0.2, 0.4, 0.8, 1.6, 3.2, 6.4, 15, 30,
] as const;
const surfaceChunks = world.modifiedChunks.map((chunk) => ({
  id: chunk.id,
  x: chunk.x,
  z: chunk.z,
  hash: chunk.hash,
  removedTerrainVoxels: chunk.removedTerrainVoxels,
  stones: chunk.stoneIds.flatMap((stoneId) => {
    const stone = stonesById.get(stoneId);
    return stone ? [stone] : [];
  }),
}));
const chunksPerTile = Math.round(
  surfaceTileEdgeM / surfaceChunkEdgeM,
);
const chunksByTile = new Map<
  string,
  {
    x: number;
    z: number;
    chunks: typeof surfaceChunks;
  }
>();
surfaceChunks.forEach((chunk) => {
  const tileX = Math.floor(chunk.x / chunksPerTile);
  const tileZ = Math.floor(chunk.z / chunksPerTile);
  const id = `${tileX}:${tileZ}`;
  const tile = chunksByTile.get(id) ?? {
    x: tileX,
    z: tileZ,
    chunks: [],
  };
  tile.chunks.push(chunk);
  chunksByTile.set(id, tile);
});

const surfaceTileArtifacts = [...chunksByTile.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([id, tile]) => {
    tile.chunks.sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    const payloadWithoutHash = {
      schemaVersion: "1.1.0",
      id,
      x: tile.x,
      z: tile.z,
      chunks: tile.chunks,
    };
    const hash = hashBytes(
      Buffer.from(JSON.stringify(payloadWithoutHash)),
    );
    const payload = {
      ...payloadWithoutHash,
      hash,
    };
    const removedTerrainVoxels = tile.chunks.flatMap(
      (chunk) => chunk.removedTerrainVoxels,
    );
    const stones = tile.chunks.flatMap((chunk) => chunk.stones);
    const lodSummary = surfaceLodCellsM.map((cellM) => {
      const stride = Math.max(
        1,
        Math.round(cellM / surfaceVoxelEdgeM),
      );
      const touched = new Set<string>();
      removedTerrainVoxels.forEach((voxel) => {
        touched.add(
          `${Math.floor(voxel.x / stride)}:${Math.floor(
            voxel.z / stride,
          )}`,
        );
      });
      stones.forEach((stone) => {
        touched.add(
          `${Math.floor(
            (stone.cell.x * surfaceVoxelEdgeM) / cellM,
          )}:${Math.floor(
            (stone.cell.z * surfaceVoxelEdgeM) / cellM,
          )}`,
        );
      });
      return {
        cellM,
        touchedCellCount: touched.size,
      };
    });
    return {
      payload,
      filename: `${hash}.json`,
      manifest: {
        id,
        x: tile.x,
        z: tile.z,
        hash,
        path: `tiles/${hash}.json`,
        chunkCount: tile.chunks.length,
        removedTerrainVoxelCount:
          removedTerrainVoxels.length,
        stoneCount: stones.length,
        lodSummary,
      },
    };
  });

const feed = {
  schemaVersion: "1.5.0",
  sequence: world.sequence,
  worldHash: world.worldHash,
  summitHeightM: 8848.86,
  everestSummit: {
    name: "Everest Summit",
    latitude: 27.9881,
    longitude: 86.925,
    officialHeightM: 8848.86,
  },
  currentHighestPoint: currentHighestPoint(
    terrain.metadata,
    terrain.elevations,
    terrain.config.registration,
    terrain.oracle,
    world.removedTerrainVoxels,
    world.stones,
  ),
  worldSummary: {
    stoneCount: world.stones.length,
    removedTerrainVoxelCount: world.removedTerrainVoxels.length,
    identityCount: world.identities.length,
    activeIdentityCount: world.identities.filter(
      (identity) => identity.status === "ACTIVE",
    ).length,
    deadIdentityCount: world.identities.filter(
      (identity) => identity.status === "DEAD",
    ).length,
    tombstoneCount: world.tombstones.length,
    expeditionCount: world.expeditions.length,
    modifiedTileCount: surfaceTileArtifacts.length,
  },
  surfaceTiles: {
    voxelEdgeM: surfaceVoxelEdgeM,
    physicsChunkEdgeM:
      surfaceChunkEdgeM,
    tileEdgeM: surfaceTileEdgeM,
    verticalDatumM:
      terrain.config.registration.verticalDatumM,
    tiles: surfaceTileArtifacts.map(({ manifest }) => manifest),
  },
  recentExpeditions,
  memorialClusters: buildMemorialClusters(world, config),
  footprints: footprintProfiles,
};

const badgeStats = {
  schemaVersion: "1.0.0",
  expeditions: world.expeditions.length,
  // Kept for the existing README badge. This is the highest altitude reached
  // by an expedition, not necessarily the current highest piece of matter.
  highestAltitudeM: Math.round(
    Math.max(0, ...world.expeditions.map((expedition) => expedition.altitudeM)),
  ),
  highestExpeditionAltitudeM: Math.round(
    Math.max(0, ...world.expeditions.map((expedition) => expedition.altitudeM)),
  ),
  currentHighestAltitudeM: Math.round(feed.currentHighestPoint.altitudeM),
  liveStones: world.stones.length,
  activeAlterations:
    world.alterations.terrainRemovals.length +
    world.alterations.stonePlacements.length,
  livingIdentities: world.identities.filter(
    (identity) => identity.status === "ACTIVE",
  ).length,
  worldSequence: world.sequence,
};

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await mkdir(SURFACE_TILES_OUTPUT_PATH, { recursive: true });
await Promise.all([
  writeFile(OUTPUT_PATH, `${JSON.stringify(feed, null, 2)}\n`),
  writeFile(BADGES_OUTPUT_PATH, `${JSON.stringify(badgeStats, null, 2)}\n`),
  ...surfaceTileArtifacts.map(({ filename, payload }) =>
    writeFile(
      resolve(SURFACE_TILES_OUTPUT_PATH, filename),
      `${JSON.stringify(payload)}\n`,
    ),
  ),
]);
console.log(
  `Wrote ${OUTPUT_PATH} and ${BADGES_OUTPUT_PATH} for world ${world.sequence} from ${inputWorldPath}.`,
);
