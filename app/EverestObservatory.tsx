"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  fallbackObservatoryFeed,
  loadObservatoryFeed,
  type ObservatoryFeed,
  type ObservatorySurfaceDeltaChunk,
} from "../lib/world";
import { syntheticReliefM } from "../engine/surface";
import {
  ScreenSpaceLodSelector,
  SurfaceNavigationController,
} from "./everest/terrain-runtime";
import { TerrainStreamingEngine } from "./everest/terrain-streaming";

interface DemMetadata {
  id: string;
  lod: "core" | "mid" | "far";
  source: string;
  sourceResolutionM: number;
  displayResolutionM: number;
  sampleSpacingArcSeconds: number;
  width: number;
  height: number;
  bounds: DemBounds;
  minimumM: number;
  maximumM: number;
  attribution: string;
}

interface DemBounds {
  north: number;
  south: number;
  west: number;
  east: number;
}

interface DemLayer {
  metadata: DemMetadata;
  elevations: Int16Array;
}

interface SiteAnchor {
  id: string;
  name: string;
  kind: "BASE" | "LANDMARK" | "SUMMIT";
  side: "SOUTH" | "NORTH" | "BOTH";
  latitude: number;
  longitude: number;
}

interface MemorialCluster {
  id: string;
  latitude: number;
  longitude: number;
  count: number;
  latestAgent?: string;
}

interface VoxelTerrain {
  mesh: THREE.Mesh;
  levels: Int16Array;
  width: number;
  height: number;
  blockSize: number;
  baseElevationM: number;
  verticalStepM: number;
  peakColumn: number;
  peakRow: number;
  xOrigin: number;
  zOrigin: number;
}

interface DetailPatch {
  key: string;
  group: THREE.Group;
  cellM: number;
  windowM: number;
  voxelCount: number;
  setOpacity(opacity: number): void;
  dispose(): void;
}

interface DetailClipmapSet {
  patches: DetailPatch[];
  activeIndex: number;
  worldHash: string;
}

interface SurfaceEditSource {
  definition: {
    voxelEdgeM: number;
    verticalDatumM: number;
  };
  removedLevels(columnX: number, columnZ: number): Set<number> | undefined;
}

interface TerrainPerformanceSnapshot {
  fps: number;
  drawCalls: number;
  triangles: number;
  workerBuildMs: number;
  meshCacheEntries: number;
  residentBufferMB: number;
  meshCacheHitPercent: number;
  residentTiles: number;
  workerQueue: number;
}

interface TerrainOptions {
  holeBounds?: DemBounds;
  overlapCells?: number;
  yOffset?: number;
  detailedSides?: boolean;
  edgeFeatherCells?: number;
}

const BASE_ELEVATION_M = 0;
const CORE_BLOCK_SIZE = 0.235;
const WORLD_PER_ARC_SECOND = CORE_BLOCK_SIZE;
const VERTICAL_EXAGGERATION = 1;
const ORIGIN_LATITUDE = 27.9881;
const ORIGIN_LONGITUDE = 86.925;
const CANONICAL_ORIGIN_LATITUDE = 27.94236111111111;
const CANONICAL_ORIGIN_LONGITUDE = 86.89486111111111;
const METERS_PER_DEGREE_LATITUDE = 111_320;
const WORLD_UNITS_PER_METER = CORE_BLOCK_SIZE / 30;
const REPLAY_SECONDS = 21;
const ENDURANCE_SEGMENTS = 28;
const DETAIL_LODS = [
  {
    cellM: 15,
    gridCells: 257,
    label: "15 M",
  },
  {
    cellM: 6.4,
    gridCells: 161,
    label: "6.4 M",
  },
  {
    cellM: 3.2,
    gridCells: 129,
    label: "3.2 M",
  },
  {
    cellM: 1.6,
    gridCells: 129,
    label: "1.6 M",
  },
  {
    cellM: 0.8,
    gridCells: 129,
    label: "80 CM",
  },
  {
    cellM: 0.4,
    gridCells: 129,
    label: "40 CM",
  },
  {
    cellM: 0.2,
    gridCells: 129,
    label: "20 CM",
  },
] as const;
const OUTER_CLIPMAP_LOD = {
  cellM: 30,
  gridCells: 257,
} as const;
const EMPTY_MEMORIAL_CLUSTERS: MemorialCluster[] = [];
interface SurfaceDeltaLookup {
  chunks: Map<string, ObservatorySurfaceDeltaChunk>;
  removedByColumn: Map<string, Set<number>>;
}
const SURFACE_DELTA_INDEX = new WeakMap<
  ObservatoryFeed,
  SurfaceDeltaLookup
>();

function surfaceDeltaLookup(feed: ObservatoryFeed) {
  let lookup = SURFACE_DELTA_INDEX.get(feed);
  if (lookup) return lookup;
  const chunks = feed.surfaceDelta?.chunks ?? [];
  const removedByColumn = new Map<string, Set<number>>();
  chunks.forEach((chunk) => {
    chunk.removedTerrainVoxels.forEach((voxel) => {
      const key = `${voxel.x}:${voxel.z}`;
      let removedLevels = removedByColumn.get(key);
      if (!removedLevels) {
        removedLevels = new Set();
        removedByColumn.set(key, removedLevels);
      }
      removedLevels.add(voxel.y);
    });
  });
  lookup = {
    chunks: new Map(chunks.map((chunk) => [chunk.id, chunk])),
    removedByColumn,
  };
  SURFACE_DELTA_INDEX.set(feed, lookup);
  return lookup;
}

function surfaceDeltaChunksInBounds(
  feed: ObservatoryFeed,
  minimumX: number,
  maximumX: number,
  minimumZ: number,
  maximumZ: number,
) {
  const delta = feed.surfaceDelta;
  if (!delta) return [];
  const index = surfaceDeltaLookup(feed).chunks;
  const minimumChunkX = Math.floor(
    minimumX / delta.physicsChunkEdgeM,
  );
  const maximumChunkX = Math.floor(
    maximumX / delta.physicsChunkEdgeM,
  );
  const minimumChunkZ = Math.floor(
    minimumZ / delta.physicsChunkEdgeM,
  );
  const maximumChunkZ = Math.floor(
    maximumZ / delta.physicsChunkEdgeM,
  );
  const chunks: ObservatorySurfaceDeltaChunk[] = [];
  for (
    let chunkZ = minimumChunkZ;
    chunkZ <= maximumChunkZ;
    chunkZ += 1
  ) {
    for (
      let chunkX = minimumChunkX;
      chunkX <= maximumChunkX;
      chunkX += 1
    ) {
      const chunk = index.get(`${chunkX}:${chunkZ}`);
      if (chunk) chunks.push(chunk);
    }
  }
  return chunks;
}

type SkyPhase = "night" | "dawn" | "day" | "dusk";
type TerrainResolution =
  | "90 M"
  | "30 M"
  | (typeof DETAIL_LODS)[number]["label"];

type NavigationCommand =
  | {
      type: "focus";
      siteId: string;
      distanceM: number;
    }
  | {
      type: "nudge";
      forward: number;
      right: number;
    }
  | {
      type: "coordinates";
      x: number;
      z: number;
      distanceM: number;
    };

const TERRAIN_SCREEN_LODS = [
  { value: "20 CM", cellM: 0.2 },
  { value: "40 CM", cellM: 0.4 },
  { value: "80 CM", cellM: 0.8 },
  { value: "1.6 M", cellM: 1.6 },
  { value: "3.2 M", cellM: 3.2 },
  { value: "6.4 M", cellM: 6.4 },
  { value: "15 M", cellM: 15 },
  { value: "30 M", cellM: 30 },
  { value: "90 M", cellM: 90 },
] as const satisfies ReadonlyArray<{
  value: TerrainResolution;
  cellM: number;
}>;

const NAVIGATION_PRESETS = [
  {
    siteId: "everest-summit",
    label: "SUMMIT",
    distanceM: 760,
  },
  {
    siteId: "south-col",
    label: "SOUTH COL",
    distanceM: 920,
  },
  {
    siteId: "north-col",
    label: "NORTH COL",
    distanceM: 920,
  },
  {
    siteId: "south-base-camp",
    label: "BASE CAMP",
    distanceM: 1_150,
  },
] as const;

const SKY_PHASES: Record<
  SkyPhase,
  {
    fog: string;
    ground: string;
    exposure: number;
    terrainTint: string;
  }
> = {
  night: {
    fog: "#294454",
    ground: "#162329",
    exposure: 1.16,
    terrainTint: "#e6eeee",
  },
  dawn: {
    fog: "#2c4050",
    ground: "#151b1f",
    exposure: 1,
    terrainTint: "#eedfd2",
  },
  day: {
    fog: "#66869a",
    ground: "#273033",
    exposure: 0.98,
    terrainTint: "#fff4e7",
  },
  dusk: {
    fog: "#243a4a",
    ground: "#171c20",
    exposure: 0.98,
    terrainTint: "#dfcfc5",
  },
};

const MOUNTAIN_MATERIALS = {
  valleyRock: new THREE.Color("#343a3a"),
  weatheredGranite: new THREE.Color("#57534e"),
  summitGranite: new THREE.Color("#6c655e"),
  sedimentBand: new THREE.Color("#3b4141"),
  sunWarmedBand: new THREE.Color("#75695e"),
  blueIce: new THREE.Color("#8c9695"),
  snow: new THREE.Color("#d0d8d6"),
  placedGranite: "#8b8982",
  freshCut: "#786c62",
  summitSignal: "#ffc86b",
} as const;

const TERRAIN_COLOR_SCRATCH = new THREE.Color();
const ENDURANCE_COLORS = {
  healthy: new THREE.Color("#72e9ff"),
  warning: new THREE.Color("#ffc86b"),
  critical: new THREE.Color("#ff794d"),
} as const;

function kathmanduSkyPhase(date = new Date()): SkyPhase {
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const kathmanduHour = ((utcMinutes + 5 * 60 + 45) % (24 * 60)) / 60;
  if (kathmanduHour < 5.5 || kathmanduHour >= 19.25) return "night";
  if (kathmanduHour < 7.25) return "dawn";
  if (kathmanduHour < 16.75) return "day";
  return "dusk";
}

function hashNoise(x: number, z: number, seed = 0) {
  let value = Math.imul(x + seed * 1013, 374761393);
  value = Math.imul(value ^ Math.imul(z - seed * 733, 668265263), 1274126177);
  value ^= value >>> 13;
  return ((value >>> 0) % 10000) / 10000;
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = THREE.MathUtils.clamp(
    (value - edge0) / Math.max(0.0001, edge1 - edge0),
    0,
    1,
  );
  return t * t * (3 - 2 * t);
}

function terrainColor(
  elevationM: number,
  slopeDegrees: number,
  x: number,
  z: number,
  shade: number,
) {
  const broadStrata =
    Math.sin(x * 0.005 + z * 0.0025) * 0.55 +
    Math.sin(z * 0.004 - x * 0.0018) * 0.45;
  const sedimentAmount =
    smoothstep(0.58, 0.9, Math.abs(broadStrata)) *
    (1 - smoothstep(7_650, 8_400, elevationM)) *
    0.2;
  const altitudeRock = TERRAIN_COLOR_SCRATCH
    .copy(MOUNTAIN_MATERIALS.valleyRock)
    .lerp(
      MOUNTAIN_MATERIALS.weatheredGranite,
      smoothstep(4_900, 6_900, elevationM),
    )
    .lerp(
      MOUNTAIN_MATERIALS.summitGranite,
      smoothstep(7_200, 8_650, elevationM) * 0.42,
    )
    .lerp(MOUNTAIN_MATERIALS.sedimentBand, sedimentAmount)
    .lerp(
      MOUNTAIN_MATERIALS.sunWarmedBand,
      smoothstep(0.45, 0.95, broadStrata) *
        smoothstep(6_200, 8_100, elevationM) *
        0.13,
    );
  const localSnowLine = 6_050 + broadStrata * 95;
  const snowAltitude = smoothstep(localSnowLine, 7_900, elevationM);
  const snowRetention = 1 - smoothstep(34, 57, slopeDegrees);
  const snowAmount = THREE.MathUtils.clamp(
    snowAltitude * (0.25 + snowRetention * 0.58),
    0,
    0.84,
  );
  const iceAmount =
    smoothstep(5_900, 7_250, elevationM) *
    (1 - smoothstep(48, 63, slopeDegrees)) *
    (1 - snowAmount) *
    0.68;
  const color = altitudeRock
    .lerp(MOUNTAIN_MATERIALS.blueIce, iceAmount)
    .lerp(MOUNTAIN_MATERIALS.snow, snowAmount);
  const mineralVariation =
    (hashNoise(x, z, 19) - 0.5) * 0.026 + broadStrata * 0.009;
  color.offsetHSL(
    mineralVariation * 0.08,
    mineralVariation * 0.1,
    mineralVariation,
  );
  return color.multiplyScalar(shade);
}

function createVoxelTerrain(
  elevations: Int16Array,
  metadata: DemMetadata,
  options: TerrainOptions = {},
): VoxelTerrain {
  const { width, height } = metadata;
  const {
    holeBounds,
    overlapCells = 1.25,
    yOffset = 0,
    detailedSides = true,
    edgeFeatherCells = 0,
  } = options;
  const blockSize =
    metadata.sampleSpacingArcSeconds * WORLD_PER_ARC_SECOND;
  const verticalStepM =
    metadata.displayResolutionM / VERTICAL_EXAGGERATION;
  const degreesPerSample = metadata.sampleSpacingArcSeconds / 3600;
  const xOrigin =
    (metadata.bounds.west - ORIGIN_LONGITUDE) *
    3600 *
    WORLD_PER_ARC_SECOND;
  const zOrigin =
    (ORIGIN_LATITUDE - metadata.bounds.north) *
    3600 *
    WORLD_PER_ARC_SECOND;
  const levels = new Int16Array(elevations.length);
  const included = new Uint8Array(elevations.length);
  let peakIndex = 0;

  for (let index = 0; index < elevations.length; index += 1) {
    const row = Math.floor(index / width);
    const column = index % width;
    const latitude =
      metadata.bounds.north - (row + 0.5) * degreesPerSample;
    const longitude =
      metadata.bounds.west + (column + 0.5) * degreesPerSample;
    const insideHole =
      holeBounds &&
      latitude < holeBounds.north - overlapCells * degreesPerSample &&
      latitude > holeBounds.south + overlapCells * degreesPerSample &&
      longitude < holeBounds.east - overlapCells * degreesPerSample &&
      longitude > holeBounds.west + overlapCells * degreesPerSample;
    const edgeDistance = Math.min(
      row,
      column,
      height - 1 - row,
      width - 1 - column,
    );
    const featheredOut =
      edgeFeatherCells > 0 &&
      edgeDistance < edgeFeatherCells &&
      hashNoise(column, row, metadata.lod === "core" ? 211 : 307) >
        (edgeDistance + 0.5) / edgeFeatherCells;
    included[index] = insideHole || featheredOut ? 0 : 1;
    levels[index] = Math.max(
      0,
      Math.floor(
        (elevations[index] - BASE_ELEVATION_M) / verticalStepM,
      ),
    );
    if (elevations[index] > elevations[peakIndex]) peakIndex = index;
  }

  let faceCount = 0;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column;
      if (!included[index]) continue;
      faceCount += 1;
      const level = levels[index];
      if (column < width - 1 && included[index + 1]) {
        const difference = Math.max(0, level - levels[index + 1]);
        faceCount += detailedSides ? difference : Number(difference > 0);
      }
      if (column > 0 && included[index - 1]) {
        const difference = Math.max(0, level - levels[index - 1]);
        faceCount += detailedSides ? difference : Number(difference > 0);
      }
      if (row < height - 1 && included[index + width]) {
        const difference = Math.max(0, level - levels[index + width]);
        faceCount += detailedSides ? difference : Number(difference > 0);
      }
      if (row > 0 && included[index - width]) {
        const difference = Math.max(0, level - levels[index - width]);
        faceCount += detailedSides ? difference : Number(difference > 0);
      }
    }
  }

  const positions = new Float32Array(faceCount * 12);
  const colors = new Float32Array(faceCount * 12);
  const indices =
    faceCount * 4 > 65_535
      ? new Uint32Array(faceCount * 6)
      : new Uint16Array(faceCount * 6);
  let face = 0;

  const writeFace = (vertices: ArrayLike<number>, color: THREE.Color) => {
    const positionOffset = face * 12;
    positions.set(vertices, positionOffset);
    for (let vertex = 0; vertex < 4; vertex += 1) {
      const colorOffset = positionOffset + vertex * 3;
      colors[colorOffset] = color.r;
      colors[colorOffset + 1] = color.g;
      colors[colorOffset + 2] = color.b;
    }
    const vertexOffset = face * 4;
    const indexOffset = face * 6;
    indices[indexOffset] = vertexOffset;
    indices[indexOffset + 1] = vertexOffset + 1;
    indices[indexOffset + 2] = vertexOffset + 2;
    indices[indexOffset + 3] = vertexOffset;
    indices[indexOffset + 4] = vertexOffset + 2;
    indices[indexOffset + 5] = vertexOffset + 3;
    face += 1;
  };

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column;
      if (!included[index]) continue;
      const level = levels[index];
      const x0 = xOrigin + column * blockSize;
      const x1 = x0 + blockSize;
      const z0 = zOrigin + row * blockSize;
      const z1 = z0 + blockSize;
      const yTop = (level + 1) * blockSize + yOffset;
      const elevationM = elevations[index];
      const noiseColumn = Math.round(
        (metadata.bounds.west + column * degreesPerSample) * 3600,
      );
      const noiseRow = Math.round(
        (metadata.bounds.north - row * degreesPerSample) * 3600,
      );
      const leftElevation =
        elevations[row * width + Math.max(0, column - 1)];
      const rightElevation =
        elevations[row * width + Math.min(width - 1, column + 1)];
      const northElevation =
        elevations[Math.max(0, row - 1) * width + column];
      const southElevation =
        elevations[Math.min(height - 1, row + 1) * width + column];
      const gradientX =
        (rightElevation - leftElevation) /
        Math.max(1, metadata.displayResolutionM * 2);
      const gradientZ =
        (southElevation - northElevation) /
        Math.max(1, metadata.displayResolutionM * 2);
      const slopeDegrees =
        (Math.atan(Math.hypot(gradientX, gradientZ)) * 180) / Math.PI;
      const normalLength = Math.hypot(gradientX, 1, gradientZ);
      const sunDot = THREE.MathUtils.clamp(
        (-gradientX * -0.38 + 0.86 + -gradientZ * -0.34) /
          normalLength,
        0,
        1,
      );
      const topShade = 0.76 + sunDot * 0.24;

      writeFace(
        [x0, yTop, z0, x0, yTop, z1, x1, yTop, z1, x1, yTop, z0],
        terrainColor(
          elevationM,
          slopeDegrees,
          noiseColumn,
          noiseRow,
          topShade,
        ),
      );

      const sides = [
        {
          neighborIndex: column < width - 1 ? index + 1 : -1,
          shade: 0.72,
          vertices: (y0: number, y1: number) =>
            [x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1] as const,
        },
        {
          neighborIndex: column > 0 ? index - 1 : -1,
          shade: 0.56,
          vertices: (y0: number, y1: number) =>
            [x0, y0, z1, x0, y1, z1, x0, y1, z0, x0, y0, z0] as const,
        },
        {
          neighborIndex: row < height - 1 ? index + width : -1,
          shade: 0.64,
          vertices: (y0: number, y1: number) =>
            [x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1] as const,
        },
        {
          neighborIndex: row > 0 ? index - width : -1,
          shade: 0.48,
          vertices: (y0: number, y1: number) =>
            [x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0] as const,
        },
      ];

      for (const side of sides) {
        if (
          side.neighborIndex < 0 ||
          !included[side.neighborIndex] ||
          levels[side.neighborIndex] >= level
        ) {
          continue;
        }
        const neighborLevel = levels[side.neighborIndex];
        if (detailedSides) {
          for (let layer = neighborLevel + 1; layer <= level; layer += 1) {
            const y0 = layer * blockSize + yOffset;
            const y1 = (layer + 1) * blockSize + yOffset;
            writeFace(
              side.vertices(y0, y1),
              terrainColor(
                elevationM,
                slopeDegrees,
                noiseColumn,
                noiseRow,
                side.shade,
              ),
            );
          }
        } else {
          const y0 = (neighborLevel + 1) * blockSize + yOffset;
          writeFace(
            side.vertices(y0, yTop),
            terrainColor(
              elevationM,
              slopeDegrees,
              noiseColumn,
              noiseRow,
              side.shade,
            ),
          );
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      fog: true,
    }),
  );

  return {
    mesh,
    levels,
    width,
    height,
    blockSize,
    baseElevationM: BASE_ELEVATION_M,
    verticalStepM,
    peakColumn: peakIndex % width,
    peakRow: Math.floor(peakIndex / width),
    xOrigin,
    zOrigin,
  };
}

function sampleDemElevation(
  elevations: Int16Array,
  width: number,
  height: number,
  column: number,
  row: number,
) {
  const safeColumn = THREE.MathUtils.clamp(column, 0, width - 1);
  const safeRow = THREE.MathUtils.clamp(row, 0, height - 1);
  const column0 = Math.floor(safeColumn);
  const row0 = Math.floor(safeRow);
  const column1 = Math.min(width - 1, column0 + 1);
  const row1 = Math.min(height - 1, row0 + 1);
  const tx = safeColumn - column0;
  const tz = safeRow - row0;
  const north =
    elevations[row0 * width + column0] * (1 - tx) +
    elevations[row0 * width + column1] * tx;
  const south =
    elevations[row1 * width + column0] * (1 - tx) +
    elevations[row1 * width + column1] * tx;
  return north * (1 - tz) + south * tz;
}

function yieldDetailBuild() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

// Retained as a source-compatible fallback while the new Worker path rolls
// out; production clipmaps are created by TerrainStreamingEngine.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function createDetailPatch(
  key: string,
  core: DemLayer,
  terrain: VoxelTerrain,
  centerWorldX: number,
  centerWorldZ: number,
  cellM: number,
  gridCells: number,
  innerHoleM: number,
  terrainTint: string,
  feed: ObservatoryFeed,
): Promise<DetailPatch> {
  const { metadata, elevations } = core;
  const degreesPerSample = metadata.sampleSpacingArcSeconds / 3600;
  const centerColumn = THREE.MathUtils.clamp(
    (centerWorldX - terrain.xOrigin) / terrain.blockSize - 0.5,
    1,
    metadata.width - 2,
  );
  const centerRow = THREE.MathUtils.clamp(
    (centerWorldZ - terrain.zOrigin) / terrain.blockSize - 0.5,
    1,
    metadata.height - 2,
  );
  const centerLatitude =
    metadata.bounds.north - (centerRow + 0.5) * degreesPerSample;
  const centerLongitude =
    metadata.bounds.west + (centerColumn + 0.5) * degreesPerSample;
  const latitudeRadians =
    (centerLatitude * Math.PI) / 180;
  const sampleWidthM =
    degreesPerSample *
    METERS_PER_DEGREE_LATITUDE *
    Math.cos(latitudeRadians);
  const sampleHeightM =
    degreesPerSample * METERS_PER_DEGREE_LATITUDE;
  const metersPerDegreeLongitude =
    METERS_PER_DEGREE_LATITUDE *
    Math.cos(
      (CANONICAL_ORIGIN_LATITUDE * Math.PI) / 180,
    );
  const centerCanonicalX =
    (centerLongitude - CANONICAL_ORIGIN_LONGITUDE) *
    metersPerDegreeLongitude;
  const centerCanonicalZ =
    (CANONICAL_ORIGIN_LATITUDE - centerLatitude) *
    METERS_PER_DEGREE_LATITUDE;
  const halfWindowM = (gridCells * cellM) / 2;
  const deltaChunks = surfaceDeltaChunksInBounds(
    feed,
    centerCanonicalX - halfWindowM,
    centerCanonicalX + halfWindowM,
    centerCanonicalZ - halfWindowM,
    centerCanonicalZ + halfWindowM,
  );
  const deltaVoxelEdgeM =
    feed.surfaceDelta?.voxelEdgeM ?? 0.2;
  const exactDeltaResolution =
    Math.abs(cellM - deltaVoxelEdgeM) < 0.0001;
  const removedByColumn = feed.surfaceDelta
    ? surfaceDeltaLookup(feed).removedByColumn
    : new Map<string, Set<number>>();
  const hasLocalRemovedTerrain = deltaChunks.some(
    (chunk) => chunk.removedTerrainVoxels.length > 0,
  );
  const verticalDatumVoxels = Math.round(
    (feed.surfaceDelta?.verticalDatumM ?? 5_259) /
      deltaVoxelEdgeM,
  );
  const centerElevationM = sampleDemElevation(
    elevations,
    metadata.width,
    metadata.height,
    centerColumn,
    centerRow,
  );
  const centerTopVoxel = Math.floor(
    (centerElevationM +
      syntheticReliefM(centerCanonicalX, centerCanonicalZ)) /
      cellM,
  );
  const halfGrid = Math.floor(gridCells / 2);
  const topLevels = new Int16Array(
    gridCells * gridCells,
  );
  const reliefValues = new Float32Array(topLevels.length);
  const elevationValues = new Float32Array(topLevels.length);

  for (let row = 0; row < gridCells; row += 1) {
    for (let column = 0; column < gridCells; column += 1) {
      const index = row * gridCells + column;
      const localXM = (column - halfGrid) * cellM;
      const localZM = (row - halfGrid) * cellM;
      const canonicalX = centerCanonicalX + localXM;
      const canonicalZ = centerCanonicalZ + localZM;
      const elevationM = sampleDemElevation(
        elevations,
        metadata.width,
        metadata.height,
        centerColumn + localXM / sampleWidthM,
        centerRow + localZM / sampleHeightM,
      );
      const reliefM = syntheticReliefM(canonicalX, canonicalZ);
      let absoluteTopVoxel = Math.floor(
        (elevationM + reliefM) / cellM,
      );
      if (hasLocalRemovedTerrain) {
        const columnX = Math.floor(
          canonicalX / deltaVoxelEdgeM,
        );
        const columnZ = Math.floor(
          canonicalZ / deltaVoxelEdgeM,
        );
        const removedLevels = removedByColumn.get(
          `${columnX}:${columnZ}`,
        );
        if (removedLevels) {
          let fineAbsoluteTopVoxel = Math.floor(
            (elevationM + reliefM) / deltaVoxelEdgeM,
          );
          let localTopVoxel =
            fineAbsoluteTopVoxel - verticalDatumVoxels;
          while (removedLevels.has(localTopVoxel)) {
            localTopVoxel -= 1;
          }
          fineAbsoluteTopVoxel =
            localTopVoxel + verticalDatumVoxels;
          const editedSurfaceTopM =
            (fineAbsoluteTopVoxel + 1) * deltaVoxelEdgeM;
          absoluteTopVoxel =
            Math.ceil(editedSurfaceTopM / cellM) - 1;
        }
      }
      const level = absoluteTopVoxel - centerTopVoxel;
      topLevels[index] = level;
      reliefValues[index] = reliefM;
      elevationValues[index] = elevationM;
    }
    if (row % 24 === 23) await yieldDetailBuild();
  }

  const group = new THREE.Group();
  const detailTint = new THREE.Color(terrainTint);
  const cellWorld = cellM * WORLD_UNITS_PER_METER;
  const included = new Uint8Array(topLevels.length);
  let renderedTopCount = 0;

  const elevationAt = (
    column: number,
    row: number,
    fallback: number,
  ) => {
    if (
      column < 0 ||
      row < 0 ||
      column >= gridCells ||
      row >= gridCells
    ) {
      return fallback;
    }
    return elevationValues[row * gridCells + column];
  };

  for (let row = 0; row < gridCells; row += 1) {
    for (let column = 0; column < gridCells; column += 1) {
      const index = row * gridCells + column;
      const localXM = (column - halfGrid) * cellM;
      const localZM = (row - halfGrid) * cellM;
      const insideInnerHole =
        innerHoleM > 0 &&
        Math.abs(localXM) <
          innerHoleM / 2 - cellM * 0.35 &&
        Math.abs(localZM) <
          innerHoleM / 2 - cellM * 0.35;
      if (!insideInnerHole) {
        included[index] = 1;
        renderedTopCount += 1;
      }
    }
    if (row % 24 === 23) await yieldDetailBuild();
  }

  let faceCount = renderedTopCount;
  for (let row = 0; row < gridCells; row += 1) {
    for (let column = 0; column < gridCells; column += 1) {
      const index = row * gridCells + column;
      if (!included[index]) continue;
      const topLevel = topLevels[index];
      // The neighboring clipmap ring supplies the surface outside this
      // patch. Never generate an outer skirt: it becomes a giant hanging wall
      // whenever the camera reaches the patch edge on a steep summit view.
      if (
        column + 1 < gridCells &&
        included[index + 1] &&
        topLevels[index + 1] < topLevel
      ) {
        faceCount += 1;
      }
      if (
        column > 0 &&
        included[index - 1] &&
        topLevels[index - 1] < topLevel
      ) {
        faceCount += 1;
      }
      if (
        row + 1 < gridCells &&
        included[index + gridCells] &&
        topLevels[index + gridCells] < topLevel
      ) {
        faceCount += 1;
      }
      if (
        row > 0 &&
        included[index - gridCells] &&
        topLevels[index - gridCells] < topLevel
      ) {
        faceCount += 1;
      }
    }
    if (row % 24 === 23) await yieldDetailBuild();
  }

  const positions = new Float32Array(faceCount * 12);
  const colors = new Float32Array(faceCount * 12);
  const indices =
    faceCount * 4 > 65_535
      ? new Uint32Array(faceCount * 6)
      : new Uint16Array(faceCount * 6);
  let face = 0;

  const writeFace = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    dx: number,
    dy: number,
    dz: number,
    color: THREE.Color,
  ) => {
    const positionOffset = face * 12;
    positions[positionOffset] = ax;
    positions[positionOffset + 1] = ay;
    positions[positionOffset + 2] = az;
    positions[positionOffset + 3] = bx;
    positions[positionOffset + 4] = by;
    positions[positionOffset + 5] = bz;
    positions[positionOffset + 6] = cx;
    positions[positionOffset + 7] = cy;
    positions[positionOffset + 8] = cz;
    positions[positionOffset + 9] = dx;
    positions[positionOffset + 10] = dy;
    positions[positionOffset + 11] = dz;
    for (let vertex = 0; vertex < 4; vertex += 1) {
      const colorOffset = positionOffset + vertex * 3;
      colors[colorOffset] = color.r;
      colors[colorOffset + 1] = color.g;
      colors[colorOffset + 2] = color.b;
    }
    const vertexOffset = face * 4;
    const indexOffset = face * 6;
    indices[indexOffset] = vertexOffset;
    indices[indexOffset + 1] = vertexOffset + 1;
    indices[indexOffset + 2] = vertexOffset + 2;
    indices[indexOffset + 3] = vertexOffset;
    indices[indexOffset + 4] = vertexOffset + 2;
    indices[indexOffset + 5] = vertexOffset + 3;
    face += 1;
  };

  const slopeSampleOffset = Math.max(
    1,
    Math.round(30 / cellM),
  );
  for (let row = 0; row < gridCells; row += 1) {
    for (let column = 0; column < gridCells; column += 1) {
      const index = row * gridCells + column;
      if (!included[index]) continue;
      const localXM = (column - halfGrid) * cellM;
      const localZM = (row - halfGrid) * cellM;
      const worldX =
        centerWorldX + localXM * WORLD_UNITS_PER_METER;
      const worldZ =
        centerWorldZ + localZM * WORLD_UNITS_PER_METER;
      const topLevel = topLevels[index];
      const surfaceElevationM =
        elevationValues[index] + reliefValues[index];

      const gradientX =
        (elevationAt(
          column + slopeSampleOffset,
          row,
          elevationValues[index],
        ) -
          elevationAt(
            column - slopeSampleOffset,
            row,
            elevationValues[index],
          )) /
        (2 * slopeSampleOffset * cellM);
      const gradientZ =
        (elevationAt(
          column,
          row + slopeSampleOffset,
          elevationValues[index],
        ) -
          elevationAt(
            column,
            row - slopeSampleOffset,
            elevationValues[index],
          )) /
        (2 * slopeSampleOffset * cellM);
      const slopeDegrees =
        (Math.atan(Math.hypot(gradientX, gradientZ)) * 180) /
        Math.PI;
      const normalLength = Math.hypot(
        gradientX,
        1,
        gradientZ,
      );
      const sunDot = THREE.MathUtils.clamp(
        (-gradientX * -0.38 +
          0.86 +
          -gradientZ * -0.34) /
          normalLength,
        0,
        1,
      );
      const topShade = 0.76 + sunDot * 0.24;
      const sampleLongitude =
        centerLongitude +
        localXM / metersPerDegreeLongitude;
      const sampleLatitude =
        centerLatitude -
        localZM / METERS_PER_DEGREE_LATITUDE;
      const noiseColumn = Math.round(sampleLongitude * 3600);
      const noiseRow = Math.round(sampleLatitude * 3600);
      const x0 = worldX - cellWorld / 2;
      const x1 = worldX + cellWorld / 2;
      const z0 = worldZ - cellWorld / 2;
      const z1 = worldZ + cellWorld / 2;
      const yTop =
        (centerTopVoxel + topLevel + 1) * cellWorld;
      const topColor = terrainColor(
        surfaceElevationM,
        slopeDegrees,
        noiseColumn,
        noiseRow,
        topShade,
      ).multiply(detailTint);
      const topRed = topColor.r;
      const topGreen = topColor.g;
      const topBlue = topColor.b;
      writeFace(
        x0, yTop, z0,
        x0, yTop, z1,
        x1, yTop, z1,
        x1, yTop, z0,
        topColor,
      );

      if (
        column + 1 < gridCells &&
        included[index + 1] &&
        topLevels[index + 1] < topLevel
      ) {
        const yBottom =
          (centerTopVoxel + topLevels[index + 1] + 1) *
          cellWorld;
        writeFace(
          x1, yBottom, z0,
          x1, yTop, z0,
          x1, yTop, z1,
          x1, yBottom, z1,
          TERRAIN_COLOR_SCRATCH.setRGB(
            (topRed * 0.72) / topShade,
            (topGreen * 0.72) / topShade,
            (topBlue * 0.72) / topShade,
          ),
        );
      }
      if (
        column > 0 &&
        included[index - 1] &&
        topLevels[index - 1] < topLevel
      ) {
        const yBottom =
          (centerTopVoxel + topLevels[index - 1] + 1) *
          cellWorld;
        writeFace(
          x0, yBottom, z1,
          x0, yTop, z1,
          x0, yTop, z0,
          x0, yBottom, z0,
          TERRAIN_COLOR_SCRATCH.setRGB(
            (topRed * 0.56) / topShade,
            (topGreen * 0.56) / topShade,
            (topBlue * 0.56) / topShade,
          ),
        );
      }
      if (
        row + 1 < gridCells &&
        included[index + gridCells] &&
        topLevels[index + gridCells] < topLevel
      ) {
        const yBottom =
          (centerTopVoxel +
            topLevels[index + gridCells] +
            1) *
          cellWorld;
        writeFace(
          x0, yBottom, z1,
          x1, yBottom, z1,
          x1, yTop, z1,
          x0, yTop, z1,
          TERRAIN_COLOR_SCRATCH.setRGB(
            (topRed * 0.64) / topShade,
            (topGreen * 0.64) / topShade,
            (topBlue * 0.64) / topShade,
          ),
        );
      }
      if (
        row > 0 &&
        included[index - gridCells] &&
        topLevels[index - gridCells] < topLevel
      ) {
        const yBottom =
          (centerTopVoxel +
            topLevels[index - gridCells] +
            1) *
          cellWorld;
        writeFace(
          x1, yBottom, z0,
          x0, yBottom, z0,
          x0, yTop, z0,
          x1, yTop, z0,
          TERRAIN_COLOR_SCRATCH.setRGB(
            (topRed * 0.48) / topShade,
            (topGreen * 0.48) / topShade,
            (topBlue * 0.48) / topShade,
          ),
        );
      }
    }
    if (row % 16 === 15) await yieldDetailBuild();
  }

  const surfaceGeometry = new THREE.BufferGeometry();
  surfaceGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3),
  );
  surfaceGeometry.setAttribute(
    "color",
    new THREE.BufferAttribute(colors, 3),
  );
  surfaceGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
  surfaceGeometry.computeBoundingSphere();
  const surfaceMesh = new THREE.Mesh(
    surfaceGeometry,
    new THREE.MeshBasicMaterial({
      color: "#ffffff",
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: true,
    }),
  );
  group.add(surfaceMesh);
  const surfaceMeshes = [surfaceMesh];

  let stoneVoxelCount = 0;
  const renderSurfaceStones =
    (feed.surfaceDelta && cellM <= 1.6) ||
    exactDeltaResolution;
  if (renderSurfaceStones) {
    const deltaStones = deltaChunks.flatMap(
      (chunk) => chunk.stones,
    );
    const fallbackPoint = feed.currentHighestPoint;
    const stones =
      deltaStones.length > 0
        ? deltaStones
        : fallbackPoint?.kind === "STONE" &&
            typeof fallbackPoint.x === "number" &&
            typeof fallbackPoint.y === "number" &&
            typeof fallbackPoint.z === "number"
          ? [
              {
                id: fallbackPoint.id,
                cell: {
                  x: Math.floor(fallbackPoint.x / deltaVoxelEdgeM),
                  y: Math.floor(
                    (fallbackPoint.y - deltaVoxelEdgeM / 2) /
                      deltaVoxelEdgeM,
                  ),
                  z: Math.floor(fallbackPoint.z / deltaVoxelEdgeM),
                },
              },
            ]
          : [];
    const visibleStones = stones.filter(({ cell }) => {
      const x = (cell.x + 0.5) * deltaVoxelEdgeM;
      const z = (cell.z + 0.5) * deltaVoxelEdgeM;
      return (
        Math.abs(x - centerCanonicalX) <
          halfWindowM - deltaVoxelEdgeM &&
        Math.abs(z - centerCanonicalZ) <
          halfWindowM - deltaVoxelEdgeM
      );
    });
    if (visibleStones.length > 0) {
      const stoneWorld =
        deltaVoxelEdgeM * WORLD_UNITS_PER_METER;
      const stoneGeometry = new THREE.BoxGeometry(
        stoneWorld,
        stoneWorld,
        stoneWorld,
      );
      const stoneMaterial = new THREE.MeshLambertMaterial({
        color: MOUNTAIN_MATERIALS.placedGranite,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const stoneMesh = new THREE.InstancedMesh(
        stoneGeometry,
        stoneMaterial,
        visibleStones.length,
      );
      const stoneTransform = new THREE.Object3D();
      visibleStones.forEach(({ cell }, index) => {
        const x = (cell.x + 0.5) * deltaVoxelEdgeM;
        const y = (cell.y + 0.5) * deltaVoxelEdgeM;
        const z = (cell.z + 0.5) * deltaVoxelEdgeM;
        stoneTransform.position.set(
          centerWorldX +
            (x - centerCanonicalX) * WORLD_UNITS_PER_METER,
          (y +
            (feed.surfaceDelta?.verticalDatumM ?? 5_259)) *
            WORLD_UNITS_PER_METER,
          centerWorldZ +
            (z - centerCanonicalZ) * WORLD_UNITS_PER_METER,
        );
        stoneTransform.quaternion.identity();
        stoneTransform.updateMatrix();
        stoneMesh.setMatrixAt(index, stoneTransform.matrix);
      });
      stoneMesh.instanceMatrix.needsUpdate = true;
      group.add(stoneMesh);
      stoneVoxelCount = visibleStones.length;
    }
  }

  return {
    key,
    group,
    cellM,
    windowM: gridCells * cellM,
    voxelCount: renderedTopCount + stoneVoxelCount,
    setOpacity(opacity: number) {
      const safeOpacity = THREE.MathUtils.clamp(opacity, 0, 1);
      group.visible = safeOpacity > 0.01;
      group.traverse((object) => {
        if (
          object instanceof THREE.Mesh ||
          object instanceof THREE.LineSegments
        ) {
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((material) => {
            material.opacity = safeOpacity;
            material.transparent = true;
            material.depthWrite = safeOpacity > 0.72;
          });
        }
      });
    },
    dispose() {
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      group.traverse((object) => {
        if (
          object instanceof THREE.Mesh ||
          object instanceof THREE.LineSegments
        ) {
          geometries.add(object.geometry);
          const objectMaterials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          objectMaterials.forEach((material) => materials.add(material));
        }
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      surfaceMeshes.length = 0;
    },
  };
}

function cellSizeForResolution(resolution: TerrainResolution) {
  if (resolution === "90 M") return 90;
  if (resolution === "30 M") return 30;
  return (
    DETAIL_LODS.find((lod) => lod.label === resolution)?.cellM ??
    30
  );
}

function snapDetailCenterToCanonicalGrid(
  core: DemLayer,
  terrain: VoxelTerrain,
  worldX: number,
  worldZ: number,
  cellM: number,
) {
  const { metadata } = core;
  const degreesPerSample =
    metadata.sampleSpacingArcSeconds / 3600;
  const column = THREE.MathUtils.clamp(
    (worldX - terrain.xOrigin) / terrain.blockSize - 0.5,
    1,
    metadata.width - 2,
  );
  const row = THREE.MathUtils.clamp(
    (worldZ - terrain.zOrigin) / terrain.blockSize - 0.5,
    1,
    metadata.height - 2,
  );
  const latitude =
    metadata.bounds.north - (row + 0.5) * degreesPerSample;
  const longitude =
    metadata.bounds.west + (column + 0.5) * degreesPerSample;
  const latitudeRadians = (latitude * Math.PI) / 180;
  const sampleWidthM =
    degreesPerSample *
    METERS_PER_DEGREE_LATITUDE *
    Math.cos(latitudeRadians);
  const sampleHeightM =
    degreesPerSample * METERS_PER_DEGREE_LATITUDE;
  const metersPerDegreeLongitude =
    METERS_PER_DEGREE_LATITUDE *
    Math.cos(
      (CANONICAL_ORIGIN_LATITUDE * Math.PI) / 180,
    );
  const canonicalX =
    (longitude - CANONICAL_ORIGIN_LONGITUDE) *
    metersPerDegreeLongitude;
  const canonicalZ =
    (CANONICAL_ORIGIN_LATITUDE - latitude) *
    METERS_PER_DEGREE_LATITUDE;
  const snappedCanonicalX =
    (Math.floor(canonicalX / cellM) + 0.5) * cellM;
  const snappedCanonicalZ =
    (Math.floor(canonicalZ / cellM) + 0.5) * cellM;
  return new THREE.Vector2(
    worldX +
      ((snappedCanonicalX - canonicalX) / sampleWidthM) *
        terrain.blockSize,
    worldZ +
      ((snappedCanonicalZ - canonicalZ) / sampleHeightM) *
        terrain.blockSize,
  );
}

function detailedSurfaceY(
  core: DemLayer,
  terrain: VoxelTerrain,
  worldX: number,
  worldZ: number,
  renderedCellM = 0,
  surfaceEdits?: SurfaceEditSource,
) {
  const { metadata, elevations } = core;
  const degreesPerSample = metadata.sampleSpacingArcSeconds / 3600;
  const column = THREE.MathUtils.clamp(
    (worldX - terrain.xOrigin) / terrain.blockSize - 0.5,
    1,
    metadata.width - 2,
  );
  const row = THREE.MathUtils.clamp(
    (worldZ - terrain.zOrigin) / terrain.blockSize - 0.5,
    1,
    metadata.height - 2,
  );
  const latitude =
    metadata.bounds.north - (row + 0.5) * degreesPerSample;
  const longitude =
    metadata.bounds.west + (column + 0.5) * degreesPerSample;
  const metersPerDegreeLongitude =
    METERS_PER_DEGREE_LATITUDE *
    Math.cos(
      (CANONICAL_ORIGIN_LATITUDE * Math.PI) / 180,
    );
  const canonicalX =
    (longitude - CANONICAL_ORIGIN_LONGITUDE) *
    metersPerDegreeLongitude;
  const canonicalZ =
    (CANONICAL_ORIGIN_LATITUDE - latitude) *
    METERS_PER_DEGREE_LATITUDE;
  const elevationM = sampleDemElevation(
    elevations,
    metadata.width,
    metadata.height,
    column,
    row,
  );
  const naturalizedElevationM =
    elevationM + syntheticReliefM(canonicalX, canonicalZ);
  // Detail patches render the top of floor(height / cell) + 1. Collision
  // must use that same quantized authority; the continuous DEM surface can
  // otherwise sit almost one full voxel below what is actually visible.
  let renderedElevationM = naturalizedElevationM;
  if (renderedCellM > 0 && renderedCellM <= 15) {
    let topVoxel = Math.floor(
      naturalizedElevationM / renderedCellM,
    );
    if (surfaceEdits) {
      const delta = surfaceEdits.definition;
      const columnX = Math.floor(
        canonicalX / delta.voxelEdgeM,
      );
      const columnZ = Math.floor(
        canonicalZ / delta.voxelEdgeM,
      );
      const removedLevels = surfaceEdits.removedLevels(columnX, columnZ);
      let fineAbsoluteTopVoxel = Math.floor(
        naturalizedElevationM / delta.voxelEdgeM,
      );
      let localTopVoxel =
        fineAbsoluteTopVoxel -
        Math.round(delta.verticalDatumM / delta.voxelEdgeM);
      while (removedLevels?.has(localTopVoxel)) {
        localTopVoxel -= 1;
      }
      fineAbsoluteTopVoxel =
        localTopVoxel +
        Math.round(delta.verticalDatumM / delta.voxelEdgeM);
      const editedSurfaceTopM =
        (fineAbsoluteTopVoxel + 1) * delta.voxelEdgeM;
      topVoxel =
        Math.ceil(editedSurfaceTopM / renderedCellM) - 1;
    }
    renderedElevationM = (topVoxel + 1) * renderedCellM;
  }
  return (
    renderedElevationM * WORLD_UNITS_PER_METER
  );
}

function gridPoint(
  terrain: VoxelTerrain,
  column: number,
  row: number,
  lift = 0.08,
) {
  const safeColumn = THREE.MathUtils.clamp(
    Math.round(column),
    0,
    terrain.width - 1,
  );
  const safeRow = THREE.MathUtils.clamp(
    Math.round(row),
    0,
    terrain.height - 1,
  );
  const level = terrain.levels[safeRow * terrain.width + safeColumn];
  return new THREE.Vector3(
    terrain.xOrigin + (safeColumn + 0.5) * terrain.blockSize,
    (level + 1 + lift) * terrain.blockSize,
    terrain.zOrigin + (safeRow + 0.5) * terrain.blockSize,
  );
}

function containsCoordinate(
  bounds: DemBounds,
  latitude: number,
  longitude: number,
) {
  return (
    latitude <= bounds.north &&
    latitude >= bounds.south &&
    longitude >= bounds.west &&
    longitude <= bounds.east
  );
}

function coordinatePoint(
  terrain: VoxelTerrain,
  metadata: DemMetadata,
  latitude: number,
  longitude: number,
) {
  const degrees = metadata.sampleSpacingArcSeconds / 3600;
  return gridPoint(
    terrain,
    (longitude - metadata.bounds.west) / degrees - 0.5,
    (metadata.bounds.north - latitude) / degrees - 0.5,
    0.5,
  );
}

function sitePriority(site: SiteAnchor) {
  if (site.kind === "SUMMIT") return 3;
  if (site.kind === "BASE") return 3;
  if (site.id.endsWith("base-camp")) return 2;
  if (site.id.includes("col")) return 2;
  return 1;
}

function createSiteLabel(site: SiteAnchor) {
  const element = document.createElement("div");
  element.className = `site-marker site-marker-${site.kind.toLowerCase()}`;
  element.dataset.priority = String(sitePriority(site));
  element.innerHTML = `
    <span class="site-marker-beacon" aria-hidden="true"></span>
    <span class="site-marker-copy">
      <strong>${site.name}</strong>
      <small>${site.side === "BOTH" ? "SUMMIT" : `${site.side} FACE`}</small>
    </span>
  `;
  return element;
}

function createRoute(
  terrain: VoxelTerrain,
  terrainMetadata: DemMetadata,
  suppliedTrace?: Array<{ column: number; row: number }> | null,
  suppliedTraceMetadata?: DemMetadata,
) {
  if (
    suppliedTrace &&
    suppliedTrace.length >= 2 &&
    suppliedTraceMetadata
  ) {
    const traceDegrees =
      suppliedTraceMetadata.sampleSpacingArcSeconds / 3600;
    return suppliedTrace.map((point) => {
      const latitude =
        suppliedTraceMetadata.bounds.north -
        (point.row + 0.5) * traceDegrees;
      const longitude =
        suppliedTraceMetadata.bounds.west +
        (point.column + 0.5) * traceDegrees;
      return coordinatePoint(
        terrain,
        terrainMetadata,
        latitude,
        longitude,
      );
    });
  }
  return [];
}

function canonicalCoordinatePoint(
  activity: DemLayer,
  activityTerrain: VoxelTerrain,
  x: number,
  z: number,
) {
  const metersPerDegreeLongitude =
    METERS_PER_DEGREE_LATITUDE *
    Math.cos((CANONICAL_ORIGIN_LATITUDE * Math.PI) / 180);
  const latitude =
    CANONICAL_ORIGIN_LATITUDE - z / METERS_PER_DEGREE_LATITUDE;
  const longitude =
    CANONICAL_ORIGIN_LONGITUDE + x / metersPerDegreeLongitude;
  if (
    containsCoordinate(
      activity.metadata.bounds,
      latitude,
      longitude,
    )
  ) {
    return coordinatePoint(
      activityTerrain,
      activity.metadata,
      latitude,
      longitude,
    );
  }
  return null;
}

function positiveModulo(value: number, modulus: number) {
  return ((value % modulus) + modulus) % modulus;
}

function replayPhase(rawPhase: number, actionFraction: number) {
  const startHold = 0.045;
  const endHold = 0.92;
  const actionStart =
    startHold +
    THREE.MathUtils.clamp(actionFraction, 0.08, 0.92) *
      (endHold - startHold - 0.075);
  const actionEnd = actionStart + 0.075;
  if (rawPhase <= startHold) return 0;
  if (rawPhase >= endHold) return 1;
  if (rawPhase < actionStart) {
    return (
      ((rawPhase - startHold) / Math.max(0.001, actionStart - startHold)) *
      actionFraction
    );
  }
  if (rawPhase <= actionEnd) return actionFraction;
  return (
    actionFraction +
    ((rawPhase - actionEnd) / Math.max(0.001, endHold - actionEnd)) *
      (1 - actionFraction)
  );
}

function createVoxelClimber(color: string) {
  const group = new THREE.Group();
  const jacketMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
  });
  const darkMaterial = new THREE.MeshBasicMaterial({
    color: "#17242a",
    transparent: true,
  });
  const skinMaterial = new THREE.MeshBasicMaterial({
    color: "#d8b18a",
    transparent: true,
  });
  const packMaterial = new THREE.MeshBasicMaterial({
    color: "#20323f",
    transparent: true,
  });
  const materials = [
    jacketMaterial,
    darkMaterial,
    skinMaterial,
    packMaterial,
  ];

  const addBox = (
    size: [number, number, number],
    position: [number, number, number],
    material: THREE.MeshBasicMaterial,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    group.add(mesh);
    return mesh;
  };

  addBox([0.3, 0.36, 0.2], [0, 0.46, 0], jacketMaterial);
  addBox([0.24, 0.24, 0.22], [0, 0.76, 0], skinMaterial);
  addBox([0.27, 0.1, 0.24], [0, 0.88, 0], jacketMaterial);
  addBox([0.27, 0.32, 0.16], [0, 0.48, -0.18], darkMaterial);
  const leftLeg = addBox(
    [0.1, 0.3, 0.11],
    [-0.09, 0.18, 0],
    darkMaterial,
  );
  const rightLeg = addBox(
    [0.1, 0.3, 0.11],
    [0.09, 0.18, 0],
    darkMaterial,
  );
  addBox([0.09, 0.3, 0.1], [-0.21, 0.46, 0], jacketMaterial);
  addBox([0.09, 0.3, 0.1], [0.21, 0.46, 0], jacketMaterial);
  addBox([0.27, 0.3, 0.13], [0, 0.49, -0.19], packMaterial);

  return {
    group,
    materials,
    leftLeg,
    rightLeg,
  };
}

function createEnduranceHalo() {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(0.085, 0.085, 0.045);
  const materials: THREE.MeshBasicMaterial[] = [];
  const segments: THREE.Mesh[] = [];

  for (let index = 0; index < ENDURANCE_SEGMENTS; index += 1) {
    const angle =
      -Math.PI / 2 + (index / ENDURANCE_SEGMENTS) * Math.PI * 2;
    const material = new THREE.MeshBasicMaterial({
      color: "#72e9ff",
      transparent: true,
      opacity: 0.94,
      depthTest: false,
      depthWrite: false,
    });
    const segment = new THREE.Mesh(geometry, material);
    segment.position.set(Math.cos(angle) * 0.62, Math.sin(angle) * 0.62, 0);
    segment.rotation.z = angle + Math.PI / 2;
    segment.renderOrder = 20;
    materials.push(material);
    segments.push(segment);
    group.add(segment);
  }

  group.visible = false;
  return { group, geometry, materials, segments };
}

function updateEnduranceHalo(
  halo: ReturnType<typeof createEnduranceHalo>,
  reserve: number,
  pulse: number,
) {
  const safeReserve = THREE.MathUtils.clamp(reserve, 0, 1);
  const litSegments = Math.ceil(safeReserve * ENDURANCE_SEGMENTS);
  const signal =
    safeReserve > 0.42
      ? ENDURANCE_COLORS.healthy
      : safeReserve > 0.18
        ? ENDURANCE_COLORS.warning
        : ENDURANCE_COLORS.critical;

  halo.materials.forEach((material, index) => {
    const lit = index < litSegments;
    material.color.copy(signal);
    material.opacity = lit ? 0.72 + pulse * 0.24 : 0.075;
  });
}

function createMemorialField(
  clusters: MemorialCluster[],
  points: THREE.Vector3[],
) {
  const group = new THREE.Group();
  const tiers = [
    {
      size: 0.28,
      height: 0.19,
      y: 0.095,
      color: MOUNTAIN_MATERIALS.placedGranite,
    },
    {
      size: 0.2,
      height: 0.14,
      y: 0.26,
      color: MOUNTAIN_MATERIALS.freshCut,
    },
    { size: 0.12, height: 0.1, y: 0.38, color: "#ffc86b" },
  ];
  const meshes = tiers.map((tier) => {
    const geometry = new THREE.BoxGeometry(tier.size, tier.height, tier.size);
    const material = new THREE.MeshBasicMaterial({
      color: tier.color,
      transparent: true,
      opacity: tier.color === "#ffc86b" ? 0.82 : 0.72,
      fog: true,
    });
    const mesh = new THREE.InstancedMesh(
      geometry,
      material,
      Math.max(1, clusters.length),
    );
    mesh.count = clusters.length;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    return mesh;
  });

  const dummy = new THREE.Object3D();
  clusters.forEach((cluster, index) => {
    const logarithmicScale = THREE.MathUtils.clamp(
      0.78 + Math.log2(cluster.count + 1) * 0.18,
      0.78,
      2.35,
    );
    meshes.forEach((mesh, tierIndex) => {
      dummy.position.copy(points[index]);
      dummy.position.y += tiers[tierIndex].y * logarithmicScale;
      dummy.rotation.set(0, index * 0.61 + tierIndex * 0.23, 0);
      dummy.scale.setScalar(logarithmicScale);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
  });
  meshes.forEach((mesh) => {
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  });

  return { group, meshes };
}

async function loadDemLayer(
  stem: string,
  signal: AbortSignal,
): Promise<DemLayer> {
  const [metadataResponse, elevationResponse] = await Promise.all([
    fetch(`/data/${stem}.json`, { signal }),
    fetch(`/data/${stem}.int16`, { signal }),
  ]);
  if (!metadataResponse.ok || !elevationResponse.ok) {
    throw new Error(`Everest DEM layer ${stem} could not be loaded.`);
  }
  const metadata = (await metadataResponse.json()) as DemMetadata;
  const buffer = await elevationResponse.arrayBuffer();
  const view = new DataView(buffer);
  const elevations = new Int16Array(buffer.byteLength / 2);
  for (let index = 0; index < elevations.length; index += 1) {
    elevations[index] = view.getInt16(index * 2, true);
  }
  if (elevations.length !== metadata.width * metadata.height) {
    throw new Error(
      `Everest DEM layer ${stem} does not match its source manifest.`,
    );
  }
  return { metadata, elevations };
}

function createActivityDem(
  core: DemLayer,
  mid: DemLayer,
  sites: SiteAnchor[],
  sampleSpacingArcSeconds = 1,
): DemLayer {
  const paddingDegrees = 0.04;
  const samplesPerDegree = 3600 / sampleSpacingArcSeconds;
  const degreesPerSample = 1 / samplesPerDegree;
  const bounds = {
    north:
      Math.ceil(
        Math.max(
          core.metadata.bounds.north,
          ...sites.map((site) => site.latitude + paddingDegrees),
        ) * samplesPerDegree,
      ) / samplesPerDegree,
    south:
      Math.floor(
        Math.min(
          core.metadata.bounds.south,
          ...sites.map((site) => site.latitude - paddingDegrees),
        ) * samplesPerDegree,
      ) / samplesPerDegree,
    west:
      Math.floor(
        Math.min(
          core.metadata.bounds.west,
          ...sites.map((site) => site.longitude - paddingDegrees),
        ) * samplesPerDegree,
      ) / samplesPerDegree,
    east:
      Math.ceil(
        Math.max(
          core.metadata.bounds.east,
          ...sites.map((site) => site.longitude + paddingDegrees),
        ) * samplesPerDegree,
      ) / samplesPerDegree,
  };
  const width = Math.round(
    (bounds.east - bounds.west) / degreesPerSample,
  );
  const height = Math.round(
    (bounds.north - bounds.south) / degreesPerSample,
  );
  const elevations = new Int16Array(width * height);
  let minimumM = Number.POSITIVE_INFINITY;
  let maximumM = Number.NEGATIVE_INFINITY;

  for (let row = 0; row < height; row += 1) {
    const latitude =
      bounds.north - (row + 0.5) * degreesPerSample;
    for (let column = 0; column < width; column += 1) {
      const longitude =
        bounds.west + (column + 0.5) * degreesPerSample;
      const source = containsCoordinate(
        core.metadata.bounds,
        latitude,
        longitude,
      )
        ? core
        : mid;
      const sourceStep =
        source.metadata.sampleSpacingArcSeconds / 3600;
      const sourceColumn =
        (longitude - source.metadata.bounds.west) / sourceStep -
        0.5;
      const sourceRow =
        (source.metadata.bounds.north - latitude) / sourceStep -
        0.5;
      const elevationM = Math.round(
        sampleDemElevation(
          source.elevations,
          source.metadata.width,
          source.metadata.height,
          sourceColumn,
          sourceRow,
        ),
      );
      elevations[row * width + column] = elevationM;
      minimumM = Math.min(minimumM, elevationM);
      maximumM = Math.max(maximumM, elevationM);
    }
  }

  return {
    metadata: {
      id: `COP-DEM-GLO-30-EVEREST-ACTIVITY-${sampleSpacingArcSeconds}-ARCSEC`,
      lod: "core",
      source: core.metadata.source,
      sourceResolutionM: 30,
      displayResolutionM: sampleSpacingArcSeconds * 30,
      sampleSpacingArcSeconds,
      width,
      height,
      bounds,
      minimumM,
      maximumM,
      attribution: core.metadata.attribution,
    },
    elevations,
  };
}

async function loadDem(signal: AbortSignal) {
  const [core, mid, far, sites] = await Promise.all([
    loadDemLayer("everest-dem", signal),
    loadDemLayer("everest-dem-mid", signal),
    loadDemLayer("everest-dem-far", signal),
    fetch("/data/sites.json", { signal }).then(async (response) => {
      if (!response.ok) throw new Error("Site anchors could not be loaded.");
      return (await response.json()) as { sites: SiteAnchor[] };
    }),
  ]);
  return { core, mid, far, sites: sites.sites };
}

export default function EverestObservatory() {
  const canvasHost = useRef<HTMLDivElement>(null);
  const siteOverlayHost = useRef<HTMLDivElement>(null);
  const replayProgressHost = useRef<HTMLDivElement>(null);
  const activeExpeditionRef = useRef(0);
  const manualReplayUntil = useRef(0);
  const manualReplayStarted = useRef(0);
  const cameraViewRef = useRef<{
    position: THREE.Vector3;
    target: THREE.Vector3;
  } | null>(null);
  const terrainResolutionRef =
    useRef<TerrainResolution>("30 M");
  const navigationCommandRef = useRef<NavigationCommand | null>(
    null,
  );
  const [activeExpedition, setActiveExpedition] = useState(0);
  const [rankingsOpen, setRankingsOpen] = useState(false);
  const [coordinateX, setCoordinateX] = useState("");
  const [coordinateZ, setCoordinateZ] = useState("");
  const [coordinateStatus, setCoordinateStatus] = useState<
    "idle" | "queued" | "focused" | "invalid" | "outside"
  >("idle");
  const [terrainResolution, setTerrainResolution] =
    useState<TerrainResolution>("30 M");
  const [terrainPerformance, setTerrainPerformance] =
    useState<TerrainPerformanceSnapshot>({
      fps: 0,
      drawCalls: 0,
      triangles: 0,
      workerBuildMs: 0,
      meshCacheEntries: 0,
      residentBufferMB: 0,
      meshCacheHitPercent: 0,
      residentTiles: 0,
      workerQueue: 0,
    });
  const [skyPhase, setSkyPhase] = useState<SkyPhase>(() =>
    kathmanduSkyPhase(),
  );
  const [sceneStatus, setSceneStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [feedStatus, setFeedStatus] = useState<
    "loading" | "live" | "fallback"
  >("loading");
  const [feed, setFeed] = useState(fallbackObservatoryFeed);
  const expeditions = feed.recentExpeditions;
  const leaderboard = feed.leaderboard;
  const memorialClusters =
    feed.memorialClusters ?? EMPTY_MEMORIAL_CLUSTERS;
  const sceneDataRef = useRef({
    feed,
    expeditions,
    memorialClusters,
  });

  useEffect(() => {
    sceneDataRef.current = {
      feed,
      expeditions,
      memorialClusters,
    };
  }, [expeditions, feed, memorialClusters]);

  useEffect(() => {
    const update = () => setSkyPhase(kathmanduSkyPhase());
    const interval = window.setInterval(update, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const abortController = new AbortController();
    let interval = 0;
    let firstLoad = true;

    const refresh = async () => {
      try {
        const result = await loadObservatoryFeed(abortController.signal);
        setFeed((current) =>
          firstLoad ||
          current.sequence !== result.feed.sequence ||
          current.worldHash !== result.feed.worldHash
            ? result.feed
            : current,
        );
        setFeedStatus("live");
        firstLoad = false;
        if (!interval) {
          interval = window.setInterval(refresh, result.pollIntervalMs);
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          setFeedStatus("fallback");
          console.warn(
            "The live world feed is unavailable; using fallback data.",
            error,
          );
          if (!interval) {
            interval = window.setInterval(refresh, 30_000);
          }
        }
      }
    };

    void refresh();
    return () => {
      abortController.abort();
      if (interval) window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const parameters = new URLSearchParams(window.location.search);
      const x = parameters.get("x");
      const z = parameters.get("z");
      if (x === null || z === null) return;
      const parsedX = Number(x);
      const parsedZ = Number(z);
      if (!Number.isFinite(parsedX) || !Number.isFinite(parsedZ)) {
        setCoordinateStatus("invalid");
        return;
      }
      setCoordinateX(x);
      setCoordinateZ(z);
      setCoordinateStatus("queued");
      navigationCommandRef.current = {
        type: "coordinates",
        x: parsedX,
        z: parsedZ,
        distanceM: 18,
      };
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const host = canvasHost.current;
    const overlayHost = siteOverlayHost.current;
    if (!host || !overlayHost) return;

    const abortController = new AbortController();
    let disposed = false;
    let cleanupScene = () => {};

    const start = async () => {
      const { core, mid, far, sites } = await loadDem(
        abortController.signal,
      );
      if (disposed) return;
      const {
        feed: sceneFeed,
        expeditions: sceneExpeditions,
        memorialClusters: sceneMemorialClusters,
      } = sceneDataRef.current;

      const scene = new THREE.Scene();
      const alpinePalette = SKY_PHASES[skyPhase];
      scene.fog = new THREE.FogExp2(alpinePalette.fog, 0.00415);

      const camera = new THREE.PerspectiveCamera(
        43,
        host.clientWidth / host.clientHeight,
        0.00035,
        1_400,
      );
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
        logarithmicDepthBuffer: true,
      });
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.45));
      renderer.setSize(host.clientWidth, host.clientHeight, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = alpinePalette.exposure;
      renderer.domElement.setAttribute(
        "aria-label",
        "Interactive voxel rendering of Mount Everest derived from Copernicus GLO-30 elevation data.",
      );
      renderer.domElement.setAttribute("role", "application");
      renderer.domElement.tabIndex = 0;
      renderer.domElement.setAttribute(
        "aria-label",
        "Interactive Everest terrain. Focus, then use WASD or arrow keys to move.",
      );
      host.appendChild(renderer.domElement);

      const activity = createActivityDem(core, mid, sites);
      const activityOverview = createActivityDem(
        core,
        mid,
        sites,
        3,
      );
      const farTerrain = createVoxelTerrain(
        far.elevations,
        far.metadata,
        {
          holeBounds: activity.metadata.bounds,
          overlapCells: 2.5,
          yOffset: -0.08,
          detailedSides: false,
        },
      );
      const activityOverviewTerrain = createVoxelTerrain(
        activityOverview.elevations,
        activityOverview.metadata,
        {
          yOffset: -0.035,
          detailedSides: false,
        },
      );
      const terrain = createVoxelTerrain(
        activity.elevations,
        activity.metadata,
        { detailedSides: false },
      );
      const terrainStreaming = new TerrainStreamingEngine(
        {
          metadata: activity.metadata,
          elevations: activity.elevations,
          terrain: {
            blockSize: terrain.blockSize,
            xOrigin: terrain.xOrigin,
            zOrigin: terrain.zOrigin,
          },
          canonicalOriginLatitude: CANONICAL_ORIGIN_LATITUDE,
          canonicalOriginLongitude: CANONICAL_ORIGIN_LONGITUDE,
          metersPerDegreeLatitude: METERS_PER_DEGREE_LATITUDE,
          worldUnitsPerMeter: WORLD_UNITS_PER_METER,
        },
        sceneFeed,
      );
      const terrainLayers = [
        farTerrain,
        activityOverviewTerrain,
        terrain,
      ];
      terrainLayers.forEach((layer) => {
        (layer.mesh.material as THREE.MeshBasicMaterial).color.set(
          alpinePalette.terrainTint,
        );
        scene.add(layer.mesh);
      });
      const coreTerrainMaterial =
        terrain.mesh.material as THREE.MeshBasicMaterial;
      coreTerrainMaterial.transparent = true;
      activityOverviewTerrain.mesh.visible = false;
      const detailAmbientLight = new THREE.HemisphereLight(
        skyPhase === "night" ? "#b3d5e7" : "#e2f1f2",
        "#1c292e",
        skyPhase === "night" ? 1.45 : 1.7,
      );
      const detailSunLight = new THREE.DirectionalLight(
        skyPhase === "dawn" || skyPhase === "dusk"
          ? "#ffd0a3"
          : skyPhase === "night"
            ? "#c4dff2"
            : "#fff0d5",
        skyPhase === "night" ? 1.65 : 2.2,
      );
      detailSunLight.position.set(5, 9, 6);
      scene.add(detailAmbientLight, detailSunLight);

      const siteObjects = sites
        .map((site) => {
          const layer =
            containsCoordinate(
              activity.metadata.bounds,
              site.latitude,
              site.longitude,
            )
              ? { terrain, metadata: activity.metadata }
              : { terrain: farTerrain, metadata: far.metadata };
          // Keep the canonical site coordinates for gameplay, but focus the
          // visual summit preset on the apex of the rendered DEM. The public
          // site anchor and the maximum GLO-30 sample differ by roughly one
          // hundred metres, which is imperceptible in overview and very
          // obvious once the camera reaches metre-scale detail.
          const point =
            site.kind === "SUMMIT"
              ? gridPoint(
                  terrain,
                  terrain.peakColumn,
                  terrain.peakRow,
                  0.5,
                )
              : coordinatePoint(
                  layer.terrain,
                  layer.metadata,
                  site.latitude,
                  site.longitude,
                );
          const siteGroup = new THREE.Group();
          const signalColor =
            site.kind === "SUMMIT"
              ? "#ffc86b"
              : site.kind === "BASE"
                ? "#8dffc1"
                : "#72e9ff";
          const beamMaterial = new THREE.MeshBasicMaterial({
            color: signalColor,
            transparent: true,
            opacity: site.kind === "SUMMIT" ? 0.94 : 0.62,
            depthWrite: false,
          });
          const ringMaterial = new THREE.MeshBasicMaterial({
            color: signalColor,
            transparent: true,
            opacity: 0.32,
            side: THREE.DoubleSide,
            depthWrite: false,
          });
          const marker = new THREE.Mesh(
            new THREE.BoxGeometry(
              site.kind === "SUMMIT" ? 0.3 : 0.18,
              site.kind === "SUMMIT" ? 2.65 : 1.55,
              site.kind === "SUMMIT" ? 0.3 : 0.18,
            ),
            beamMaterial,
          );
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.28, 0.45, 4),
            ringMaterial,
          );
          marker.position.y += site.kind === "SUMMIT" ? 1.33 : 0.78;
          ring.rotation.x = -Math.PI / 2;
          ring.rotation.z = Math.PI / 4;
          ring.position.y += 0.07;
          siteGroup.position.copy(point);
          siteGroup.add(marker, ring);
          scene.add(siteGroup);

          const label = createSiteLabel(site);
          overlayHost.appendChild(label);
          const labelPoint = point.clone();
          labelPoint.y += site.kind === "SUMMIT" ? 3.2 : 2.05;
          return {
            site,
            siteGroup,
            marker,
            ring,
            beamMaterial,
            ringMaterial,
            label,
            labelPoint,
          };
        });
      const prioritizedSiteObjects = [...siteObjects].sort(
        (left, right) => sitePriority(right.site) - sitePriority(left.site),
      );

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(1_600, 1_600),
        new THREE.MeshBasicMaterial({
          color: alpinePalette.ground,
          fog: true,
        }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = 0.15;
      scene.add(ground);

      const baseCampObject = siteObjects.find(
        (siteObject) => siteObject.site.id === "south-base-camp",
      );
      const summitObject = siteObjects.find(
        (siteObject) => siteObject.site.id === "everest-summit",
      );
      const summitPoint =
        summitObject?.siteGroup.position.clone() ??
        gridPoint(terrain, terrain.peakColumn, terrain.peakRow, 1.12);
      const basePoint =
        baseCampObject?.siteGroup.position.clone() ??
        summitPoint.clone().add(new THREE.Vector3(-62, -42, 0));
      const summitDirection = summitPoint
        .clone()
        .sub(basePoint)
        .setY(0)
        .normalize();
      const openingSide = new THREE.Vector3(
        -summitDirection.z,
        0,
        summitDirection.x,
      );
      camera.position
        .copy(basePoint)
        .addScaledVector(summitDirection, -68)
        .addScaledVector(openingSide, 13);
      camera.position.y += 42;
      const target = basePoint.clone().lerp(summitPoint, 0.3);
      target.y = detailedSurfaceY(
        activity,
        terrain,
        target.x,
        target.z,
      );
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.copy(target);
      controls.enableDamping = true;
      controls.dampingFactor = 0.075;
      controls.enablePan = true;
      controls.screenSpacePanning = true;
      controls.zoomToCursor = false;
      controls.zoomSpeed = 1.75;
      controls.minDistance = 0.0018;
      controls.maxDistance = 225;
      controls.minPolarAngle = 0.2;
      controls.maxPolarAngle = 1.48;
      controls.autoRotate = false;
      if (cameraViewRef.current) {
        camera.position.copy(cameraViewRef.current.position);
        controls.target.copy(cameraViewRef.current.target);
      }
      const activityWorldBounds = {
        minX: terrain.xOrigin + terrain.blockSize,
        maxX:
          terrain.xOrigin +
          (terrain.width - 1) * terrain.blockSize,
        minZ: terrain.zOrigin + terrain.blockSize,
        maxZ:
          terrain.zOrigin +
          (terrain.height - 1) * terrain.blockSize,
      };
      let navigationSurfaceCellM = 30;
      const navigation = new SurfaceNavigationController({
        camera,
        controls,
        domElement: renderer.domElement,
        bounds: activityWorldBounds,
        worldUnitsPerMeter: WORLD_UNITS_PER_METER,
        sampleSurfaceY: (worldX, worldZ) =>
          detailedSurfaceY(
            activity,
            terrain,
            worldX,
            worldZ,
            navigationSurfaceCellM,
            terrainStreaming,
          ),
      });
      const lodSelector = new ScreenSpaceLodSelector<TerrainResolution>(
        TERRAIN_SCREEN_LODS,
        "90 M",
      );

      let detailPatchCenter = new THREE.Vector2(
        controls.target.x,
        controls.target.z,
      );
      const detailPatchKey = (
        center: THREE.Vector2,
        cellM: number,
        gridCells: number,
        innerHoleM: number,
        innerOverlapM: number,
        outerTransitionM: number,
        worldHash: string,
      ) =>
        [
          worldHash,
          center.x.toFixed(6),
          center.y.toFixed(6),
          cellM,
          gridCells,
          innerHoleM.toFixed(3),
          innerOverlapM.toFixed(3),
          outerTransitionM.toFixed(3),
        ].join(":");
      const registerDetailPatch = async (
        center: THREE.Vector2,
        cellM: number,
        gridCells: number,
        innerHoleM: number,
        innerOverlapM: number,
        outerTransitionM: number,
        feedSnapshot: ObservatoryFeed,
        reusablePatches: ReadonlyMap<string, DetailPatch>,
      ) => {
        const key = detailPatchKey(
          center,
          cellM,
          gridCells,
          innerHoleM,
          innerOverlapM,
          outerTransitionM,
          feedSnapshot.worldHash,
        );
        const reusablePatch = reusablePatches.get(key);
        if (reusablePatch) return reusablePatch;
        terrainStreaming.setFeed(feedSnapshot);
        const patch = await terrainStreaming.createPatch({
          key,
          centerWorldX: center.x,
          centerWorldZ: center.y,
          cellM,
          gridCells,
          innerHoleM,
          innerOverlapM,
          outerTransitionM,
          terrainTint: alpinePalette.terrainTint,
        });
        patch.setOpacity(1);
        return patch;
      };
      const createDetailClipmap = async (
        activeIndex: number,
        center: THREE.Vector2,
        feedSnapshot: ObservatoryFeed,
        reusablePatches: ReadonlyMap<string, DetailPatch>,
      ): Promise<DetailClipmapSet> => {
        if (activeIndex < 0) {
          return {
            patches: [],
            activeIndex,
            worldHash: feedSnapshot.worldHash,
          };
        }
        const activeLod = DETAIL_LODS[activeIndex];
        const patches = [
          await registerDetailPatch(
            center,
            activeLod.cellM,
            activeLod.gridCells,
            0,
            0,
            activeLod.cellM * 8,
            feedSnapshot,
            reusablePatches,
          ),
        ];
        for (let index = activeIndex - 1; index >= 0; index -= 1) {
          const coarseLod = DETAIL_LODS[index];
          const finerLod = DETAIL_LODS[index + 1];
          const finerWindowM =
            finerLod.cellM * finerLod.gridCells;
          patches.push(
            await registerDetailPatch(
              center,
              coarseLod.cellM,
              coarseLod.gridCells,
              finerWindowM,
              Math.max(
                finerLod.cellM * 10,
                coarseLod.cellM * 2,
              ),
              coarseLod.cellM * 8,
              feedSnapshot,
              reusablePatches,
            ),
          );
        }
        const coarsestWindowM =
          DETAIL_LODS[0].cellM * DETAIL_LODS[0].gridCells;
        patches.push(
          await registerDetailPatch(
            center,
            OUTER_CLIPMAP_LOD.cellM,
            OUTER_CLIPMAP_LOD.gridCells,
            coarsestWindowM,
            DETAIL_LODS[0].cellM * 10,
            0,
            feedSnapshot,
            reusablePatches,
          ),
        );
        return {
          patches,
          activeIndex,
          worldHash: feedSnapshot.worldHash,
        };
      };
      const disposeDetailClipmap = (
        clipmap: DetailClipmapSet,
        retainedPatches: ReadonlySet<DetailPatch> = new Set(),
      ) => {
        clipmap.patches.forEach((patch) => {
          if (retainedPatches.has(patch)) return;
          scene.remove(patch.group);
          patch.dispose();
        });
      };
      let detailClipmap: DetailClipmapSet = {
        patches: [],
        activeIndex: -1,
        worldHash: sceneFeed.worldHash,
      };
      let lastClipmapBuildAt = 0;
      const snappedDetailCenter = (activeIndex: number) => {
        // Use one canonical alignment at every detail level so unchanged
        // coarser rings can be transferred between adjacent LODs instead of
        // regenerated only because their centers rounded differently.
        const snapCellM =
          activeIndex >= 0
            ? DETAIL_LODS[DETAIL_LODS.length - 1].cellM
            : OUTER_CLIPMAP_LOD.cellM;
        // Cover both the orbit target and the camera footprint. Centering only
        // on the target puts the camera outside a small high-resolution patch
        // at grazing angles, exposing its boundary from underneath.
        const viewCenterX =
          (controls.target.x + camera.position.x) * 0.5;
        const viewCenterZ =
          (controls.target.z + camera.position.z) * 0.5;
        const canonicalCenter = snapDetailCenterToCanonicalGrid(
          activity,
          terrain,
          viewCenterX,
          viewCenterZ,
          snapCellM,
        );
        return new THREE.Vector2(
          THREE.MathUtils.clamp(
            canonicalCenter.x,
            activityWorldBounds.minX,
            activityWorldBounds.maxX,
          ),
          THREE.MathUtils.clamp(
            canonicalCenter.y,
            activityWorldBounds.minZ,
            activityWorldBounds.maxZ,
          ),
        );
      };
      interface ClipmapBuildJob {
        key: string;
        activeIndex: number;
        center: THREE.Vector2;
        feed: ObservatoryFeed;
      }
      let clipmapBuildRunning = false;
      let clipmapBuildDisposed = false;
      let pendingClipmapKey: string | null = null;
      let queuedClipmapBuild: ClipmapBuildJob | null = null;
      const processClipmapBuilds = async () => {
        if (clipmapBuildRunning) return;
        clipmapBuildRunning = true;
        while (queuedClipmapBuild && !clipmapBuildDisposed) {
          const job = queuedClipmapBuild;
          queuedClipmapBuild = null;
          pendingClipmapKey = job.key;
          const reusablePatches = new Map(
            detailClipmap.patches.map((patch) => [
              patch.key,
              patch,
            ]),
          );
          const nextClipmap = await createDetailClipmap(
            job.activeIndex,
            job.center,
            job.feed,
            reusablePatches,
          );
          pendingClipmapKey = null;
          const queuedAfterBuild =
            queuedClipmapBuild as ClipmapBuildJob | null;
          if (
            clipmapBuildDisposed ||
            (queuedAfterBuild &&
              queuedAfterBuild.key !== job.key)
          ) {
            disposeDetailClipmap(
              nextClipmap,
              new Set(detailClipmap.patches),
            );
            continue;
          }
          nextClipmap.patches.forEach((patch) =>
            scene.add(patch.group),
          );
          const previousClipmap = detailClipmap;
          detailClipmap = nextClipmap;
          detailPatchCenter = job.center;
          lastClipmapBuildAt = performance.now();
          disposeDetailClipmap(
            previousClipmap,
            new Set(nextClipmap.patches),
          );
        }
        clipmapBuildRunning = false;
      };
      const requestDetailPatches = (activeIndex: number) => {
        const nextCenter = snappedDetailCenter(activeIndex);
        const feedSnapshot = sceneDataRef.current.feed;
        const key = `${feedSnapshot.worldHash}:${activeIndex}:${nextCenter.x.toFixed(
          5,
        )}:${nextCenter.y.toFixed(5)}`;
        const currentMatches =
          detailClipmap.activeIndex === activeIndex &&
          detailClipmap.worldHash === feedSnapshot.worldHash &&
          detailPatchCenter.distanceTo(nextCenter) < 0.00001;
        if (currentMatches) return;
        if (pendingClipmapKey === key) {
          queuedClipmapBuild = null;
          return;
        }
        if (queuedClipmapBuild?.key === key) return;
        queuedClipmapBuild = {
          key,
          activeIndex,
          center: nextCenter,
          feed: feedSnapshot,
        };
        void processClipmapBuilds().catch((error: unknown) => {
          clipmapBuildRunning = false;
          pendingClipmapKey = null;
          console.error(
            "Detail terrain could not be generated.",
            error,
          );
        });
      };
      const renderedResolutionFor = (
        desiredResolution: TerrainResolution,
        desiredDetailIndex: number,
      ): TerrainResolution => {
        if (
          desiredDetailIndex === detailClipmap.activeIndex
        ) {
          return desiredResolution;
        }
        if (detailClipmap.activeIndex >= 0) {
          return DETAIL_LODS[detailClipmap.activeIndex].label;
        }
        if (
          desiredResolution !== "90 M" &&
          desiredResolution !== "30 M"
        ) {
          return "30 M";
        }
        return desiredResolution;
      };
      const handleContextMenu = (event: MouseEvent) => {
        event.preventDefault();
      };
      const focusRaycaster = new THREE.Raycaster();
      const focusPointer = new THREE.Vector2();
      const handleDoubleClick = (event: MouseEvent) => {
        const rectangle =
          renderer.domElement.getBoundingClientRect();
        focusPointer.set(
          ((event.clientX - rectangle.left) / rectangle.width) *
            2 -
            1,
          -(
            ((event.clientY - rectangle.top) /
              rectangle.height) *
              2 -
            1
          ),
        );
        focusRaycaster.setFromCamera(focusPointer, camera);
        const detailMeshes: THREE.Object3D[] = [];
        detailClipmap.patches.forEach((patch) => {
          patch.group.traverse((object) => {
            if (object instanceof THREE.Mesh && object.visible) {
              detailMeshes.push(object);
            }
          });
        });
        const terrainMeshes = terrainLayers
          .map((layer) => layer.mesh)
          .filter((mesh) => mesh.visible);
        const intersection = focusRaycaster.intersectObjects(
          [...detailMeshes, ...terrainMeshes],
          false,
        )[0];
        if (!intersection) return;
        const currentDistanceM =
          camera.position.distanceTo(controls.target) /
          WORLD_UNITS_PER_METER;
        navigation.focus(
          intersection.point,
          THREE.MathUtils.clamp(
            currentDistanceM * 0.58,
            45,
            1_400,
          ),
        );
      };
      renderer.domElement.addEventListener(
        "contextmenu",
        handleContextMenu,
      );
      renderer.domElement.addEventListener(
        "dblclick",
        handleDoubleClick,
      );

      const traceObjects = sceneExpeditions.flatMap((expedition, index) => {
        if (!expedition.trace || expedition.trace.length < 2) return [];
        const points = createRoute(
          terrain,
          activity.metadata,
          expedition.trace,
          core.metadata,
        );
        if (
          baseCampObject &&
          points[0].distanceTo(baseCampObject.siteGroup.position) > 0.8
        ) {
          points.unshift(baseCampObject.siteGroup.position.clone());
          if (expedition.returned) {
            points.push(baseCampObject.siteGroup.position.clone());
          }
        }
        const material = new THREE.LineBasicMaterial({
          color: expedition.color,
          transparent: true,
          opacity: index === 0 ? 0.92 : 0.42,
          depthWrite: false,
        });
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          material,
        );
        scene.add(line);

        const breadcrumbGeometry = new THREE.BoxGeometry(0.22, 0.22, 0.22);
        const breadcrumbMaterial = new THREE.MeshBasicMaterial({
          color: expedition.color,
          transparent: true,
          opacity: index === 0 ? 0.9 : 0.42,
        });
        const breadcrumbPoints = points.filter(
          (_, pointIndex) => pointIndex % 3 === 0,
        );
        const breadcrumbs = new THREE.InstancedMesh(
          breadcrumbGeometry,
          breadcrumbMaterial,
          breadcrumbPoints.length,
        );
        const breadcrumbDummy = new THREE.Object3D();
        breadcrumbPoints.forEach((point, pointIndex) => {
          breadcrumbDummy.position.copy(point);
          breadcrumbDummy.updateMatrix();
          breadcrumbs.setMatrixAt(pointIndex, breadcrumbDummy.matrix);
        });
        breadcrumbs.instanceMatrix.needsUpdate = true;
        scene.add(breadcrumbs);

        const climber = createVoxelClimber(expedition.color);
        scene.add(climber.group);

        const enduranceHalo = createEnduranceHalo();
        scene.add(enduranceHalo.group);

        const actionIndex = Math.min(
          points.length - 1,
          Math.round(expedition.releaseFraction * (points.length - 1)),
        );
        const actionMaterial = new THREE.MeshBasicMaterial({
          color: "#ffc86b",
          transparent: true,
          opacity: 0.25,
          depthWrite: false,
        });
        const actionMarker = new THREE.Mesh(
          new THREE.BoxGeometry(0.34, 0.34, 0.34),
          actionMaterial,
        );
        actionMarker.position.copy(points[actionIndex]);
        actionMarker.position.y += 0.2;
        scene.add(actionMarker);

        return [{
          expeditionIndex: index,
          expedition,
          points,
          line,
          material,
          breadcrumbs,
          breadcrumbGeometry,
          breadcrumbMaterial,
          ...climber,
          enduranceHalo,
          actionMarker,
          actionMaterial,
        }];
      });

      const memorialPoints = sceneMemorialClusters.map((cluster) => {
        const layer =
          containsCoordinate(
            activity.metadata.bounds,
            cluster.latitude,
            cluster.longitude,
          )
            ? { terrain, metadata: activity.metadata }
            : { terrain: farTerrain, metadata: far.metadata };
        return coordinatePoint(
          layer.terrain,
          layer.metadata,
          cluster.latitude,
          cluster.longitude,
        );
      });
      const memorialField = createMemorialField(
        sceneMemorialClusters,
        memorialPoints,
      );
      scene.add(memorialField.group);

      const summit = gridPoint(
        terrain,
        terrain.peakColumn,
        terrain.peakRow,
        1.12,
      );
      const summitStone = new THREE.Mesh(
        new THREE.BoxGeometry(0.52, 0.52, 0.52),
        new THREE.MeshBasicMaterial({
          color: MOUNTAIN_MATERIALS.summitSignal,
        }),
      );
      summitStone.position.copy(summit);
      scene.add(summitStone);

      navigation.update(
        performance.now(),
        cellSizeForResolution("90 M") * 0.72,
      );
      renderer.render(scene, camera);
      setSceneStatus("ready");

      let frame = 0;
      const started = performance.now();
      let suppressOverviewUntilDetailReady = false;
      let overviewSuppressedAt = 0;
      let lastPrefetchAt = 0;
      let lastPrefetchKey = "";
      let performanceWindowStartedAt = started;
      let performanceFrameCount = 0;
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const render = (time: number) => {
        const seconds = Math.max(0, (time - started) / 1000);
        const navigationCommand = navigationCommandRef.current;
        if (navigationCommand) {
          navigationCommandRef.current = null;
          renderer.domElement.focus({ preventScroll: true });
          if (navigationCommand.type === "nudge") {
            navigation.nudge(
              navigationCommand.forward,
              navigationCommand.right,
            );
          } else if (navigationCommand.type === "focus") {
            const siteObject = siteObjects.find(
              ({ site }) =>
                site.id === navigationCommand.siteId,
            );
            if (siteObject) {
              // A focus flight can finish much sooner than a detail clipmap
              // builds on a slower device. Keep world-scale annotations out
              // of the close camera until the requested surface is actually
              // installed, rather than tying their visibility to a timer.
              suppressOverviewUntilDetailReady = true;
              overviewSuppressedAt = time;
              navigation.focus(
                siteObject.siteGroup.position,
                navigationCommand.distanceM,
              );
            }
          } else {
            const point = canonicalCoordinatePoint(
              activity,
              terrain,
              navigationCommand.x,
              navigationCommand.z,
            );
            if (!point) {
              setCoordinateStatus("outside");
            } else {
              suppressOverviewUntilDetailReady = true;
              overviewSuppressedAt = time;
              navigation.focus(point, navigationCommand.distanceM);
              setCoordinateStatus("focused");
            }
          }
        }
        const currentCellM = cellSizeForResolution(
          terrainResolutionRef.current,
        );
        navigationSurfaceCellM = currentCellM;
        const navigationSnapshot = navigation.update(
          time,
          Math.max(1.2, currentCellM * 1.05),
        );
        const cameraDistanceM = navigationSnapshot.distanceM;
        const cameraDistance =
          cameraDistanceM * WORLD_UNITS_PER_METER;
        const nextResolution = lodSelector.update(
          cameraDistanceM,
          Math.max(1, host.clientHeight),
          THREE.MathUtils.degToRad(camera.fov),
          time,
          navigationSnapshot.inputActive,
        );
        const activeDetailIndex = DETAIL_LODS.findIndex(
          (lod) => lod.label === nextResolution,
        );
        const desiredDetailCenter =
          snappedDetailCenter(activeDetailIndex);
        if (
          activeDetailIndex >= 0 &&
          time - lastPrefetchAt > 240
        ) {
          const lod = DETAIL_LODS[activeDetailIndex];
          const prefetchKey = `${activeDetailIndex}:${(
            desiredDetailCenter.x / Math.max(0.001, lod.cellM * 24)
          ).toFixed(0)}:${(
            desiredDetailCenter.y / Math.max(0.001, lod.cellM * 24)
          ).toFixed(0)}:${sceneDataRef.current.feed.worldHash}`;
          if (prefetchKey !== lastPrefetchKey) {
            terrainStreaming.setFeed(sceneDataRef.current.feed);
            terrainStreaming.prefetch(
              desiredDetailCenter.x,
              desiredDetailCenter.y,
              lod.cellM * lod.gridCells * 1.18,
            );
            lastPrefetchKey = prefetchKey;
            lastPrefetchAt = time;
          }
        }
        const patchDriftM =
          desiredDetailCenter.distanceTo(detailPatchCenter) /
          WORLD_UNITS_PER_METER;
        const detailWorldChanged =
          detailClipmap.worldHash !==
          sceneDataRef.current.feed.worldHash;
        if (
          (activeDetailIndex !== detailClipmap.activeIndex ||
            detailWorldChanged) &&
          !navigationSnapshot.inputActive &&
          navigationSnapshot.inputIdleMs > 110
        ) {
          requestDetailPatches(activeDetailIndex);
        } else if (
          activeDetailIndex >= 0 &&
          navigationSnapshot.inputIdleMs > 140 &&
          time - lastClipmapBuildAt > 220
        ) {
          const activeLod = DETAIL_LODS[activeDetailIndex];
          const recenterThresholdM = Math.max(
            activeLod.cellM * 12,
            activeLod.cellM * activeLod.gridCells * 0.18,
          );
          if (patchDriftM > recenterThresholdM) {
            requestDetailPatches(activeDetailIndex);
          }
        }
        const renderedResolution = renderedResolutionFor(
          nextResolution,
          activeDetailIndex,
        );
        const detailSurfaceReady =
          activeDetailIndex >= 0 &&
          detailClipmap.activeIndex === activeDetailIndex;
        if (
          suppressOverviewUntilDetailReady &&
          (detailSurfaceReady ||
            (time - overviewSuppressedAt > 1_200 &&
              cameraDistanceM >= 8_000))
        ) {
          suppressOverviewUntilDetailReady = false;
        }
        const coreOpacity =
          renderedResolution === "30 M" ? 1 : 0;
        coreTerrainMaterial.opacity = coreOpacity;
        coreTerrainMaterial.depthWrite = coreOpacity > 0.72;
        terrain.mesh.visible = coreOpacity > 0.01;
        activityOverviewTerrain.mesh.visible =
          renderedResolution === "90 M";
        // Keep the previous terrain visible while the next clipmap is built,
        // but hide overview-only markers as soon as the camera requests a
        // detail LOD. Otherwise their world-scale pillars briefly fill the
        // camera during focus/zoom transitions.
        const overviewContextVisible =
          !suppressOverviewUntilDetailReady &&
          (nextResolution === "90 M" ||
            nextResolution === "30 M");
        farTerrain.mesh.visible = overviewContextVisible;
        siteObjects.forEach(({ siteGroup }) => {
          siteGroup.visible = overviewContextVisible;
        });
        memorialField.group.visible = overviewContextVisible;
        summitStone.visible = overviewContextVisible;
        if (
          terrainResolutionRef.current !== renderedResolution
        ) {
          terrainResolutionRef.current = renderedResolution;
          setTerrainResolution(renderedResolution);
        }

        const manualPlayback = time < manualReplayUntil.current;
        const nextActive =
          sceneExpeditions.length === 0
            ? 0
            : reduceMotion
              ? activeExpeditionRef.current %
                sceneExpeditions.length
              : manualPlayback
                ? activeExpeditionRef.current %
                  sceneExpeditions.length
                : Math.floor(seconds / REPLAY_SECONDS) %
                  sceneExpeditions.length;
        if (activeExpeditionRef.current !== nextActive) {
          activeExpeditionRef.current = nextActive;
          setActiveExpedition(nextActive);
        }
        const activeSeconds = manualPlayback
          ? Math.max(0, (time - manualReplayStarted.current) / 1000)
          : seconds;
        const rawPhase = reduceMotion
          ? 1
          : positiveModulo(activeSeconds / REPLAY_SECONDS, 1);

        traceObjects.forEach((trace, index) => {
          const isActive = nextActive === trace.expeditionIndex;
          const phase = isActive
            ? replayPhase(rawPhase, trace.expedition.releaseFraction)
            : 1;
          const scaled = phase * (trace.points.length - 1);
          const pointIndex = Math.min(
            trace.points.length - 2,
            Math.floor(scaled),
          );
          trace.group.position.lerpVectors(
            trace.points[pointIndex],
            trace.points[pointIndex + 1],
            scaled - pointIndex,
          );
          const direction = trace.points[pointIndex + 1]
            .clone()
            .sub(trace.points[pointIndex]);
          trace.group.rotation.y = Math.atan2(direction.x, direction.z);
          trace.group.rotation.x = THREE.MathUtils.clamp(
            -Math.atan2(
              direction.y,
              Math.hypot(direction.x, direction.z),
            ) * 0.22,
            -0.18,
            0.18,
          );
          const stride = reduceMotion
            ? 0
            : Math.sin(seconds * 10.5 + index);
          trace.group.position.y += Math.abs(stride) * 0.035;
          trace.leftLeg.rotation.x = stride * 0.42;
          trace.rightLeg.rotation.x = -stride * 0.42;
          trace.material.opacity = isActive ? 0.94 : 0.14;
          trace.breadcrumbMaterial.opacity = isActive ? 0.86 : 0.1;
          const ended = isActive && rawPhase > 0.92;
          trace.materials.forEach((material) => {
            material.opacity = ended ? 0.28 : isActive ? 1 : 0;
          });
          trace.line.visible = overviewContextVisible;
          trace.breadcrumbs.visible = overviewContextVisible;
          trace.group.visible = isActive && overviewContextVisible;
          trace.group.scale.setScalar(isActive ? 1.22 : 0.72);

          const reserve =
            1 -
            (phase *
              THREE.MathUtils.clamp(
                trace.expedition.enduranceUsed,
                0,
                100,
              )) /
              100;
          const haloPulse = reduceMotion
            ? 0.5
            : (Math.sin(seconds * 4.2) + 1) / 2;
          trace.enduranceHalo.group.visible =
            isActive && !ended && overviewContextVisible;
          trace.enduranceHalo.group.position.copy(trace.group.position);
          trace.enduranceHalo.group.position.y += 0.54;
          trace.enduranceHalo.group.quaternion.copy(camera.quaternion);
          const haloDistance = camera.position.distanceTo(
            trace.enduranceHalo.group.position,
          );
          const haloScale =
            THREE.MathUtils.clamp(haloDistance / 72, 0.82, 2.25) *
            (0.98 + haloPulse * (reserve < 0.2 ? 0.08 : 0.025));
          trace.enduranceHalo.group.scale.setScalar(haloScale);
          updateEnduranceHalo(trace.enduranceHalo, reserve, haloPulse);

          const actionDistance = Math.abs(
            phase - trace.expedition.releaseFraction,
          );
          const actionSignal = THREE.MathUtils.clamp(
            1 - actionDistance / 0.035,
            0,
            1,
          );
          trace.actionMaterial.opacity = isActive
            ? 0.13 + actionSignal * 0.82
            : 0.06;
          trace.actionMarker.visible = overviewContextVisible;
          trace.actionMarker.scale.setScalar(
            0.8 + actionSignal * (1.2 + haloPulse * 0.24),
          );
        });

        if (replayProgressHost.current) {
          replayProgressHost.current.style.setProperty(
            "--replay-progress",
            `${rawPhase * 100}%`,
          );
        }

        const minimumPriority =
          !overviewContextVisible
            ? 3
            : cameraDistance > 145
              ? 2
              : cameraDistance > 82
                ? 1
                : 0;
        const occupied: Array<{
          left: number;
          right: number;
          top: number;
          bottom: number;
        }> = [];
        prioritizedSiteObjects.forEach((siteObject) => {
          const priority = sitePriority(siteObject.site);
          const targetLocked =
            !overviewContextVisible &&
            priority >= 3 &&
            navigation.targetPlanarDistanceM(
              siteObject.siteGroup.position,
            ) <= Math.max(3, currentCellM * 4);
          const projected = (
            overviewContextVisible
              ? siteObject.labelPoint
              : siteObject.siteGroup.position
          )
            .clone()
            .project(camera);
          const inView =
            targetLocked ||
            (projected.z > -1 &&
              projected.z < 1 &&
              projected.x > -1.08 &&
              projected.x < 1.08 &&
              projected.y > -1.08 &&
              projected.y < 1.08);
          if (!inView || priority < minimumPriority) {
            siteObject.label.style.opacity = "0";
            siteObject.label.style.visibility = "hidden";
            return;
          }
          const projectedX = targetLocked
            ? host.clientWidth / 2
            : (projected.x * 0.5 + 0.5) * host.clientWidth;
          const projectedY = targetLocked
            ? host.clientHeight / 2
            : (-projected.y * 0.5 + 0.5) * host.clientHeight;
          const width =
            siteObject.site.kind === "SUMMIT"
              ? 198
              : siteObject.site.name.length > 18
                ? 188
                : 150;
          const height = 50;
          const x = THREE.MathUtils.clamp(
            projectedX,
            width / 2 + 10,
            host.clientWidth - width / 2 - 10,
          );
          const y = THREE.MathUtils.clamp(
            projectedY,
            height + (host.clientWidth <= 720 ? 70 : 88),
            host.clientHeight - 92,
          );
          const rectangle = {
            left: x - width / 2,
            right: x + width / 2,
            top: y - height,
            bottom: y,
          };
          const collides = occupied.some(
            (other) =>
              rectangle.left < other.right + 10 &&
              rectangle.right > other.left - 10 &&
              rectangle.top < other.bottom + 8 &&
              rectangle.bottom > other.top - 8,
          );
          if (collides && priority < 3) {
            siteObject.label.style.opacity = "0";
            siteObject.label.style.visibility = "hidden";
            return;
          }
          occupied.push(rectangle);
          siteObject.label.style.visibility = "visible";
          siteObject.label.style.opacity = "1";
          siteObject.label.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
          siteObject.label.dataset.lod =
            cameraDistance < 54
              ? "near"
              : cameraDistance < 118
                ? "mid"
                : "far";
          siteObject.ringMaterial.opacity =
            0.18 +
            (reduceMotion
              ? 0
              : Math.sin(seconds * 1.6 + priority) * 0.08);
        });

        renderer.render(scene, camera);
        performanceFrameCount += 1;
        const performanceElapsed = time - performanceWindowStartedAt;
        if (performanceElapsed >= 850) {
          const streamStats = terrainStreaming.stats();
          const totalMeshCacheRequests =
            streamStats.meshCacheHits + streamStats.meshCacheMisses;
          setTerrainPerformance({
            fps: Math.round(
              (performanceFrameCount * 1000) /
                Math.max(1, performanceElapsed),
            ),
            drawCalls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
            workerBuildMs: streamStats.workerBuildMs,
            meshCacheEntries: streamStats.meshCacheEntries,
            residentBufferMB: Math.round(
              (streamStats.meshCacheBytes +
                streamStats.residentTileBytes) /
                (1024 * 1024),
            ),
            meshCacheHitPercent:
              totalMeshCacheRequests > 0
                ? Math.round(
                    (streamStats.meshCacheHits /
                      totalMeshCacheRequests) *
                      100,
                  )
                : 0,
            residentTiles: streamStats.residentTiles,
            workerQueue: streamStats.workerQueue,
          });
          performanceWindowStartedAt = time;
          performanceFrameCount = 0;
        }
        frame = requestAnimationFrame(render);
      };
      frame = requestAnimationFrame(render);

      const observer = new ResizeObserver(() => {
        const width = host.clientWidth;
        const height = host.clientHeight;
        if (width === 0 || height === 0) return;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      });
      observer.observe(host);

      cleanupScene = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        cameraViewRef.current = {
          position: camera.position.clone(),
          target: controls.target.clone(),
        };
        clipmapBuildDisposed = true;
        queuedClipmapBuild = null;
        navigation.dispose();
        terrainStreaming.dispose();
        renderer.domElement.removeEventListener(
          "contextmenu",
          handleContextMenu,
        );
        renderer.domElement.removeEventListener(
          "dblclick",
          handleDoubleClick,
        );
        controls.dispose();
        traceObjects.forEach(
          ({
            line,
            material,
            breadcrumbGeometry,
            breadcrumbMaterial,
            group,
            materials,
            enduranceHalo,
            actionMarker,
            actionMaterial,
          }) => {
          line.geometry.dispose();
          material.dispose();
          breadcrumbGeometry.dispose();
          breadcrumbMaterial.dispose();
          group.traverse((object) => {
            if (object instanceof THREE.Mesh) object.geometry.dispose();
          });
          materials.forEach((item) => item.dispose());
          enduranceHalo.geometry.dispose();
          enduranceHalo.materials.forEach((item) => item.dispose());
          actionMarker.geometry.dispose();
          actionMaterial.dispose();
          },
        );
        memorialField.meshes.forEach((mesh) => {
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
        });
        disposeDetailClipmap(detailClipmap);
        terrainLayers.forEach((layer) => {
          layer.mesh.geometry.dispose();
          (layer.mesh.material as THREE.Material).dispose();
        });
        ground.geometry.dispose();
        (ground.material as THREE.Material).dispose();
        summitStone.geometry.dispose();
        (summitStone.material as THREE.Material).dispose();
        siteObjects.forEach(
          ({ siteGroup, beamMaterial, ringMaterial, label }) => {
            siteGroup.traverse((object) => {
              if (object instanceof THREE.Mesh) object.geometry.dispose();
            });
            beamMaterial.dispose();
            ringMaterial.dispose();
            label.remove();
          },
        );
        overlayHost.replaceChildren();
        renderer.dispose();
        if (host.contains(renderer.domElement)) {
          host.removeChild(renderer.domElement);
        }
      };
    };

    start().catch((error: unknown) => {
      if (disposed || abortController.signal.aborted) return;
      console.error(error);
      setSceneStatus("error");
    });

    return () => {
      disposed = true;
      abortController.abort();
      cleanupScene();
    };
    // Rebuild on a real world revision so trace and memorial objects cannot
    // lag behind the text/feed state. Unchanged polling responses keep the
    // existing camera and GPU resources.
  }, [feed.worldHash, skyPhase]);

  const active =
    expeditions.length > 0
      ? expeditions[activeExpedition % expeditions.length]
      : null;
  const activeDetailLod = DETAIL_LODS.find(
    ({ label }) => label === terrainResolution,
  );
  const selectReplay = (index: number, now: number) => {
    activeExpeditionRef.current = index;
    manualReplayStarted.current = now;
    manualReplayUntil.current = now + REPLAY_SECONDS * 1000;
    setActiveExpedition(index);
  };
  const navigate = (command: NavigationCommand) => {
    navigationCommandRef.current = command;
  };
  const focusCoordinates = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const x = Number(coordinateX);
    const z = Number(coordinateZ);
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      setCoordinateStatus("invalid");
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("x", String(x));
    url.searchParams.set("z", String(z));
    window.history.replaceState(null, "", url);
    setCoordinateStatus("queued");
    navigate({ type: "coordinates", x, z, distanceM: 18 });
  };

  return (
    <main
      className="observatory"
      data-sky={skyPhase}
      data-detail={
        terrainResolution === "80 CM" ||
        terrainResolution === "40 CM" ||
        terrainResolution === "20 CM"
          ? "true"
          : "false"
      }
    >
      <div className="voxel-sky" aria-hidden="true">
        <i />
        <span />
      </div>
      <div className="observatory-canvas" ref={canvasHost} />
      <div
        className="site-overlay"
        ref={siteOverlayHost}
        aria-hidden="true"
      />

      <header className="observatory-header">
        <a className="wordmark" href="#world" aria-label="ALTER EVEREST">
          <span className="wordmark-symbol" aria-hidden="true">
            <i />
            <i />
            <b />
          </span>
          <strong>
            <span>ALTER</span>
            <span>EVEREST</span>
          </strong>
        </a>
        <div className="scene-clock" aria-label="Everest local light">
          <small>EVEREST LIGHT</small>
          <strong>{skyPhase}</strong>
        </div>
        <div className="live-state">
          <i />
          {sceneStatus === "ready" && feedStatus === "live"
            ? "LIVE"
            : sceneStatus === "ready" && feedStatus === "fallback"
              ? "FEED OFFLINE"
            : sceneStatus === "error"
              ? "DEM ERROR"
              : "LOADING DEM"}
        </div>
        <div
          className="lod-indicator"
          aria-label={`Live terrain resolution ${terrainResolution}`}
          aria-live="polite"
        >
          <small>LIVE LOD</small>
          <strong>{terrainResolution}</strong>
        </div>
        <button
          className="rank-trigger"
          type="button"
          aria-expanded={rankingsOpen}
          onClick={() => setRankingsOpen((open) => !open)}
        >
          RANK
        </button>
      </header>

      <section className="world-id" id="world" aria-label="Current world">
        <small>THE MOUNTAIN IS THE COMMIT</small>
        <span>{`WORLD ${feed.sequence.toLocaleString("en-US")}`}</span>
        <strong>
          {`${Math.round(
            feed.currentHighestPoint?.altitudeM ?? feed.summitHeightM,
          ).toLocaleString("en-US")} M`}
        </strong>
      </section>

      {feed.worldSummary ? (
        <section className="world-summary" aria-label="World matter summary">
          <span>{feed.worldSummary.stoneCount} STONES</span>
          <span>
            {feed.worldSummary.removedTerrainVoxelCount} QUARRIED
          </span>
          <span>{feed.worldSummary.expeditionCount} EXPEDITIONS</span>
          <span>{feed.worldSummary.tombstoneCount} TOMBSTONES</span>
        </section>
      ) : null}

      {activeDetailLod ? (
        <section className="inspection-readout" aria-label="Live terrain detail">
          <small>STREAMED VOXEL FIELD</small>
          <strong>{terrainResolution} CELLS</strong>
          <span>
            CAMERA-CENTERED{" "}
            <b>
              {activeDetailLod.gridCells} ×{" "}
              {activeDetailLod.gridCells} COLUMNS
            </b>
          </span>
          <span>
            WINDOW{" "}
            <b>
              {(activeDetailLod.cellM * activeDetailLod.gridCells).toFixed(
                activeDetailLod.cellM < 1 ? 1 : 0,
              )}{" "}
              ×{" "}
              {(activeDetailLod.cellM * activeDetailLod.gridCells).toFixed(
                activeDetailLod.cellM < 1 ? 1 : 0,
              )}{" "}
              M
            </b>
          </span>
          <span>
            PIPELINE{" "}
            <b>
              {terrainPerformance.fps} FPS ·{" "}
              {terrainPerformance.drawCalls} DRAW ·{" "}
              {(terrainPerformance.triangles / 1_000).toFixed(0)}K TRI
            </b>
          </span>
          <span>
            STREAM{" "}
            <b>
              {terrainPerformance.residentTiles} TILE ·{" "}
              {terrainPerformance.meshCacheEntries} MESH ·{" "}
              {terrainPerformance.residentBufferMB} MB ·{" "}
              {terrainPerformance.meshCacheHitPercent}% HIT
              {terrainPerformance.workerQueue > 0
                ? ` · ${terrainPerformance.workerQueue} QUEUED`
                : ""}
            </b>
          </span>
          <p>
            SAME MOUNTAIN · DEM-GUIDED · AE-SURFACE-V1
          </p>
        </section>
      ) : null}

      <aside className="terrain-navigator" aria-label="Terrain navigation">
        <div className="terrain-navigator-heading">
          <small>NAVIGATE</small>
          <span>DOUBLE CLICK TO FOCUS</span>
        </div>
        <div className="terrain-destinations">
          {NAVIGATION_PRESETS.map((preset) => (
            <button
              key={preset.siteId}
              type="button"
              onClick={() =>
                navigate({
                  type: "focus",
                  siteId: preset.siteId,
                  distanceM: preset.distanceM,
                })
              }
            >
              {preset.label}
            </button>
          ))}
        </div>
        <form className="coordinate-focus" onSubmit={focusCoordinates}>
          <label>
            <span>X</span>
            <input
              inputMode="decimal"
              aria-label="Canonical X coordinate in metres"
              value={coordinateX}
              onChange={(event) => {
                setCoordinateX(event.target.value);
                setCoordinateStatus("idle");
              }}
              placeholder="-3985.0"
            />
          </label>
          <label>
            <span>Z</span>
            <input
              inputMode="decimal"
              aria-label="Canonical Z coordinate in metres"
              value={coordinateZ}
              onChange={(event) => {
                setCoordinateZ(event.target.value);
                setCoordinateStatus("idle");
              }}
              placeholder="-6655.0"
            />
          </label>
          <button type="submit">GO</button>
          <small aria-live="polite">
            {coordinateStatus === "invalid"
              ? "ENTER FINITE X / Z"
              : coordinateStatus === "outside"
                ? "OUTSIDE PROJECT DETAIL DEM"
                : coordinateStatus === "focused"
                  ? "PROJECT FOCUS"
                  : "CANONICAL METRES"}
          </small>
        </form>
        <div className="terrain-move-pad">
          <button
            type="button"
            aria-label="Move view forward"
            onClick={() =>
              navigate({ type: "nudge", forward: 1, right: 0 })
            }
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="Move view left"
            onClick={() =>
              navigate({ type: "nudge", forward: 0, right: -1 })
            }
          >
            ←
          </button>
          <span>MOVE</span>
          <button
            type="button"
            aria-label="Move view right"
            onClick={() =>
              navigate({ type: "nudge", forward: 0, right: 1 })
            }
          >
            →
          </button>
          <button
            type="button"
            aria-label="Move view backward"
            onClick={() =>
              navigate({ type: "nudge", forward: -1, right: 0 })
            }
          >
            ↓
          </button>
        </div>
      </aside>

      {active ? (
        <aside className="expedition-card" aria-label="Last expedition event">
          <div className="expedition-card-heading">
            <span
              className="route-swatch"
              style={{
                background: active.color,
                boxShadow: `0 0 22px ${active.color}`,
              }}
            />
            <small>{active.trace ? "LAST TRACE" : "LAST EVENT"}</small>
          </div>
          <strong>{active.agent}</strong>
          <div className="expedition-result">
            <span>{active.action}</span>
            <em>+{active.score}</em>
          </div>
          <div className="endurance-language">
            <span className="endurance-orbit" aria-hidden="true">
              {Array.from({ length: 12 }, (_, index) => (
                <i key={index} />
              ))}
            </span>
            <small>ENDURANCE ORBITS THE CLIMBER</small>
          </div>
        </aside>
      ) : (
        <aside className="expedition-card" aria-label="No expeditions yet">
          <div className="expedition-card-heading">
            <span className="route-swatch" />
            <small>NO EXPEDITIONS</small>
          </div>
          <strong>THE FIELD IS OPEN</strong>
          <div className="expedition-result">
            <span>AWAITING A FIRST CLIMBER</span>
          </div>
        </aside>
      )}

      <nav
        className="replay-dock"
        ref={replayProgressHost}
        aria-label="Expedition replay"
      >
        <div className="replay-progress" aria-hidden="true">
          <i />
        </div>
        <div className="replay-title">
          <small>
            {active
              ? active.trace
                ? "LIVE REPLAY"
                : "RECENT EVENTS"
              : "OPEN FIELD"}
          </small>
          <strong>
            {active
              ? active.trace
                ? "ONE SIGNAL AT A TIME"
                : "TRACE NOT PUBLISHED"
              : "AWAITING FIRST EXPEDITION"}
          </strong>
        </div>
        <div className="replay-list">
          {expeditions.map((expedition, index) => (
            <button
              key={expedition.id}
              type="button"
              aria-pressed={index === activeExpedition}
              onClick={(event) => selectReplay(index, event.timeStamp)}
            >
              <i style={{ background: expedition.color }} />
              <span>
                <strong>{expedition.agent}</strong>
                <small>{expedition.action}</small>
              </span>
            </button>
          ))}
        </div>
      </nav>

      {rankingsOpen ? (
        <aside className="rankings" aria-label="Agent leaderboard">
          <small>
            ALL-TIME · {leaderboard.length} IDENTITIES SHOWN
          </small>
          {leaderboard.map((entry, index) => (
            <div key={entry.agent}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{entry.agent}</strong>
              <em>{entry.totalScore}</em>
              <i className={entry.outcome.toLowerCase()} />
            </div>
          ))}
        </aside>
      ) : null}

      <div className="orbit-hint" aria-hidden="true">
        <span>
          LEFT DRAG · ZOOM · RIGHT DRAG / WASD MOVE
        </span>
        <i />
      </div>

      <div
        className="dem-credit"
        title="produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved"
      >
        {`COPERNICUS GLO-30 · ${terrainResolution} LIVE TERRAIN LOD`}
      </div>
    </main>
  );
}
