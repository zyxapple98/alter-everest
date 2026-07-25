import type {
  ObservatoryFeed,
  ObservatorySurfaceDeltaChunk,
  ObservatorySurfaceTile,
  ObservatorySurfaceTileManifest,
} from "../../lib/world";

export interface SurfaceBounds {
  minimumX: number;
  maximumX: number;
  minimumZ: number;
  maximumZ: number;
}

export interface SurfaceDefinition {
  voxelEdgeM: number;
  physicsChunkEdgeM: number;
  verticalDatumM: number;
}

export interface SurfaceTileStoreStats {
  residentTiles: number;
  residentTileBytes: number;
  cacheHits: number;
  cacheMisses: number;
  fetchedBytes: number;
}

interface ResidentSurfaceTile {
  payload: ObservatorySurfaceTile;
  byteLength: number;
}

const MAX_RESIDENT_TILES = 48;
const MAX_RESIDENT_TILE_BYTES = 12 * 1024 * 1024;

function chunkIntersectsBounds(
  chunk: ObservatorySurfaceDeltaChunk,
  chunkEdgeM: number,
  bounds: SurfaceBounds,
) {
  const minimumX = chunk.x * chunkEdgeM;
  const minimumZ = chunk.z * chunkEdgeM;
  return (
    minimumX + chunkEdgeM >= bounds.minimumX &&
    minimumX <= bounds.maximumX &&
    minimumZ + chunkEdgeM >= bounds.minimumZ &&
    minimumZ <= bounds.maximumZ
  );
}

function surfaceDefinition(feed: ObservatoryFeed): SurfaceDefinition {
  const source = feed.surfaceTiles ?? feed.surfaceDelta;
  return {
    voxelEdgeM: source?.voxelEdgeM ?? 0.2,
    physicsChunkEdgeM: source?.physicsChunkEdgeM ?? 32,
    verticalDatumM: source?.verticalDatumM ?? 5_259,
  };
}

export class SurfaceTileStore {
  private feed: ObservatoryFeed;
  private definitionValue: SurfaceDefinition;
  private tileEdgeM = 256;
  private manifests = new Map<string, ObservatorySurfaceTileManifest>();
  private readonly payloads = new Map<string, ResidentSurfaceTile>();
  private readonly pending = new Map<
    string,
    Promise<ObservatorySurfaceTile>
  >();
  private readonly loadedChunks = new Map<
    string,
    ObservatorySurfaceDeltaChunk
  >();
  private readonly removedByColumn = new Map<string, Set<number>>();
  private cacheHits = 0;
  private cacheMisses = 0;
  private fetchedBytes = 0;
  private residentTileBytes = 0;

  constructor(feed: ObservatoryFeed) {
    this.feed = feed;
    this.definitionValue = surfaceDefinition(feed);
    this.setFeed(feed);
  }

  setFeed(feed: ObservatoryFeed) {
    const worldChanged = feed.worldHash !== this.feed.worldHash;
    this.feed = feed;
    this.definitionValue = surfaceDefinition(feed);
    this.tileEdgeM = feed.surfaceTiles?.tileEdgeM ?? 256;
    this.manifests = new Map(
      (feed.surfaceTiles?.tiles ?? []).map((tile) => [
        tile.id,
        tile,
      ]),
    );
    if (worldChanged) {
      this.loadedChunks.clear();
      this.removedByColumn.clear();
    }
    for (const chunk of feed.surfaceDelta?.chunks ?? []) {
      this.indexChunk(chunk);
    }
  }

  get definition() {
    return this.definitionValue;
  }

  private indexChunk(chunk: ObservatorySurfaceDeltaChunk) {
    if (this.loadedChunks.get(chunk.id)?.hash === chunk.hash) return;
    this.loadedChunks.set(chunk.id, chunk);
    for (const voxel of chunk.removedTerrainVoxels) {
      const key = `${voxel.x}:${voxel.z}`;
      const levels = this.removedByColumn.get(key) ?? new Set<number>();
      levels.add(voxel.y);
      this.removedByColumn.set(key, levels);
    }
  }

  private unindexChunk(chunk: ObservatorySurfaceDeltaChunk) {
    if (this.loadedChunks.get(chunk.id)?.hash !== chunk.hash) return;
    this.loadedChunks.delete(chunk.id);
    for (const voxel of chunk.removedTerrainVoxels) {
      const key = `${voxel.x}:${voxel.z}`;
      const levels = this.removedByColumn.get(key);
      if (!levels) continue;
      levels.delete(voxel.y);
      if (levels.size === 0) this.removedByColumn.delete(key);
    }
  }

  removedLevels(columnX: number, columnZ: number) {
    return this.removedByColumn.get(`${columnX}:${columnZ}`);
  }

  private tileUrl(manifest: ObservatorySurfaceTileManifest) {
    const base = (this.feed.assetBaseUrl ?? "/data/world").replace(
      /\/+$/,
      "",
    );
    return `${base}/${manifest.path.replace(/^\/+/, "")}`;
  }

  private touchPayload(
    url: string,
    payload: ObservatorySurfaceTile,
    byteLength: number,
  ) {
    const existing = this.payloads.get(url);
    if (existing) this.residentTileBytes -= existing.byteLength;
    this.payloads.delete(url);
    this.payloads.set(url, { payload, byteLength });
    this.residentTileBytes += byteLength;
    while (
      this.payloads.size > MAX_RESIDENT_TILES ||
      this.residentTileBytes > MAX_RESIDENT_TILE_BYTES
    ) {
      const oldest = this.payloads.keys().next().value as string | undefined;
      if (!oldest) break;
      const evicted = this.payloads.get(oldest);
      this.payloads.delete(oldest);
      if (!evicted) continue;
      this.residentTileBytes -= evicted.byteLength;
      evicted.payload.chunks.forEach((chunk) =>
        this.unindexChunk(chunk),
      );
    }
  }

  private async loadTile(
    manifest: ObservatorySurfaceTileManifest,
  ): Promise<ObservatorySurfaceTile> {
    const url = this.tileUrl(manifest);
    const cached = this.payloads.get(url);
    if (cached) {
      this.cacheHits += 1;
      this.touchPayload(url, cached.payload, cached.byteLength);
      cached.payload.chunks.forEach((chunk) => this.indexChunk(chunk));
      return cached.payload;
    }
    const existing = this.pending.get(url);
    if (existing) {
      this.cacheHits += 1;
      return existing;
    }
    this.cacheMisses += 1;
    const request = fetch(url, {
      cache: "force-cache",
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            `Surface tile ${manifest.id} returned HTTP ${response.status}.`,
          );
        }
        const bytes = await response.arrayBuffer();
        this.fetchedBytes += bytes.byteLength;
        const payload = JSON.parse(
          new TextDecoder().decode(bytes),
        ) as ObservatorySurfaceTile;
        if (
          payload.schemaVersion !== "1.0.0" ||
          payload.hash !== manifest.hash ||
          !Array.isArray(payload.chunks)
        ) {
          throw new Error(`Surface tile ${manifest.id} is invalid.`);
        }
        this.touchPayload(url, payload, bytes.byteLength);
        const stillCurrent =
          this.manifests.get(manifest.id)?.hash === manifest.hash;
        if (stillCurrent) {
          payload.chunks.forEach((chunk) => this.indexChunk(chunk));
        }
        return payload;
      })
      .finally(() => {
        this.pending.delete(url);
      });
    this.pending.set(url, request);
    return request;
  }

  private manifestsInBounds(bounds: SurfaceBounds) {
    const minimumTileX = Math.floor(bounds.minimumX / this.tileEdgeM);
    const maximumTileX = Math.floor(bounds.maximumX / this.tileEdgeM);
    const minimumTileZ = Math.floor(bounds.minimumZ / this.tileEdgeM);
    const maximumTileZ = Math.floor(bounds.maximumZ / this.tileEdgeM);
    const manifests: ObservatorySurfaceTileManifest[] = [];
    for (let z = minimumTileZ; z <= maximumTileZ; z += 1) {
      for (let x = minimumTileX; x <= maximumTileX; x += 1) {
        const manifest = this.manifests.get(`${x}:${z}`);
        if (manifest) manifests.push(manifest);
      }
    }
    return manifests;
  }

  async chunksInBounds(bounds: SurfaceBounds) {
    if (!this.feed.surfaceTiles) {
      return (this.feed.surfaceDelta?.chunks ?? []).filter((chunk) =>
        chunkIntersectsBounds(
          chunk,
          this.definitionValue.physicsChunkEdgeM,
          bounds,
        ),
      );
    }
    const payloads = await Promise.all(
      this.manifestsInBounds(bounds).map((manifest) =>
        this.loadTile(manifest),
      ),
    );
    return payloads
      .flatMap((payload) => payload.chunks)
      .filter((chunk) =>
        chunkIntersectsBounds(
          chunk,
          this.definitionValue.physicsChunkEdgeM,
          bounds,
        ),
      );
  }

  prefetch(bounds: SurfaceBounds) {
    void this.chunksInBounds(bounds).catch((error: unknown) => {
      console.warn("A surface tile could not be prefetched.", error);
    });
  }

  stats(): SurfaceTileStoreStats {
    return {
      residentTiles: this.payloads.size,
      residentTileBytes: this.residentTileBytes,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      fetchedBytes: this.fetchedBytes,
    };
  }
}
