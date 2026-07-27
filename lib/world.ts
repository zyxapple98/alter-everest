export interface ObservatoryTracePoint {
  column: number;
  row: number;
  x: number;
  y: number;
  z: number;
  altitudeM: number;
  /** Normalized index in the submitted route, from 0 to 1. */
  progress: number;
}

export interface ObservatoryExpeditionAction {
  order: number;
  matterId: string;
  operation: "ADD" | "MOVE" | "RECOVER" | "QUARRY";
  sourceKind: "BASE" | "STONE" | "TERRAIN";
  destinationKind: "WORLD" | "BASE";
  pickupFraction: number;
  releaseFraction: number;
  pickup: {
    x: number;
    y: number;
    z: number;
    altitudeM: number;
  };
  release: {
    x: number;
    y: number;
    z: number;
    altitudeM: number;
  };
  /** Exact 20 cm source cell when the matter came from terrain. */
  sourceCell?: {
    x: number;
    y: number;
    z: number;
  };
  /** Exact 20 cm destination cell when the matter was placed in the world. */
  destinationCell?: {
    x: number;
    y: number;
    z: number;
  };
}

export interface ObservatoryExpedition {
  id: string;
  agent: string;
  action: "ADDED" | "MOVED" | "RECOVERED" | "QUARRIED" | "BUILT";
  commit: string;
  color: string;
  returned: boolean;
  outcome: "ACTIVE" | "DEAD";
  enduranceUsed: number;
  distanceMillimeters: number;
  alterationDelta: {
    terrainRemovalsCreated: number;
    stonePlacementsCreated: number;
    stonePlacementsRemoved: number;
  };
  releaseFraction: number;
  actionFractions: number[];
  actions: ObservatoryExpeditionAction[];
  footprint: ObservatoryFootprint;
  trace: ObservatoryTracePoint[] | null;
}

export interface ObservatoryFootprint {
  agent: string;
  agentId: string;
  acceptedExpeditions: number;
  totalDistanceMillimeters: number;
  activeTerrainRemovals: number;
  activeStonePlacements: number;
  activeAlterations: number;
  outcome: "ACTIVE" | "DEAD";
}

export interface ObservatoryMemorialCluster {
  id: string;
  latitude: number;
  longitude: number;
  count: number;
  latestAgent?: string;
}

export interface ObservatorySurfaceDeltaChunk {
  id: string;
  x: number;
  z: number;
  hash: string;
  removedTerrainVoxels: Array<{
    x: number;
    y: number;
    z: number;
  }>;
  stones: Array<{
    id: string;
    cell: { x: number; y: number; z: number };
  }>;
}

export interface ObservatorySurfaceLodSummary {
  cellM: number;
  touchedCellCount: number;
}

export interface ObservatorySurfaceTileManifest {
  id: string;
  x: number;
  z: number;
  hash: string;
  path: string;
  chunkCount: number;
  removedTerrainVoxelCount: number;
  stoneCount: number;
  lodSummary: ObservatorySurfaceLodSummary[];
}

export interface ObservatorySurfaceTile {
  schemaVersion: "1.1.0";
  id: string;
  x: number;
  z: number;
  hash: string;
  chunks: ObservatorySurfaceDeltaChunk[];
}

export interface ObservatoryFeed {
  schemaVersion: "1.5.0";
  sequence: number;
  worldHash: string;
  summitHeightM: number;
  everestSummit: {
    name: string;
    latitude: number;
    longitude: number;
    officialHeightM: number;
  };
  currentHighestPoint: {
    kind: "TERRAIN" | "STONE";
    id: string;
    x: number;
    y: number;
    z: number;
    latitude: number;
    longitude: number;
    altitudeM: number;
  };
  worldSummary: {
    stoneCount: number;
    removedTerrainVoxelCount: number;
    identityCount: number;
    activeIdentityCount: number;
    deadIdentityCount: number;
    tombstoneCount: number;
    expeditionCount: number;
    modifiedTileCount: number;
  };
  surfaceTiles: {
    voxelEdgeM: number;
    physicsChunkEdgeM: number;
    tileEdgeM: number;
    verticalDatumM: number;
    tiles: ObservatorySurfaceTileManifest[];
  };
  /**
   * Runtime-only base URL attached by loadObservatoryFeed. It is not part of
   * the canonical JSON and lets immutable tile paths work with either local
   * assets or an external world object store.
   */
  assetBaseUrl?: string;
  recentExpeditions: ObservatoryExpedition[];
  memorialClusters: ObservatoryMemorialCluster[];
  footprints: ObservatoryFootprint[];
}

export function recentExpeditions(): ObservatoryExpedition[] {
  return [];
}

export function observatoryFootprints(): ObservatoryFootprint[] {
  return [];
}

export function fallbackObservatoryFeed(): ObservatoryFeed {
  return {
    schemaVersion: "1.5.0",
    sequence: 0,
    worldHash: "offline-empty-world",
    summitHeightM: 8848.86,
    everestSummit: {
      name: "Everest Summit",
      latitude: 27.9881,
      longitude: 86.925,
      officialHeightM: 8848.86,
    },
    currentHighestPoint: {
      kind: "TERRAIN",
      id: "terrain",
      x: 3031.5,
      y: 3479,
      z: -5194.9,
      latitude: 27.98902747834072,
      longitude: 86.92568712916965,
      altitudeM: 8738,
    },
    worldSummary: {
      stoneCount: 0,
      removedTerrainVoxelCount: 0,
      identityCount: 0,
      activeIdentityCount: 0,
      deadIdentityCount: 0,
      tombstoneCount: 0,
      expeditionCount: 0,
      modifiedTileCount: 0,
    },
    surfaceTiles: {
      voxelEdgeM: 0.2,
      physicsChunkEdgeM: 32,
      tileEdgeM: 256,
      verticalDatumM: 5259,
      tiles: [],
    },
    recentExpeditions: recentExpeditions(),
    memorialClusters: [],
    footprints: observatoryFootprints(),
  };
}

export async function loadObservatoryFeed(signal: AbortSignal) {
  let worldBaseUrl = "/data/world";
  let pollIntervalMs = 30_000;
  try {
    const configResponse = await fetch("/runtime-config.json", {
      cache: "no-store",
      signal,
    });
    if (configResponse.ok) {
      const config = (await configResponse.json()) as {
        worldBaseUrl?: unknown;
        pollIntervalMs?: unknown;
      };
      if (
        typeof config.worldBaseUrl === "string" &&
        config.worldBaseUrl.length > 0
      ) {
        worldBaseUrl = config.worldBaseUrl.replace(/\/+$/, "");
      }
      if (
        typeof config.pollIntervalMs === "number" &&
        config.pollIntervalMs >= 10_000
      ) {
        pollIntervalMs = config.pollIntervalMs;
      }
    }
  } catch (error) {
    if (signal.aborted) throw error;
  }

  if (typeof window !== "undefined") {
    const localFeed = new URLSearchParams(window.location.search).get(
      "world",
    );
    if (
      localFeed &&
      /^\/data\/[A-Za-z0-9/_-]+$/.test(localFeed)
    ) {
      worldBaseUrl = localFeed.replace(/\/+$/, "");
    }
  }

  const response = await fetch(`${worldBaseUrl}/latest.json`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`World feed returned HTTP ${response.status}.`);
  }
  const feed = (await response.json()) as ObservatoryFeed;
  if (
    feed.schemaVersion !== "1.5.0" ||
    !Number.isSafeInteger(feed.sequence) ||
    typeof feed.worldHash !== "string" ||
    !feed.everestSummit ||
    !feed.currentHighestPoint ||
    !feed.worldSummary ||
    !feed.surfaceTiles ||
    !Array.isArray(feed.surfaceTiles.tiles) ||
    !Array.isArray(feed.recentExpeditions) ||
    !Array.isArray(feed.memorialClusters) ||
    !Array.isArray(feed.footprints)
  ) {
    throw new Error("World feed is not a supported observatory document.");
  }
  feed.assetBaseUrl = worldBaseUrl;
  return { feed, pollIntervalMs };
}
