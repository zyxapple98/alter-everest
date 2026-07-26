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
import {
  canonicalWorldScale,
  worldToCanonical,
  type CanonicalWorldScale,
} from "./canonical-world";

export interface StreamedDetailPatch {
  key: string;
  group: THREE.Group;
  cellM: number;
  windowM: number;
  voxelCount: number;
  bufferBytes: number;
  setOpacity(opacity: number): void;
  setHiddenStoneIds(hiddenStoneIds: ReadonlySet<string>): void;
  dispose(): void;
}

export interface TerrainPatchRequest {
  key: string;
  centerWorldX: number;
  centerWorldZ: number;
  innerCenterWorldX?: number;
  innerCenterWorldZ?: number;
  cellM: number;
  gridCells: number;
  innerHoleM: number;
  innerCellM: number;
  sealOuterBoundary: boolean;
  terrainTint: string;
  fogDensity: number;
  atmosphere: {
    top: string;
    middle: string;
    horizon: string;
    nadir: string;
  };
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
    result.indices.byteLength
  );
}

export function pointBelongsToPatchRing(
  localX: number,
  localZ: number,
  windowM: number,
  innerHoleM: number,
  innerCenterOffsetX = 0,
  innerCenterOffsetZ = 0,
) {
  const insideInnerHole =
    innerHoleM > 0 &&
    Math.abs(localX - innerCenterOffsetX) < innerHoleM / 2 &&
    Math.abs(localZ - innerCenterOffsetZ) < innerHoleM / 2;
  return (
    Math.abs(localX) < windowM / 2 &&
    Math.abs(localZ) < windowM / 2 &&
    !insideInnerHole
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
  worldScale: CanonicalWorldScale,
) {
  return new THREE.Vector3(
    anchorWorldX +
      (canonicalX - anchorCanonicalX) * worldScale.x,
    canonicalY * worldScale.y,
    anchorWorldZ +
      (canonicalZ - anchorCanonicalZ) * worldScale.z,
  );
}

function createVoxelMaterial(
  fogDensity: number,
  atmosphere: TerrainPatchRequest["atmosphere"],
) {
  const material = new THREE.MeshBasicMaterial({
    color: "#ffffff",
    vertexColors: true,
    side: THREE.FrontSide,
    transparent: false,
    opacity: 1,
    depthWrite: true,
    // Terrain uses the same directional gradient as the atmosphere. A
    // constant scene fog colour leaves a visible silhouette wherever the far
    // plane crosses high mountains because the sky above the horizon is not
    // a constant colour.
    fog: false,
  });
  const skyTop = new THREE.Color(atmosphere.top);
  const skyMiddle = new THREE.Color(atmosphere.middle);
  const skyHorizon = new THREE.Color(atmosphere.horizon);
  const skyNadir = new THREE.Color(atmosphere.nadir);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.terrainFogDensity = { value: fogDensity };
    shader.uniforms.terrainSkyTop = { value: skyTop };
    shader.uniforms.terrainSkyMiddle = { value: skyMiddle };
    shader.uniforms.terrainSkyHorizon = { value: skyHorizon };
    shader.uniforms.terrainSkyNadir = { value: skyNadir };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vTerrainWorldPosition;`,
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
vTerrainWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float terrainFogDensity;
uniform vec3 terrainSkyTop;
uniform vec3 terrainSkyMiddle;
uniform vec3 terrainSkyHorizon;
uniform vec3 terrainSkyNadir;
varying vec3 vTerrainWorldPosition;

vec3 terrainAtmosphereColor(vec3 direction) {
  float altitude = normalize(direction).y;
  float middleMix = smoothstep(0.0, 0.3, altitude);
  float topMix = smoothstep(0.22, 0.86, altitude);
  vec3 upperSky = mix(terrainSkyHorizon, terrainSkyMiddle, middleMix);
  upperSky = mix(upperSky, terrainSkyTop, topMix);
  float belowHorizon = smoothstep(0.12, 0.58, -altitude);
  vec3 lowerSky = mix(terrainSkyHorizon, terrainSkyNadir, belowHorizon);
  return altitude >= 0.0 ? upperSky : lowerSky;
}`,
      )
      .replace(
        "#include <fog_fragment>",
        `float terrainFogDistance =
  length(vTerrainWorldPosition - cameraPosition);
float terrainFogFactor = 1.0 - exp(
  -terrainFogDensity * terrainFogDensity *
  terrainFogDistance * terrainFogDistance
);
gl_FragColor.rgb = mix(
  gl_FragColor.rgb,
  terrainAtmosphereColor(vTerrainWorldPosition - cameraPosition),
  terrainFogFactor
);`,
      );
  };
  material.customProgramCacheKey = () =>
    [
      "terrain-directional-fog-v1",
      fogDensity.toFixed(9),
      atmosphere.top,
      atmosphere.middle,
      atmosphere.horizon,
      atmosphere.nadir,
    ].join(":");
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
  private readonly worldScale: CanonicalWorldScale;

  constructor(context: TerrainMesherContext, feed: ObservatoryFeed) {
    this.context = context;
    this.worldScale = canonicalWorldScale(context);
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
        const {
          elevations,
          elevationSources = [],
          ...workerContext
        } = context;
        const elevationCopy = elevations.slice();
        const elevationSourceCopies = elevationSources.map(
          ({ elevations: sourceElevations, ...source }) => {
            const sourceCopy = sourceElevations.slice();
            return {
              source: {
                ...source,
                elevations: sourceCopy.buffer,
              },
              buffer: sourceCopy.buffer,
            };
          },
        );
        worker.postMessage(
          {
            type: "initialize",
            context: workerContext,
            elevations: elevationCopy.buffer,
            elevationSources: elevationSourceCopies.map(
              ({ source }) => source,
            ),
          },
          [
            elevationCopy.buffer,
            ...elevationSourceCopies.map(({ buffer }) => buffer),
          ],
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
      this.worldScale,
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
    return worldToCanonical(this.context, worldX, worldZ);
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
    const finalChunks =
      request.cellM <= 1.6
        ? await this.tiles.chunksInBounds(
            this.boundsForPatch(
              request.centerWorldX,
              request.centerWorldZ,
              windowM,
            ),
          )
        : [];
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
      innerCenterWorldX: request.innerCenterWorldX,
      innerCenterWorldZ: request.innerCenterWorldZ,
      cellM: request.cellM,
      gridCells: request.gridCells,
      innerHoleM: request.innerHoleM,
      innerCellM: request.innerCellM,
      sealOuterBoundary: request.sealOuterBoundary,
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
    surfaceGeometry.setIndex(
      new THREE.BufferAttribute(result.indices, 1),
    );
    surfaceGeometry.computeBoundingSphere();
    const surfaceMaterial = createVoxelMaterial(
      request.fogDensity,
      request.atmosphere,
    );
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
      const innerCenterCanonical = this.worldToCanonical(
        request.innerCenterWorldX ?? request.centerWorldX,
        request.innerCenterWorldZ ?? request.centerWorldZ,
      );
      const innerCenterOffsetX =
        innerCenterCanonical.x - result.centerCanonicalX;
      const innerCenterOffsetZ =
        innerCenterCanonical.z - result.centerCanonicalZ;
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
            innerCenterOffsetX,
            innerCenterOffsetZ,
          );
        });
      if (stones.length > 0) {
        const stoneGeometry = new THREE.BoxGeometry(
          this.tiles.definition.voxelEdgeM * this.worldScale.x,
          this.tiles.definition.voxelEdgeM * this.worldScale.y,
          this.tiles.definition.voxelEdgeM * this.worldScale.z,
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
              this.worldScale,
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
      bufferBytes: meshByteLength(result),
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
