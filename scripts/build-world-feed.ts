import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  CandidateCommit,
  CanonicalExpeditionEvent,
  CanonicalWorld,
} from "../engine/types";
import { currentHighestPoint } from "../engine/highest-point";
import { loadDemBundle } from "./expedition-kit";

const OUTPUT_PATH = resolve("public/data/world/latest.json");
const BADGES_OUTPUT_PATH = resolve("public/data/world/badges.json");
const SURFACE_TILES_OUTPUT_PATH = resolve(
  "public/data/world/tiles",
);
const COLORS = ["#ff7138", "#d2dd72", "#70c6cf", "#bb91ff", "#f1bd59"];
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
    names.slice(0, 3).map(async (name) =>
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
) {
  if (!event.proofArtifact || event.proofArtifact.startsWith("sha256:")) {
    return null;
  }
  const bytes = await readFile(resolve(event.proofArtifact));
  if (hashBytes(bytes) !== event.candidateHash) {
    throw new Error(`Proof hash mismatch for event ${event.eventHash}.`);
  }
  const candidate = JSON.parse(bytes.toString("utf8")) as CandidateCommit;
  const proof = candidate.proof as unknown as {
    route: CandidateCommit["proof"]["route"];
    actions?: CandidateCommit["proof"]["actions"];
    mutation?: {
      kind?: string;
      destination?: { kind?: string };
    };
    pickupIndex?: number;
    releaseIndex?: number;
  };
  const route = proof.route;
  const actionIndices =
    proof.actions?.map((action) =>
      action.destination.kind === "BASE"
        ? action.pickupIndex
        : action.releaseIndex,
    ) ??
    [
      proof.mutation?.destination?.kind === "BASE" ||
      proof.mutation?.kind === "RECOVER"
        ? proof.pickupIndex!
        : proof.releaseIndex!,
    ];
  const actionIndex = actionIndices.reduce((highest, index) =>
    route[index].altitudeM > route[highest].altitudeM ? index : highest,
  );
  const actionIndexSet = new Set(actionIndices);
  const degrees = metadata.sampleSpacingArcSeconds / 3600;
  const stride = Math.max(1, Math.ceil(route.length / 220));
  const trace = route
    .filter(
      (_, index) =>
        index === 0 ||
        index === route.length - 1 ||
        actionIndexSet.has(index) ||
        index % stride === 0,
    )
    .map((sample) => ({
      column:
        (config.registration.originLongitude +
          sample.x /
            (METERS_PER_DEGREE_LATITUDE *
              Math.cos(
                (config.registration.originLatitude * Math.PI) / 180,
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
    }));
  return {
    trace,
    releaseFraction:
      route.length > 1 ? actionIndex / (route.length - 1) : 1,
    actionFractions:
      route.length > 1
        ? actionIndices.map((index) => index / (route.length - 1))
        : actionIndices.map(() => 1),
  };
}

const [world, config, terrain] = await Promise.all([
  readFile(resolve("world/snapshot.json"), "utf8").then(
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
const events = await loadEvents();
const totals = new Map<string, number>();
for (const expedition of world.expeditions) {
  totals.set(
    expedition.agentId,
    (totals.get(expedition.agentId) ?? 0) + expedition.score,
  );
}
const identities = new Map(
  world.identities.map((identity) => [identity.id, identity.status]),
);

const recentExpeditions =
  events.length > 0
    ? await Promise.all(
        events.map(async (event, index) => {
          const route = await traceForEvent(event, config, metadata);
          return {
            id: event.candidateId,
            agent: event.agentId,
            action: actionLabel(event.action),
            commit: event.eventHash.slice(0, 7),
            color: COLORS[index % COLORS.length],
            returned: event.outcome === "ACTIVE",
            outcome: event.outcome,
            enduranceUsed:
              event.enduranceUsed ?? event.energyKj / 450,
            score: event.score,
            releaseFraction: route?.releaseFraction ?? 0.5,
            actionFractions: route?.actionFractions ?? [],
            totalScore: totals.get(event.agentId) ?? event.score,
            trace: route?.trace ?? null,
          };
        }),
      )
    : world.expeditions.slice(0, 3).map((expedition, index) => ({
        id: expedition.id,
        agent: expedition.agentId,
        action: actionLabel(expedition.action),
        commit: world.worldHash.slice(-7),
        color: COLORS[index % COLORS.length],
        returned: expedition.outcome === "ACTIVE",
        outcome: expedition.outcome,
        enduranceUsed:
          expedition.enduranceUsed ?? expedition.oxygenUsed ?? 0,
        score: expedition.score,
        releaseFraction: 0.5,
        actionFractions: [],
        totalScore: totals.get(expedition.agentId) ?? expedition.score,
        trace: null,
      }));

const leaderboard = [...totals.entries()]
  .map(([agent, totalScore]) => ({
    agent,
    totalScore,
    outcome: identities.get(agent) ?? "ACTIVE",
  }))
  .sort(
    (left, right) =>
      right.totalScore - left.totalScore || left.agent.localeCompare(right.agent),
  )
  .slice(0, 50);
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
  schemaVersion: "1.4.0",
  sequence: world.sequence,
  worldHash: world.worldHash,
  summitHeightM: 8848.86,
  historicalSummit: {
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
  leaderboard,
};

const badgeStats = {
  schemaVersion: "1.0.0",
  expeditions: world.expeditions.length,
  highestAltitudeM: Math.round(
    Math.max(0, ...world.expeditions.map((expedition) => expedition.altitudeM)),
  ),
  liveStones: world.stones.length,
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
  `Wrote ${OUTPUT_PATH} and ${BADGES_OUTPUT_PATH} for world ${world.sequence}.`,
);
