"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  fallbackObservatoryFeed,
  loadObservatoryFeed,
  type ObservatoryFeed,
} from "../lib/world";
import { syntheticReliefM } from "../engine/surface";

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

interface TerrainOptions {
  holeBounds?: DemBounds;
  overlapCells?: number;
  yOffset?: number;
  detailedSides?: boolean;
  minimumSideLevels?: number;
  edgeFeatherCells?: number;
}

const BASE_ELEVATION_M = 0;
const CORE_BLOCK_SIZE = 0.235;
const WORLD_PER_ARC_SECOND = CORE_BLOCK_SIZE;
const VERTICAL_EXAGGERATION = 1.5;
const ORIGIN_LATITUDE = 27.9881;
const ORIGIN_LONGITUDE = 86.925;
const REPLAY_SECONDS = 21;
const ENDURANCE_SEGMENTS = 28;
const INSPECTION_CELL_M = 0.2;
const INSPECTION_GRID_CELLS = 41;
const EMPTY_MEMORIAL_CLUSTERS: MemorialCluster[] = [];

type SkyPhase = "night" | "dawn" | "day" | "dusk";
type ViewMode = "mountain" | "inspect";

const SKY_PHASES: Record<
  SkyPhase,
  {
    fog: string;
    ground: string;
    exposure: number;
    terrainTint: string;
    skyLight: string;
    sunLight: string;
    ambientIntensity: number;
    sunIntensity: number;
  }
> = {
  night: {
    fog: "#071522",
    ground: "#090f16",
    exposure: 0.74,
    terrainTint: "#aebac4",
    skyLight: "#8aa9ca",
    sunLight: "#a9c9e9",
    ambientIntensity: 1.7,
    sunIntensity: 1.15,
  },
  dawn: {
    fog: "#1d3143",
    ground: "#121820",
    exposure: 0.88,
    terrainTint: "#e4d6cb",
    skyLight: "#8fa7c0",
    sunLight: "#ffc39b",
    ambientIntensity: 1.85,
    sunIntensity: 1.65,
  },
  day: {
    fog: "#56758a",
    ground: "#20282b",
    exposure: 0.9,
    terrainTint: "#ffffff",
    skyLight: "#abc8db",
    sunLight: "#fff1d4",
    ambientIntensity: 2.05,
    sunIntensity: 1.85,
  },
  dusk: {
    fog: "#132b40",
    ground: "#15191f",
    exposure: 0.82,
    terrainTint: "#ced0d2",
    skyLight: "#839db8",
    sunLight: "#ffae7e",
    ambientIntensity: 1.78,
    sunIntensity: 1.4,
  },
};

const MOUNTAIN_MATERIALS = {
  valleyRock: new THREE.Color("#394345"),
  weatheredGranite: new THREE.Color("#595652"),
  summitGranite: new THREE.Color("#6b6861"),
  sedimentBand: new THREE.Color("#303a3c"),
  sunWarmedBand: new THREE.Color("#695f55"),
  blueIce: new THREE.Color("#7897a0"),
  snow: new THREE.Color("#d0d8d6"),
  placedGranite: "#898982",
  freshCut: "#756a62",
  summitSignal: "#ffc86b",
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
  curvature: number,
  x: number,
  z: number,
  shade: number,
) {
  const altitudeRock = MOUNTAIN_MATERIALS.valleyRock
    .clone()
    .lerp(
      MOUNTAIN_MATERIALS.weatheredGranite,
      smoothstep(4_900, 6_900, elevationM),
    )
    .lerp(
      MOUNTAIN_MATERIALS.summitGranite,
      smoothstep(7_200, 8_650, elevationM) * 0.42,
    );
  const strataWave =
    Math.sin(elevationM * 0.018 + x * 0.012 - z * 0.006) * 0.68 +
    Math.sin(elevationM * 0.006 - x * 0.003 + z * 0.004) * 0.32;
  const strataStrength = smoothstep(-0.45, 0.55, strataWave);
  altitudeRock
    .lerp(
      MOUNTAIN_MATERIALS.sedimentBand,
      strataStrength * 0.28 + smoothstep(43, 61, slopeDegrees) * 0.16,
    )
    .lerp(
      MOUNTAIN_MATERIALS.sunWarmedBand,
      smoothstep(0.42, 0.9, strataWave) * 0.19,
    );

  const broadExposure =
    Math.sin(x * 0.004 + z * 0.002) * 0.58 +
    Math.sin(z * 0.003 - x * 0.0014) * 0.42;
  const localSnowLine = 5_850 + broadExposure * 130;
  const snowAltitude = smoothstep(localSnowLine, 7_650, elevationM);
  const gentleSlope = 1 - smoothstep(31, 54, slopeDegrees);
  const pocketRetention = smoothstep(-0.12, 0.34, curvature);
  const windScour = smoothstep(0.28, 0.94, Math.abs(broadExposure));
  const snowRetention = THREE.MathUtils.clamp(
    0.08 + gentleSlope * 0.64 + pocketRetention * 0.24 - windScour * 0.1,
    0.05,
    0.94,
  );
  const snowAmount = THREE.MathUtils.clamp(
    snowAltitude * snowRetention,
    0,
    1,
  );
  const iceAmount =
    smoothstep(5_650, 7_200, elevationM) *
    (0.34 + gentleSlope * 0.66) *
    (0.56 + pocketRetention * 0.44) *
    (1 - snowAmount) *
    0.58;
  const color = altitudeRock
    .lerp(MOUNTAIN_MATERIALS.blueIce, iceAmount)
    .lerp(MOUNTAIN_MATERIALS.snow, snowAmount);
  const mineralVariation =
    (hashNoise(x, z, 19) - 0.5) * 0.012 + strataWave * 0.008;
  color.offsetHSL(
    mineralVariation * 0.08,
    mineralVariation * 0.1,
    mineralVariation,
  );
  return color.multiplyScalar(shade);
}

function downsampleDemLayer(layer: DemLayer, stride: number): DemLayer {
  if (stride <= 1) return layer;
  const source = layer.metadata;
  const width = Math.floor(source.width / stride);
  const height = Math.floor(source.height / stride);
  const elevations = new Int16Array(width * height);

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      let total = 0;
      for (let sampleRow = 0; sampleRow < stride; sampleRow += 1) {
        for (
          let sampleColumn = 0;
          sampleColumn < stride;
          sampleColumn += 1
        ) {
          const sourceRow = row * stride + sampleRow;
          const sourceColumn = column * stride + sampleColumn;
          total +=
            layer.elevations[sourceRow * source.width + sourceColumn];
        }
      }
      elevations[row * width + column] = Math.round(
        total / (stride * stride),
      );
    }
  }

  return {
    elevations,
    metadata: {
      ...source,
      displayResolutionM: source.displayResolutionM * stride,
      sampleSpacingArcSeconds: source.sampleSpacingArcSeconds * stride,
      width,
      height,
    },
  };
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
    minimumSideLevels = 1,
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
    const syntheticDetail =
      metadata.lod === "core"
        ? (hashNoise(column, row, 101) - 0.5) * 0.34 +
          Math.sin(column * 0.31 + row * 0.19) * 0.08
        : 0;
    levels[index] = Math.max(
      0,
      Math.round(
        (elevations[index] - BASE_ELEVATION_M) / verticalStepM +
          syntheticDetail,
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
      const neighborIndices = [
        column < width - 1 ? index + 1 : -1,
        column > 0 ? index - 1 : -1,
        row < height - 1 ? index + width : -1,
        row > 0 ? index - width : -1,
      ];
      for (const neighborIndex of neighborIndices) {
        if (neighborIndex < 0 || !included[neighborIndex]) continue;
        const difference = Math.max(0, level - levels[neighborIndex]);
        faceCount +=
          difference < minimumSideLevels
            ? 0
            : detailedSides
              ? difference
              : 1;
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

  const writeFace = (
    vertices: ArrayLike<number>,
    color: THREE.Color,
  ) => {
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
    indices.set(
      [
        vertexOffset,
        vertexOffset + 1,
        vertexOffset + 2,
        vertexOffset,
        vertexOffset + 2,
        vertexOffset + 3,
      ],
      indexOffset,
    );
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
      const curvature =
        ((leftElevation +
          rightElevation +
          northElevation +
          southElevation) /
          4 -
          elevationM) /
        Math.max(1, metadata.displayResolutionM);
      const normalLength = Math.hypot(gradientX, 1, gradientZ);
      const sunDot = THREE.MathUtils.clamp(
        (-gradientX * -0.38 + 0.86 + -gradientZ * -0.34) /
          normalLength,
        0,
        1,
      );
      const topShade = 0.82 + sunDot * 0.18;
      writeFace(
        [x0, yTop, z0, x0, yTop, z1, x1, yTop, z1, x1, yTop, z0],
        terrainColor(
          elevationM,
          slopeDegrees,
          curvature,
          noiseColumn,
          noiseRow,
          topShade,
        ),
      );

      const sides = [
        {
          neighborIndex: column < width - 1 ? index + 1 : -1,
          shade: 0.86,
          vertices: (y0: number, y1: number) =>
            [x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1] as const,
        },
        {
          neighborIndex: column > 0 ? index - 1 : -1,
          shade: 0.76,
          vertices: (y0: number, y1: number) =>
            [x0, y0, z1, x0, y1, z1, x0, y1, z0, x0, y0, z0] as const,
        },
        {
          neighborIndex: row < height - 1 ? index + width : -1,
          shade: 0.81,
          vertices: (y0: number, y1: number) =>
            [x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1] as const,
        },
        {
          neighborIndex: row > 0 ? index - width : -1,
          shade: 0.7,
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
        if (level - neighborLevel < minimumSideLevels) continue;
        if (detailedSides) {
          for (let layer = neighborLevel + 1; layer <= level; layer += 1) {
            const y0 = layer * blockSize + yOffset;
            const y1 = (layer + 1) * blockSize + yOffset;
            writeFace(
              side.vertices(y0, y1),
              terrainColor(
                elevationM,
                slopeDegrees,
                curvature,
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
              curvature,
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

function createMetricInspection(
  core: DemLayer,
  feed: ObservatoryFeed,
) {
  const { metadata } = core;
  const center = feed.currentHighestPoint;
  const degreesPerSample = metadata.sampleSpacingArcSeconds / 3600;
  const centerColumn = THREE.MathUtils.clamp(
    Math.round(
      ((center?.longitude ?? ORIGIN_LONGITUDE) - metadata.bounds.west) /
        degreesPerSample -
        0.5,
    ),
    1,
    metadata.width - 2,
  );
  const centerRow = THREE.MathUtils.clamp(
    Math.round(
      (metadata.bounds.north - (center?.latitude ?? ORIGIN_LATITUDE)) /
        degreesPerSample -
        0.5,
    ),
    1,
    metadata.height - 2,
  );
  const centerIndex = centerRow * metadata.width + centerColumn;
  const gradientX =
    (core.elevations[centerIndex + 1] -
      core.elevations[centerIndex - 1]) /
    Math.max(1, metadata.displayResolutionM * 2);
  const gradientZ =
    (core.elevations[centerIndex + metadata.width] -
      core.elevations[centerIndex - metadata.width]) /
    Math.max(1, metadata.displayResolutionM * 2);
  const slopeDegrees =
    (Math.atan(Math.hypot(gradientX, gradientZ)) * 180) / Math.PI;
  const centerWorldX = center?.x ?? 0;
  const centerWorldZ = center?.z ?? 0;
  const centerRelief = syntheticReliefM(centerWorldX, centerWorldZ);
  const group = new THREE.Group();
  const cellCount = INSPECTION_GRID_CELLS * INSPECTION_GRID_CELLS;
  const cellGeometry = new THREE.BoxGeometry(
    INSPECTION_CELL_M * 0.965,
    INSPECTION_CELL_M,
    INSPECTION_CELL_M * 0.965,
  );
  const dummy = new THREE.Object3D();
  const halfGrid = Math.floor(INSPECTION_GRID_CELLS / 2);
  const snowMatrices: THREE.Matrix4[] = [];
  const iceMatrices: THREE.Matrix4[] = [];
  const scouredMatrices: THREE.Matrix4[] = [];

  for (let row = 0; row < INSPECTION_GRID_CELLS; row += 1) {
    for (let column = 0; column < INSPECTION_GRID_CELLS; column += 1) {
      const localX = (column - halfGrid) * INSPECTION_CELL_M;
      const localZ = (row - halfGrid) * INSPECTION_CELL_M;
      const worldX = centerWorldX + localX;
      const worldZ = centerWorldZ + localZ;
      const relief =
        syntheticReliefM(worldX, worldZ) -
        centerRelief;
      const topY =
        Math.floor(relief / INSPECTION_CELL_M) * INSPECTION_CELL_M;
      dummy.position.set(localX, topY - INSPECTION_CELL_M / 2, localZ);
      dummy.updateMatrix();

      const deposition =
        0.38 +
        Math.sin(worldX * 0.72 - worldZ * 0.34) * 0.2 +
        smoothstep(-0.18, 0.12, -relief) * 0.38;
      const targetMatrices =
        deposition > 0.72
          ? snowMatrices
          : deposition > 0.38
            ? iceMatrices
            : scouredMatrices;
      targetMatrices.push(dummy.matrix.clone());
    }
  }
  const surfaceMeshes = [
    {
      matrices: scouredMatrices,
      material: new THREE.MeshLambertMaterial({
        color: "#445456",
      }),
    },
    {
      matrices: iceMatrices,
      material: new THREE.MeshLambertMaterial({
        color: "#76949b",
      }),
    },
    {
      matrices: snowMatrices,
      material: new THREE.MeshLambertMaterial({
        color: "#b9c4c1",
      }),
    },
  ].map(({ matrices, material }) => {
    const mesh = new THREE.InstancedMesh(
      cellGeometry,
      material,
      matrices.length,
    );
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    return mesh;
  });

  const stoneGeometry = new THREE.BoxGeometry(
    INSPECTION_CELL_M,
    INSPECTION_CELL_M,
    INSPECTION_CELL_M,
  );
  const stoneMaterial = new THREE.MeshBasicMaterial({
    color: MOUNTAIN_MATERIALS.placedGranite,
  });
  const stone = new THREE.Mesh(stoneGeometry, stoneMaterial);
  stone.position.set(0, INSPECTION_CELL_M / 2, 0);
  group.add(stone);

  const stoneOutlineGeometry = new THREE.EdgesGeometry(stoneGeometry);
  const stoneOutlineMaterial = new THREE.LineBasicMaterial({
    color: MOUNTAIN_MATERIALS.summitSignal,
    transparent: true,
    opacity: 0.9,
  });
  const stoneOutline = new THREE.LineSegments(
    stoneOutlineGeometry,
    stoneOutlineMaterial,
  );
  stone.add(stoneOutline);

  const scaleGroup = new THREE.Group();
  const scaleMaterial = new THREE.MeshBasicMaterial({ color: "#72e9ff" });
  const scaleBar = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.025, 0.025),
    scaleMaterial,
  );
  scaleBar.position.set(0, 0, 0);
  scaleGroup.add(scaleBar);
  for (let tick = 0; tick <= 5; tick += 1) {
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.018, tick % 5 === 0 ? 0.14 : 0.08, 0.018),
      scaleMaterial,
    );
    marker.position.set(-0.5 + tick * INSPECTION_CELL_M, 0.04, 0);
    scaleGroup.add(marker);
  }
  scaleGroup.position.set(0, 1.15, 2.8);
  group.add(scaleGroup);

  return {
    group,
    cellCount,
    slopeDegrees,
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
  lateralOffset: number,
  returned: boolean,
  suppliedTrace?: Array<{ column: number; row: number }> | null,
) {
  if (suppliedTrace && suppliedTrace.length >= 2) {
    return suppliedTrace.map((point) =>
      gridPoint(terrain, point.column, point.row),
    );
  }
  const startColumn = terrain.width * 0.25 + lateralOffset * 4;
  const startRow = terrain.height - 18;
  const route: THREE.Vector3[] = [];
  const steps = 104;

  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const bend = Math.sin(t * Math.PI) * lateralOffset * 17;
    const column = THREE.MathUtils.lerp(
      startColumn,
      terrain.peakColumn,
      t,
    ) + bend;
    const row =
      THREE.MathUtils.lerp(startRow, terrain.peakRow, t) +
      Math.sin(t * Math.PI * 2) * lateralOffset * 4;
    route.push(gridPoint(terrain, column, row));
  }

  return returned
    ? [...route, ...route.slice(0, -1).reverse()]
    : route;
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
      ? new THREE.Color("#72e9ff")
      : safeReserve > 0.18
        ? new THREE.Color("#ffc86b")
        : new THREE.Color("#ff794d");

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
  const renderMetricsHost = useRef<HTMLSpanElement>(null);
  const activeExpeditionRef = useRef(0);
  const manualReplayUntil = useRef(0);
  const manualReplayStarted = useRef(0);
  const [activeExpedition, setActiveExpedition] = useState(0);
  const [rankingsOpen, setRankingsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("mountain");
  const [skyPhase, setSkyPhase] = useState<SkyPhase>(() =>
    kathmanduSkyPhase(),
  );
  const [sceneStatus, setSceneStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [feed, setFeed] = useState(fallbackObservatoryFeed);
  const expeditions = feed.recentExpeditions;
  const leaderboard = feed.leaderboard;
  const memorialClusters =
    feed.memorialClusters ?? EMPTY_MEMORIAL_CLUSTERS;

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
        firstLoad = false;
        if (!interval) {
          interval = window.setInterval(refresh, result.pollIntervalMs);
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
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

      const scene = new THREE.Scene();
      const alpinePalette = SKY_PHASES[skyPhase];
      scene.fog = new THREE.FogExp2(
        alpinePalette.fog,
        viewMode === "inspect" ? 0.018 : 0.0032,
      );

      const camera = new THREE.PerspectiveCamera(
        43,
        host.clientWidth / host.clientHeight,
        viewMode === "inspect" ? 0.02 : 0.1,
        viewMode === "inspect" ? 80 : 1_400,
      );
      camera.position.set(
        viewMode === "inspect" ? 4.4 : 60,
        viewMode === "inspect" ? 3.5 : 118,
        viewMode === "inspect" ? 5.6 : 145,
      );

      const renderer = new THREE.WebGLRenderer({
        antialias: viewMode === "inspect",
        alpha: true,
        powerPreference: "high-performance",
      });
      renderer.setClearColor(0x000000, 0);
      const maximumPixelRatio = viewMode === "inspect" ? 1.4 : 1.25;
      const minimumPixelRatio = viewMode === "inspect" ? 0.8 : 0.62;
      let adaptivePixelRatio = Math.min(
        window.devicePixelRatio,
        maximumPixelRatio,
      );
      renderer.setPixelRatio(adaptivePixelRatio);
      renderer.setSize(host.clientWidth, host.clientHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = alpinePalette.exposure;
      renderer.domElement.setAttribute(
        "aria-label",
        "Interactive voxel rendering of Mount Everest derived from Copernicus GLO-30 elevation data.",
      );
      renderer.domElement.setAttribute("role", "application");
      renderer.domElement.tabIndex = 0;
      host.appendChild(renderer.domElement);

      let performanceWindowStarted = 0;
      let performanceFrames = 0;
      const sampleFramePerformance = (time: number, detailLabel: string) => {
        if (performanceWindowStarted === 0) performanceWindowStarted = time;
        performanceFrames += 1;
        const elapsed = time - performanceWindowStarted;
        if (elapsed < 1_000) return;
        const fps = Math.round((performanceFrames * 1_000) / elapsed);
        const targetPixelRatio =
          fps < 48
            ? Math.max(minimumPixelRatio, adaptivePixelRatio - 0.1)
            : fps > 58
              ? Math.min(maximumPixelRatio, adaptivePixelRatio + 0.05)
              : adaptivePixelRatio;
        if (Math.abs(targetPixelRatio - adaptivePixelRatio) > 0.01) {
          adaptivePixelRatio = targetPixelRatio;
          renderer.setPixelRatio(adaptivePixelRatio);
        }
        if (renderMetricsHost.current) {
          const triangles = renderer.info.render.triangles;
          const triangleLabel =
            triangles >= 1_000_000
              ? `${(triangles / 1_000_000).toFixed(1)}M TRI`
              : `${Math.round(triangles / 1_000)}K TRI`;
          renderMetricsHost.current.dataset.fps = String(fps);
          renderMetricsHost.current.textContent = `${detailLabel} · ${triangleLabel} · AUTO ${adaptivePixelRatio.toFixed(2)}X`;
        }
        performanceWindowStarted = time;
        performanceFrames = 0;
      };

      const ambientLight = new THREE.HemisphereLight(
        alpinePalette.skyLight,
        alpinePalette.ground,
        alpinePalette.ambientIntensity,
      );
      const sunLight = new THREE.DirectionalLight(
        alpinePalette.sunLight,
        alpinePalette.sunIntensity,
      );
      sunLight.position.set(90, 145, 65);
      sunLight.target.position.set(-12, 26, -18);
      scene.add(ambientLight, sunLight, sunLight.target);

      if (viewMode === "inspect") {
        const inspection = createMetricInspection(core, feed);
        scene.add(inspection.group);
        ambientLight.intensity = 1.2;
        sunLight.intensity = 1.3;
        sunLight.position.set(5, 9, 6);
        sunLight.target.position.set(0, 0, 0);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(0, 0.05, 0);
        controls.enableDamping = true;
        controls.dampingFactor = 0.07;
        controls.enablePan = true;
        controls.screenSpacePanning = true;
        controls.minDistance = 0.65;
        controls.maxDistance = 13;
        controls.minPolarAngle = 0.18;
        controls.maxPolarAngle = 1.48;
        controls.update();
        renderer.render(scene, camera);
        setSceneStatus("ready");

        let frame = 0;
        const render = (time: number) => {
          controls.update();
          sampleFramePerformance(
            time,
            `20 CM · ${inspection.cellCount.toLocaleString("en-US")} CELLS · ${Math.round(inspection.slopeDegrees)}° DEM`,
          );
          renderer.render(scene, camera);
          frame = requestAnimationFrame(render);
        };
        frame = requestAnimationFrame(render);

        const observer = new ResizeObserver(() => {
          const width = host.clientWidth;
          const height = host.clientHeight;
          if (width === 0 || height === 0) return;
          renderer.setSize(width, height);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        });
        observer.observe(host);

        cleanupScene = () => {
          cancelAnimationFrame(frame);
          observer.disconnect();
          controls.dispose();
          inspection.dispose();
          renderer.dispose();
          if (host.contains(renderer.domElement)) {
            host.removeChild(renderer.domElement);
          }
        };
        return;
      }

      const renderedCore = downsampleDemLayer(core, 2);
      const renderedMid = downsampleDemLayer(mid, 3);
      const renderedFar = downsampleDemLayer(far, 3);
      const farTerrain = createVoxelTerrain(
        renderedFar.elevations,
        renderedFar.metadata,
        {
          holeBounds: renderedMid.metadata.bounds,
          overlapCells: 3.5,
          yOffset: -0.08,
          detailedSides: false,
        },
      );
      const midTerrain = createVoxelTerrain(
        renderedMid.elevations,
        renderedMid.metadata,
        {
          holeBounds: renderedCore.metadata.bounds,
          overlapCells: 5.5,
          yOffset: -0.035,
          detailedSides: false,
          edgeFeatherCells: 8,
        },
      );
      const terrain = createVoxelTerrain(
        renderedCore.elevations,
        renderedCore.metadata,
        {
          edgeFeatherCells: 12,
          detailedSides: false,
        },
      );
      const terrainLayers = [farTerrain, midTerrain, terrain];
      terrainLayers.forEach((layer) => {
        (layer.mesh.material as THREE.MeshBasicMaterial).color.set(
          alpinePalette.terrainTint,
        );
        scene.add(layer.mesh);
      });

      const siteObjects = sites
        .map((site) => {
          const layer =
            containsCoordinate(
              core.metadata.bounds,
              site.latitude,
              site.longitude,
            )
              ? { terrain, metadata: renderedCore.metadata }
              : containsCoordinate(
                    renderedMid.metadata.bounds,
                    site.latitude,
                    site.longitude,
                  )
                ? { terrain: midTerrain, metadata: renderedMid.metadata }
                : { terrain: farTerrain, metadata: renderedFar.metadata };
          const point = coordinatePoint(
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

      const peakLevel =
        terrain.levels[terrain.peakRow * terrain.width + terrain.peakColumn];
      const target = gridPoint(
        terrain,
        terrain.peakColumn,
        terrain.peakRow,
        -Math.round(peakLevel * 0.36),
      );
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.copy(target);
      controls.enableDamping = true;
      controls.dampingFactor = 0.055;
      controls.enablePan = false;
      controls.minDistance = 22;
      controls.maxDistance = 280;
      controls.minPolarAngle = 0.48;
      controls.maxPolarAngle = 1.42;
      controls.autoRotate = false;
      let interactionRestore = 0;
      const reduceInteractionLoad = () => {
        window.clearTimeout(interactionRestore);
        farTerrain.mesh.visible = false;
        midTerrain.mesh.visible = false;
        renderer.setPixelRatio(Math.min(adaptivePixelRatio, 0.68));
      };
      const restoreInteractionContext = () => {
        window.clearTimeout(interactionRestore);
        interactionRestore = window.setTimeout(() => {
          farTerrain.mesh.visible = true;
          midTerrain.mesh.visible = true;
          renderer.setPixelRatio(adaptivePixelRatio);
        }, 120);
      };
      controls.addEventListener("start", reduceInteractionLoad);
      controls.addEventListener("end", restoreInteractionContext);

      const traceObjects = expeditions.map((expedition, index) => {
        const points = createRoute(
          terrain,
          (index - 1) * 1.15,
          expedition.returned,
          expedition.trace,
        );
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

        return {
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
        };
      });

      const memorialPoints = memorialClusters.map((cluster) => {
        const layer =
          containsCoordinate(
            core.metadata.bounds,
            cluster.latitude,
            cluster.longitude,
          )
            ? { terrain, metadata: renderedCore.metadata }
              : containsCoordinate(
                    renderedMid.metadata.bounds,
                    cluster.latitude,
                    cluster.longitude,
                  )
                ? { terrain: midTerrain, metadata: renderedMid.metadata }
                : { terrain: farTerrain, metadata: renderedFar.metadata };
        return coordinatePoint(
          layer.terrain,
          layer.metadata,
          cluster.latitude,
          cluster.longitude,
        );
      });
      const memorialField = createMemorialField(
        memorialClusters,
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

      controls.update();
      renderer.render(scene, camera);
      setSceneStatus("ready");

      let frame = 0;
      let labelFrame = 0;
      const started = performance.now();
      const render = (time: number) => {
        const seconds = Math.max(0, (time - started) / 1000);
        controls.update();
        sampleFramePerformance(time, "60 / 270 / 900 M");

        const manualPlayback = time < manualReplayUntil.current;
        const nextActive = manualPlayback
          ? activeExpeditionRef.current
          : Math.floor(seconds / REPLAY_SECONDS) % expeditions.length;
        if (activeExpeditionRef.current !== nextActive) {
          activeExpeditionRef.current = nextActive;
          setActiveExpedition(nextActive);
        }
        const activeSeconds = manualPlayback
          ? Math.max(0, (time - manualReplayStarted.current) / 1000)
          : seconds;
        const rawPhase = positiveModulo(
          activeSeconds / REPLAY_SECONDS,
          1,
        );

        traceObjects.forEach((trace, index) => {
          const isActive = nextActive === index;
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
          const stride = Math.sin(seconds * 10.5 + index);
          trace.group.position.y += Math.abs(stride) * 0.035;
          trace.leftLeg.rotation.x = stride * 0.42;
          trace.rightLeg.rotation.x = -stride * 0.42;
          trace.material.opacity = isActive ? 0.94 : 0.14;
          trace.breadcrumbMaterial.opacity = isActive ? 0.86 : 0.1;
          const ended = isActive && rawPhase > 0.92;
          trace.materials.forEach((material) => {
            material.opacity = ended ? 0.28 : isActive ? 1 : 0;
          });
          trace.group.visible = isActive;
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
          const haloPulse = (Math.sin(seconds * 4.2) + 1) / 2;
          trace.enduranceHalo.group.visible = isActive && !ended;
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

        labelFrame += 1;
        if (labelFrame % 2 === 0) {
          const cameraDistance = camera.position.distanceTo(controls.target);
          const minimumPriority =
            cameraDistance > 145 ? 2 : cameraDistance > 82 ? 1 : 0;
          const occupied: Array<{
            left: number;
            right: number;
            top: number;
            bottom: number;
          }> = [];
          prioritizedSiteObjects.forEach((siteObject) => {
            const priority = sitePriority(siteObject.site);
            const projected = siteObject.labelPoint.clone().project(camera);
            const inView =
              projected.z > -1 &&
              projected.z < 1 &&
              projected.x > -1.08 &&
              projected.x < 1.08 &&
              projected.y > -1.08 &&
              projected.y < 1.08;
            if (!inView || priority < minimumPriority) {
              siteObject.label.style.opacity = "0";
              siteObject.label.style.visibility = "hidden";
              return;
            }
            const width =
              siteObject.site.kind === "SUMMIT"
                ? 198
                : siteObject.site.name.length > 18
                  ? 188
                  : 150;
            const height = 50;
            const x = THREE.MathUtils.clamp(
              (projected.x * 0.5 + 0.5) * host.clientWidth,
              width / 2 + 12,
              host.clientWidth - width / 2 - 12,
            );
            const y = THREE.MathUtils.clamp(
              (-projected.y * 0.5 + 0.5) * host.clientHeight,
              height + 88,
              host.clientHeight - 120,
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
              0.18 + Math.sin(seconds * 1.6 + priority) * 0.08;
          });
        }

        renderer.render(scene, camera);
        frame = requestAnimationFrame(render);
      };
      frame = requestAnimationFrame(render);

      const observer = new ResizeObserver(() => {
        const width = host.clientWidth;
        const height = host.clientHeight;
        if (width === 0 || height === 0) return;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      });
      observer.observe(host);

      cleanupScene = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        window.clearTimeout(interactionRestore);
        controls.removeEventListener("start", reduceInteractionLoad);
        controls.removeEventListener("end", restoreInteractionContext);
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
  }, [expeditions, feed, memorialClusters, skyPhase, viewMode]);

  const active = expeditions[activeExpedition % expeditions.length];
  const selectReplay = (index: number, now: number) => {
    activeExpeditionRef.current = index;
    manualReplayStarted.current = now;
    manualReplayUntil.current = now + REPLAY_SECONDS * 1000;
    setActiveExpedition(index);
  };

  return (
    <main
      className="observatory"
      data-sky={skyPhase}
      data-view={viewMode}
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
          {sceneStatus === "ready"
            ? "LIVE"
            : sceneStatus === "error"
              ? "DEM ERROR"
              : "LOADING DEM"}
        </div>
        <button
          className="inspect-trigger"
          type="button"
          aria-pressed={viewMode === "inspect"}
          onClick={() => {
            setSceneStatus("loading");
            setRankingsOpen(false);
            setViewMode((mode) =>
              mode === "mountain" ? "inspect" : "mountain",
            );
          }}
        >
          {viewMode === "inspect" ? "MOUNTAIN" : "20 CM"}
        </button>
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

      {viewMode === "inspect" ? (
        <section className="inspection-readout" aria-label="Metric inspection">
          <small>LOCAL INSPECTION</small>
          <strong>CURRENT HIGHEST STONE</strong>
          <span>
            TRUE SIZE <b>0.20 M</b>
          </span>
          <span>
            WINDOW <b>8.20 × 8.20 M</b>
          </span>
          <p>
            SURFACE-NORMAL FRAME · CANONICAL RELIEF · ONE THREE.JS UNIT
            EQUALS ONE METER
          </p>
        </section>
      ) : null}

      <aside className="expedition-card" aria-label="Last expedition trace">
        <div className="expedition-card-heading">
          <span
            className="route-swatch"
            style={{
              background: active.color,
              boxShadow: `0 0 22px ${active.color}`,
            }}
          />
          <small>LAST TRACE</small>
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

      <nav
        className="replay-dock"
        ref={replayProgressHost}
        aria-label="Expedition replay"
      >
        <div className="replay-progress" aria-hidden="true">
          <i />
        </div>
        <div className="replay-title">
          <small>LIVE REPLAY</small>
          <strong>ONE SIGNAL AT A TIME</strong>
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
          <small>ALL-TIME</small>
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
          {viewMode === "inspect"
            ? "DRAG · PAN · INSPECT STONE"
            : "DRAG · ZOOM"}
        </span>
        <i />
      </div>

      <div className="render-metrics" aria-live="off">
        <i />
        <span ref={renderMetricsHost}>
          {viewMode === "inspect"
            ? "20 CM · CALIBRATING"
            : "60 / 270 / 900 M · CALIBRATING"}
        </span>
      </div>

      <div
        className="dem-credit"
        title="produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved"
      >
        {viewMode === "inspect"
          ? "AE-SURFACE-V1 · 20 CM CANONICAL CELL"
          : "COPERNICUS GLO-30 · 30 M SOURCE · 60 / 270 / 900 M RENDER LOD"}
      </div>
    </main>
  );
}
