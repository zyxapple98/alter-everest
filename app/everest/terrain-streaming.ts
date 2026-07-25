import * as THREE from "three";
import type { ObservatoryFeed } from "../../lib/world";
import {
  FINAL_WORLD_REPLAY_STATE,
  type ExpeditionReplayWorldState,
} from "./expedition-world-state";
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
  setHiddenStoneIds(hiddenStoneIds: ReadonlySet<string>): void;
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
  replayWorldState?: ExpeditionReplayWorldState;
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

interface SurfaceCell {
  x: number;
  y: number;
  z: number;
}

interface PendingBuild {
  resolve(result: TerrainMeshResult): void;
  reject(error: Error): void;
}

// The active geometry remains alive through Three.js even after its reusable
// cache entry is evicted. Forward expedition playback rarely revisits an old
// terrain state, so a compact cache avoids retaining obsolete clipmaps after
// every quarry or placement phase.
const MAX_MESH_CACHE_BYTES = 12 * 1024 * 1024;

function meshByteLength(result: TerrainMeshResult) {
  return (
    result.positions.byteLength +
    result.colors.byteLength +
    result.visibility.byteLength +
    result.indices.byteLength
  );
}

export function pointBelongsToPatchRing(
  localX: number,
  localZ: number,
  windowM: number,
  innerHoleM: number,
) {
  const inset = Math.max(Math.abs(localX), Math.abs(localZ));
  return (
    Math.abs(localX) < windowM / 2 &&
    Math.abs(localZ) < windowM / 2 &&
    (innerHoleM <= 0 || inset >= innerHoleM / 2)
  );
}

export function anchoredCanonicalWorldPosition(
  canonicalX: number,
  canonicalY: number,
  canonicalZ: number,
  anchorCanonicalX: number,
  anchorCanonicalZ: number,
  anchorWorldX: number,
  anchorWorldZ: number,
  worldUnitsPerMeter: number,
) {
  return new THREE.Vector3(
    anchorWorldX +
      (canonicalX - anchorCanonicalX) * worldUnitsPerMeter,
    canonicalY * worldUnitsPerMeter,
    anchorWorldZ +
      (canonicalZ - anchorCanonicalZ) * worldUnitsPerMeter,
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
  private replayWorldState = FINAL_WORLD_REPLAY_STATE;

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
    const finalLevels = this.tiles.removedLevels(columnX, columnZ);
    if (!finalLevels) return undefined;
    const effectiveLevels = new Set<number>();
    finalLevels.forEach((level) => {
      const key = `${columnX}:${level}:${columnZ}`;
      if (!this.replayWorldState.restoredTerrainVoxelKeys.has(key)) {
        effectiveLevels.add(level);
      }
    });
    return effectiveLevels.size > 0 ? effectiveLevels : undefined;
  }

  setReplayWorldState(state: ExpeditionReplayWorldState) {
    this.replayWorldState = state;
  }

  cellWorldPosition(
    cell: SurfaceCell,
    anchorWorldX: number,
    anchorWorldZ: number,
  ) {
    const anchorCanonical = this.worldToCanonical(
      anchorWorldX,
      anchorWorldZ,
    );
    const voxelEdgeM = this.tiles.definition.voxelEdgeM;
    return anchoredCanonicalWorldPosition(
      (cell.x + 0.5) * voxelEdgeM,
      this.tiles.definition.verticalDatumM +
        (cell.y + 0.5) * voxelEdgeM,
      (cell.z + 0.5) * voxelEdgeM,
      anchorCanonical.x,
      anchorCanonical.z,
      anchorWorldX,
      anchorWorldZ,
      this.context.worldUnitsPerMeter,
    );
  }

  cameraObstacleTopY(
    worldX: number,
    worldZ: number,
    safetyRadiusM = 0.32,
  ) {
    const canonical = this.worldToCanonical(worldX, worldZ);
    const voxelEdgeM = this.tiles.definition.voxelEdgeM;
    const minimumColumnX = Math.floor(
      (canonical.x - safetyRadiusM) / voxelEdgeM,
    );
    const maximumColumnX = Math.floor(
      (canonical.x + safetyRadiusM) / voxelEdgeM,
    );
    const minimumColumnZ = Math.floor(
      (canonical.z - safetyRadiusM) / voxelEdgeM,
    );
    const maximumColumnZ = Math.floor(
      (canonical.z + safetyRadiusM) / voxelEdgeM,
    );
    let highestLevel: number | undefined;
    for (
      let columnZ = minimumColumnZ;
      columnZ <= maximumColumnZ;
      columnZ += 1
    ) {
      for (
        let columnX = minimumColumnX;
        columnX <= maximumColumnX;
        columnX += 1
      ) {
        const level = this.tiles.highestStoneLevel(
          columnX,
          columnZ,
          this.replayWorldState.hiddenStoneIds,
        );
        if (
          level !== undefined &&
          (highestLevel === undefined || level > highestLevel)
        ) {
          highestLevel = level;
        }
      }
    }
    if (highestLevel === undefined) return undefined;
    return (
      (this.tiles.definition.verticalDatumM +
        (highestLevel + 1) * voxelEdgeM) *
      this.context.worldUnitsPerMeter
    );
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
    const finalChunks = await this.tiles.chunksInBounds(
      this.boundsForPatch(
        request.centerWorldX,
        request.centerWorldZ,
        windowM,
      ),
    );
    const replayWorldState =
      request.replayWorldState ?? FINAL_WORLD_REPLAY_STATE;
    const chunks =
      replayWorldState.restoredTerrainVoxelKeys.size === 0
        ? finalChunks
        : finalChunks.map((chunk) => ({
            ...chunk,
            removedTerrainVoxels:
              chunk.removedTerrainVoxels.filter(
                (cell) =>
                  !replayWorldState.restoredTerrainVoxelKeys.has(
                    `${cell.x}:${cell.y}:${cell.z}`,
                  ),
              ),
          }));
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
    let stoneMesh: THREE.InstancedMesh | null = null;
    let stoneIds: string[] = [];
    let stoneMatrices: THREE.Matrix4[] = [];
    let hiddenStoneSignature = "";
    const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    const applyHiddenStoneIds = (
      hiddenStoneIds: ReadonlySet<string>,
    ) => {
      if (!stoneMesh) return;
      const signature = stoneIds
        .filter((id) => hiddenStoneIds.has(id))
        .join("\u0000");
      if (signature === hiddenStoneSignature) return;
      hiddenStoneSignature = signature;
      stoneIds.forEach((id, index) => {
        stoneMesh!.setMatrixAt(
          index,
          hiddenStoneIds.has(id)
            ? hiddenMatrix
            : stoneMatrices[index],
        );
      });
      stoneMesh.instanceMatrix.needsUpdate = true;
    };
    if (request.cellM <= 1.6) {
      const stones = chunks
        .flatMap((chunk) => chunk.stones)
        .filter(({ cell }) => {
          const x =
            (cell.x + 0.5) * this.tiles.definition.voxelEdgeM;
          const z =
            (cell.z + 0.5) * this.tiles.definition.voxelEdgeM;
          const localX = x - result!.centerCanonicalX;
          const localZ = z - result!.centerCanonicalZ;
          return pointBelongsToPatchRing(
            localX,
            localZ,
            windowM,
            request.innerHoleM,
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
        stoneMesh = new THREE.InstancedMesh(
          stoneGeometry,
          stoneMaterial,
          stones.length,
        );
        const transform = new THREE.Object3D();
        stoneIds = stones.map(({ id }) => id);
        stoneMatrices = stones.map(({ cell }, index) => {
          const x =
            (cell.x + 0.5) * this.tiles.definition.voxelEdgeM;
          const y =
            (cell.y + 0.5) * this.tiles.definition.voxelEdgeM;
          const z =
            (cell.z + 0.5) * this.tiles.definition.voxelEdgeM;
          transform.position.copy(
            anchoredCanonicalWorldPosition(
              x,
              y + this.tiles.definition.verticalDatumM,
              z,
              result!.centerCanonicalX,
              result!.centerCanonicalZ,
              request.centerWorldX,
              request.centerWorldZ,
              this.context.worldUnitsPerMeter,
            ),
          );
          transform.quaternion.identity();
          transform.updateMatrix();
          stoneMesh!.setMatrixAt(index, transform.matrix);
          return transform.matrix.clone();
        });
        stoneMesh.instanceMatrix.needsUpdate = true;
        applyHiddenStoneIds(replayWorldState.hiddenStoneIds);
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
      setHiddenStoneIds(hiddenStoneIds: ReadonlySet<string>) {
        applyHiddenStoneIds(hiddenStoneIds);
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

  clearMeshCache() {
    this.meshCache.clear();
    this.meshCacheBytes = 0;
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
