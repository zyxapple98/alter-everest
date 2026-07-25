import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createDemTerrainOracle,
  type DemMetadataLike,
} from "../engine/terrain";
import type {
  CanonicalWorld,
} from "../engine/types";

interface DemMetadata extends DemMetadataLike {
  sha256: string;
}

export interface TerrainConfig {
  terrainHash: string;
  sourceHash: string;
  metadataPath: string;
  elevationPath: string;
  sitesPath: string;
  registration: {
    originLatitude: number;
    originLongitude: number;
    verticalDatumM: number;
    originRow: number;
    originColumn: number;
  };
  naturalization: {
    version: string;
    seed: number;
    voxelEdgeM: number;
    physicsChunkEdgeM: number;
    streamTileEdgeM: number;
    maximumSyntheticReliefM: number;
  };
}

export interface DemBundle {
  metadata: DemMetadata;
  elevations: Int16Array;
  config: TerrainConfig;
  oracle: ReturnType<typeof createDemTerrainOracle>;
}

export function terrainAuthorityHash(
  config: Omit<TerrainConfig, "terrainHash">,
) {
  const authority = {
    sourceHash: config.sourceHash,
    registration: config.registration,
    naturalization: config.naturalization,
  };
  return createHash("sha256")
    .update(JSON.stringify(authority))
    .digest("hex");
}

export async function loadTerrainConfig(
  path = resolve("world", "terrain.json"),
): Promise<TerrainConfig> {
  return JSON.parse(await readFile(resolve(path), "utf8")) as TerrainConfig;
}

export async function loadCanonicalWorld(
  path = resolve("world", "snapshot.json"),
): Promise<CanonicalWorld> {
  const parsed = JSON.parse(
    await readFile(resolve(path), "utf8"),
  ) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Canonical world must be a JSON object.");
  }
  const record = parsed as Record<string, unknown>;
  if (Object.hasOwn(record, "terrain")) {
    throw new Error(
      "Legacy terrain collider state is not valid in protocol 0.5.0.",
    );
  }
  const validCell = (value: unknown) =>
    Boolean(
      value &&
        typeof value === "object" &&
        ["x", "y", "z"].every((axis) =>
          Number.isSafeInteger(
            (value as Record<string, unknown>)[axis],
          ),
        ),
    );
  if (
    !Array.isArray(record.stones) ||
    record.stones.some(
      (stone) =>
        !stone ||
        typeof stone !== "object" ||
        typeof (stone as Record<string, unknown>).id !== "string" ||
        !validCell((stone as Record<string, unknown>).cell),
    ) ||
    !Array.isArray(record.removedTerrainVoxels) ||
    record.removedTerrainVoxels.some((voxel) => !validCell(voxel))
  ) {
    throw new Error(
      "Canonical matter must use integer stone cells and terrain voxels.",
    );
  }
  const world = parsed as CanonicalWorld;
  return world;
}

export async function loadDemBundle(
  terrainConfigPath?: string,
): Promise<DemBundle> {
  const config = await loadTerrainConfig(terrainConfigPath);
  const [metadataText, bytes] = await Promise.all([
    readFile(resolve(config.metadataPath), "utf8"),
    readFile(resolve(config.elevationPath)),
  ]);
  const metadata = JSON.parse(metadataText) as DemMetadata;
  const sourceHash = createHash("sha256").update(bytes).digest("hex");
  const expectedTerrainHash = terrainAuthorityHash({
    sourceHash: config.sourceHash,
    metadataPath: config.metadataPath,
    elevationPath: config.elevationPath,
    sitesPath: config.sitesPath,
    registration: config.registration,
    naturalization: config.naturalization,
  });
  if (
    sourceHash !== config.sourceHash ||
    sourceHash !== metadata.sha256 ||
    expectedTerrainHash !== config.terrainHash
  ) {
    throw new Error(
      "The DEM bytes or deterministic surface rules do not match the canonical terrain authority.",
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const elevations = new Int16Array(bytes.byteLength / 2);
  for (let index = 0; index < elevations.length; index += 1) {
    elevations[index] = view.getInt16(index * 2, true);
  }
  return {
    metadata,
    elevations,
    config,
    oracle: createDemTerrainOracle(metadata, elevations, config.registration),
  };
}
