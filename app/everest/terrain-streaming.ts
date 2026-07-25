import * as THREE from "three";
import type { ObservatoryFeed } from "../../lib/world";
import { MOUNTAIN_MATERIALS } from "./terrain-palette";
import {
  buildTerrainMesh,
  type TerrainMesherContext,
  type TerrainMeshRequest,
  type TerrainMeshResult,
} from "./terrain-mesher";
import {
  SurfaceTileStore,
  type SurfaceBounds,
  type SurfaceDefinition,
} from "./surface-tile-store";

export interface StreamedDetailPatch {
  key: string;
  group: THREE.Group;
  cellM: number;
  windowM: number;
  voxelCount: number;
  setOpacity(opacity: number): void;
  dispose(): void;
}

export interface TerrainPatchRequest {
  key: string;
  centerWorldX: number;
  centerWorldZ: number;
  cellM: number;
  gridCells: number;
  innerHoleM: number;
  innerOverlapM: number;
  outerTransitionM: number;
  terrainTint: string;
}

export interface TerrainStreamingStats {
  workerBuildMs: number;
  meshCacheEntries: number;
  meshCacheBytes: number;
  meshCacheHits: number;
  meshCacheMisses: number;
  workerQueue: number;
  residentTiles: number;
  residentTileBytes: number;
  tileCacheHits: number;
  tileCacheMisses: number;
  fetchedTileBytes: number;
}

interface PendingBuild {
  resolve(result: TerrainMeshResult): void;
  reject(error: Error): void;
}

// Current geometry remains alive through Three.js even after its reusable
// cache entry is evicted. A 64 MiB reuse budget keeps useful neighboring rings
// without retaining a second large clipmap after a long zoom session.
const MAX_MESH_CACHE_BYTES = 64 * 1024 * 1024;

function meshByteLength(result: TerrainMeshResult) {
  return (
    result.positions.byteLength +
    result.colors.byteLength +
    result.visibility.byteLength +
    result.indices.byteLength
  );
}

function createDitheredVoxelMaterial() {
  const material = new THREE.MeshBasicMaterial({
    color: "#ffffff",
    vertexColors: true,
    side: THREE.FrontSide,
    transparent: false,
    opacity: 1,
    depthWrite: true,
    fog: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float lodVisibility;
varying float vLodVisibility;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vLodVisibility = lodVisibility;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying float vLodVisibility;
float lodDither(vec2 point) {
  return fract(52.9829189 * fract(dot(point, vec2(0.06711056, 0.00583715))));
}`,
      )
      .replace(
        "#include <dithering_fragment>",
        `if (lodDither(gl_FragCoord.xy) > vLodVisibility) discard;
#include <dithering_fragment>`,
      );
  };
  material.customProgramCacheKey = () => "ae-voxel-lod-dither-v1";
  return material;
}

export class TerrainStreamingEngine {
  private feed: ObservatoryFeed;
  private readonly context: TerrainMesherContext;
  private readonly tiles: SurfaceTileStore;
  private worker: Worker | null = null;
  private workerReady: Promise<void> = Promise.resolve();
  private nextBuildId = 1;
  private readonly pendingBuilds = new Map<number, PendingBuild>();
  private readonly meshCache = new Map<string, TerrainMeshResult>();
  private meshCacheBytes = 0;
  private meshCacheHits = 0;
  private meshCacheMisses = 0;
  private lastWorkerBuildMs = 0;

  constructor(context: TerrainMesherContext, feed: ObservatoryFeed) {
    this.context = context;
    this.feed = feed;
    this.tiles = new SurfaceTileStore(feed);
    if (typeof Worker !== "undefined") {
      try {
        const worker = new Worker(
          new URL("./terrain-worker.ts", import.meta.url),
          { type: "module", name: "alter-everest-terrain" },
        );
        this.worker = worker;
        this.workerReady = new Promise<void>((resolve, reject) => {
          const handleInitialMessage = (event: MessageEvent) => {
            if (event.data?.type === "ready") {
              worker.removeEventListener("message", handleInitialMessage);
              resolve();
            }
          };
          worker.addEventListener("message", handleInitialMessage);
          worker.addEventListener(
            "error",
            () => reject(new Error("Terrain worker failed to start.")),
            { once: true },
          );
        });
        worker.addEventListener("message", this.handleWorkerMessage);
        worker.addEventListener("error", this.handleWorkerFailure);
        const { elevations, ...workerContext } = context;
        const elevationCopy = elevations.slice();
        worker.postMessage(
          {
            type: "initialize",
            context: workerContext,
            elevations: elevationCopy.buffer,
          },
          [elevationCopy.buffer],
        );
      } catch (error) {
        console.warn("Terrain worker is unavailable; using main thread.", error);
        this.worker = null;
      }
    }
  }

  get definition(): SurfaceDefinition {
    return this.tiles.definition;
  }

  removedLevels(columnX: number, columnZ: number) {
    return this.tiles.removedLevels(columnX, columnZ);
  }

  setFeed(feed: ObservatoryFeed) {
    if (feed.worldHash === this.feed.worldHash) return;
    this.feed = feed;
    this.tiles.setFeed(feed);
  }

  private readonly handleWorkerMessage = (event: MessageEvent) => {
    const message = event.data as {
      type: "result" | "error";
      id?: number;
      result?: TerrainMeshResult;
      message?: string;
    };
    if (typeof message.id !== "number") return;
    const pending = this.pendingBuilds.get(message.id);
    if (!pending) return;
    this.pendingBuilds.delete(message.id);
    if (message.type === "result" && message.result) {
      pending.resolve(message.result);
    } else {
      pending.reject(
        new Error(message.message ?? "Terrain worker build failed."),
      );
    }
  };

  private readonly handleWorkerFailure = (event: ErrorEvent) => {
    console.warn("Terrain worker stopped; using main thread.", event.message);
    this.worker?.terminate();
    this.worker = null;
    this.pendingBuilds.forEach(({ reject }) =>
      reject(new Error("Terrain worker stopped.")),
    );
    this.pendingBuilds.clear();
  };

  private async build(request: TerrainMeshRequest) {
    if (!this.worker) return buildTerrainMesh(this.context, request);
    try {
      await this.workerReady;
      if (!this.worker) return buildTerrainMesh(this.context, request);
      const id = this.nextBuildId;
      this.nextBuildId += 1;
      const result = new Promise<TerrainMeshResult>((resolve, reject) => {
        this.pendingBuilds.set(id, { resolve, reject });
      });
      this.worker.postMessage({ type: "build", id, request });
      return await result;
    } catch (error) {
      console.warn("Terrain worker build fell back to main thread.", error);
      return buildTerrainMesh(this.context, request);
    }
  }

  private touchCache(key: string, result: TerrainMeshResult) {
    const existing = this.meshCache.get(key);
    if (existing) this.meshCacheBytes -= meshByteLength(existing);
    this.meshCache.delete(key);
    this.meshCache.set(key, result);
    this.meshCacheBytes += meshByteLength(result);
    while (this.meshCacheBytes > MAX_MESH_CACHE_BYTES) {
      const oldestKey = this.meshCache.keys().next().value as
        | string
        | undefined;
      if (!oldestKey) break;
      const oldest = this.meshCache.get(oldestKey);
      if (oldest) this.meshCacheBytes -= meshByteLength(oldest);
      this.meshCache.delete(oldestKey);
    }
  }

  private worldToCanonical(worldX: number, worldZ: number) {
    const { metadata, terrain } = this.context;
    const degreesPerSample = metadata.sampleSpacingArcSeconds / 3600;
    const column =
      (worldX - terrain.xOrigin) / terrain.blockSize - 0.5;
    const row =
      (worldZ - terrain.zOrigin) / terrain.blockSize - 0.5;
    const latitude =
      metadata.bounds.north - (row + 0.5) * degreesPerSample;
    const longitude =
      metadata.bounds.west + (column + 0.5) * degreesPerSample;
    const metersPerDegreeLongitude =
      this.context.metersPerDegreeLatitude *
      Math.cos(
        (this.context.canonicalOriginLatitude * Math.PI) / 180,
      );
    return {
      x:
        (longitude - this.context.canonicalOriginLongitude) *
        metersPerDegreeLongitude,
      z:
        (this.context.canonicalOriginLatitude - latitude) *
        this.context.metersPerDegreeLatitude,
    };
  }

  private boundsForPatch(
    centerWorldX: number,
    centerWorldZ: number,
    windowM: number,
  ): SurfaceBounds {
    const center = this.worldToCanonical(centerWorldX, centerWorldZ);
    const half = windowM / 2;
    return {
      minimumX: center.x - half,
      maximumX: center.x + half,
      minimumZ: center.z - half,
      maximumZ: center.z + half,
    };
  }

  prefetch(
    centerWorldX: number,
    centerWorldZ: number,
    windowM: number,
  ) {
    this.tiles.prefetch(
      this.boundsForPatch(centerWorldX, centerWorldZ, windowM),
    );
  }

  async createPatch(
    request: TerrainPatchRequest,
  ): Promise<StreamedDetailPatch> {
    this.setFeed(this.feed);
    const windowM = request.cellM * request.gridCells;
    const chunks = await this.tiles.chunksInBounds(
      this.boundsForPatch(
        request.centerWorldX,
        request.centerWorldZ,
        windowM,
      ),
    );
    const meshRequest: TerrainMeshRequest = {
      centerWorldX: request.centerWorldX,
      centerWorldZ: request.centerWorldZ,
      cellM: request.cellM,
      gridCells: request.gridCells,
      innerHoleM: request.innerHoleM,
      innerOverlapM: request.innerOverlapM,
      outerTransitionM: request.outerTransitionM,
      terrainTint: request.terrainTint,
      delta: {
        voxelEdgeM: this.tiles.definition.voxelEdgeM,
        verticalDatumM: this.tiles.definition.verticalDatumM,
        chunks,
      },
    };
    let result = this.meshCache.get(request.key);
    if (result) {
      this.meshCacheHits += 1;
      this.touchCache(request.key, result);
    } else {
      this.meshCacheMisses += 1;
      result = await this.build(meshRequest);
      this.lastWorkerBuildMs = result.buildMs;
      this.touchCache(request.key, result);
    }

    const group = new THREE.Group();
    const surfaceGeometry = new THREE.BufferGeometry();
    surfaceGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(result.positions, 3),
    );
    surfaceGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(result.colors, 3, true),
    );
    surfaceGeometry.setAttribute(
      "lodVisibility",
      new THREE.BufferAttribute(result.visibility, 1, true),
    );
    surfaceGeometry.setIndex(
      new THREE.BufferAttribute(result.indices, 1),
    );
    surfaceGeometry.computeBoundingSphere();
    const surfaceMaterial = createDitheredVoxelMaterial();
    const surfaceMesh = new THREE.Mesh(
      surfaceGeometry,
      surfaceMaterial,
    );
    group.add(surfaceMesh);

    let stoneVoxelCount = 0;
    if (request.cellM <= 1.6) {
      const stones = chunks
        .flatMap((chunk) => chunk.stones)
        .filter(({ pose }) => {
          const half = windowM / 2 - this.tiles.definition.voxelEdgeM;
          return (
            Math.abs(
              pose.translation.x - result!.centerCanonicalX,
            ) < half &&
            Math.abs(
              pose.translation.z - result!.centerCanonicalZ,
            ) < half
          );
        });
      if (stones.length > 0) {
        const stoneWorld =
          this.tiles.definition.voxelEdgeM *
          this.context.worldUnitsPerMeter;
        const stoneGeometry = new THREE.BoxGeometry(
          stoneWorld,
          stoneWorld,
          stoneWorld,
        );
        const stoneMaterial = new THREE.MeshLambertMaterial({
          color: MOUNTAIN_MATERIALS.placedGranite,
        });
        const stoneMesh = new THREE.InstancedMesh(
          stoneGeometry,
          stoneMaterial,
          stones.length,
        );
        const transform = new THREE.Object3D();
        stones.forEach(({ pose }, index) => {
          transform.position.set(
            request.centerWorldX +
              (pose.translation.x - result!.centerCanonicalX) *
                this.context.worldUnitsPerMeter,
            (pose.translation.y + this.tiles.definition.verticalDatumM) *
              this.context.worldUnitsPerMeter,
            request.centerWorldZ +
              (pose.translation.z - result!.centerCanonicalZ) *
                this.context.worldUnitsPerMeter,
          );
          transform.quaternion.set(
            pose.rotation.x,
            pose.rotation.y,
            pose.rotation.z,
            pose.rotation.w,
          );
          transform.updateMatrix();
          stoneMesh.setMatrixAt(index, transform.matrix);
        });
        stoneMesh.instanceMatrix.needsUpdate = true;
        stoneMesh.computeBoundingSphere();
        group.add(stoneMesh);
        stoneVoxelCount = stones.length;
      }
    }

    return {
      key: request.key,
      group,
      cellM: request.cellM,
      windowM,
      voxelCount: result.renderedTopCount + stoneVoxelCount,
      setOpacity(opacity: number) {
        const safeOpacity = THREE.MathUtils.clamp(opacity, 0, 1);
        group.visible = safeOpacity > 0.01;
      },
      dispose() {
        group.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.geometry.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((material) => material.dispose());
        });
      },
    };
  }

  stats(): TerrainStreamingStats {
    const tileStats = this.tiles.stats();
    return {
      workerBuildMs: this.lastWorkerBuildMs,
      meshCacheEntries: this.meshCache.size,
      meshCacheBytes: this.meshCacheBytes,
      meshCacheHits: this.meshCacheHits,
      meshCacheMisses: this.meshCacheMisses,
      workerQueue: this.pendingBuilds.size,
      residentTiles: tileStats.residentTiles,
      residentTileBytes: tileStats.residentTileBytes,
      tileCacheHits: tileStats.cacheHits,
      tileCacheMisses: tileStats.cacheMisses,
      fetchedTileBytes: tileStats.fetchedBytes,
    };
  }

  dispose() {
    this.worker?.removeEventListener(
      "message",
      this.handleWorkerMessage,
    );
    this.worker?.removeEventListener("error", this.handleWorkerFailure);
    this.worker?.terminate();
    this.worker = null;
    this.pendingBuilds.forEach(({ reject }) =>
      reject(new Error("Terrain streaming was disposed.")),
    );
    this.pendingBuilds.clear();
    this.meshCache.clear();
    this.meshCacheBytes = 0;
  }
}
