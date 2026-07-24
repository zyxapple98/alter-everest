import { TERRAIN } from "./constants";
import { voxelKey } from "./mutation";
import type { TerrainOracle } from "./terrain";
import type { VoxelCoordinate } from "./types";

function hash2(x: number, z: number, seed: number) {
  let value =
    Math.imul(x, 0x1f123bb5) ^
    Math.imul(z, 0x5f356495) ^
    seed;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffff_ffff;
}

function fade(value: number) {
  return value * value * (3 - 2 * value);
}

function valueNoise(x: number, z: number, scaleM: number, octave: number) {
  const gx = x / scaleM;
  const gz = z / scaleM;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const tx = fade(gx - x0);
  const tz = fade(gz - z0);
  const seed = TERRAIN.naturalizationSeed + octave * 0x9e3779b9;
  const n00 = hash2(x0, z0, seed);
  const n10 = hash2(x0 + 1, z0, seed);
  const n01 = hash2(x0, z0 + 1, seed);
  const n11 = hash2(x0 + 1, z0 + 1, seed);
  const north = n00 + (n10 - n00) * tx;
  const south = n01 + (n11 - n01) * tx;
  return north + (south - north) * tz;
}

export function syntheticReliefM(x: number, z: number) {
  const raw =
    (valueNoise(x, z, 6.4, 0) - 0.5) * 0.46 +
    (valueNoise(x, z, 1.6, 1) - 0.5) * 0.24 +
    (valueNoise(x, z, 0.4, 2) - 0.5) * 0.14;
  return Math.max(
    -TERRAIN.maximumSyntheticReliefM,
    Math.min(TERRAIN.maximumSyntheticReliefM, raw),
  );
}

export function baseTopVoxel(
  oracle: TerrainOracle,
  columnX: number,
  columnZ: number,
) {
  const x = (columnX + 0.5) * TERRAIN.voxelEdgeM;
  const z = (columnZ + 0.5) * TERRAIN.voxelEdgeM;
  const truth = oracle.sample(x, z);
  if (!truth) return null;
  return Math.floor(
    (truth.y + syntheticReliefM(x, z)) / TERRAIN.voxelEdgeM,
  );
}

export function currentTopVoxel(
  oracle: TerrainOracle,
  removed: readonly VoxelCoordinate[],
  columnX: number,
  columnZ: number,
) {
  const base = baseTopVoxel(oracle, columnX, columnZ);
  if (base === null) return null;
  const removedKeys = new Set(removed.map(voxelKey));
  let top = base;
  while (removedKeys.has(voxelKey({ x: columnX, y: top, z: columnZ }))) {
    top -= 1;
  }
  return top;
}

export function isExposedTerrainVoxel(
  oracle: TerrainOracle,
  removed: readonly VoxelCoordinate[],
  voxel: VoxelCoordinate,
) {
  return currentTopVoxel(oracle, removed, voxel.x, voxel.z) === voxel.y;
}

export function chunkForVoxel(voxel: VoxelCoordinate) {
  const voxelsPerChunk = TERRAIN.physicsChunkEdgeM / TERRAIN.voxelEdgeM;
  return {
    x: Math.floor(voxel.x / voxelsPerChunk),
    z: Math.floor(voxel.z / voxelsPerChunk),
  };
}

export function tileForVoxel(voxel: VoxelCoordinate) {
  const voxelsPerTile = TERRAIN.streamTileEdgeM / TERRAIN.voxelEdgeM;
  return {
    x: Math.floor(voxel.x / voxelsPerTile),
    z: Math.floor(voxel.z / voxelsPerTile),
  };
}
