import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PHYSICS, TERRAIN } from "../engine/constants";
import { mutationReleasePose, voxelCenter } from "../engine/mutation";
import {
  createDemTerrainOracle,
  type DemMetadataLike,
} from "../engine/terrain";
import { currentTopVoxel } from "../engine/surface";
import type {
  CandidateCommit,
  CanonicalWorld,
  TerrainCollider,
  VoxelCoordinate,
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
  const world = JSON.parse(
    await readFile(resolve(path), "utf8"),
  ) as CanonicalWorld;
  world.removedTerrainVoxels ??= [];
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

function terrainColumnsAt(
  bundle: DemBundle,
  removed: readonly VoxelCoordinate[],
  point: { x: number; z: number },
) {
  const radiusColumns = Math.ceil(
    TERRAIN.localPhysicsRadiusM / TERRAIN.voxelEdgeM,
  );
  const centerColumnX = Math.floor(point.x / TERRAIN.voxelEdgeM);
  const centerColumnZ = Math.floor(point.z / TERRAIN.voxelEdgeM);
  const colliders: TerrainCollider[] = [];
  const floorY = -PHYSICS.worldBoundsM;

  for (
    let columnX = centerColumnX - radiusColumns;
    columnX <= centerColumnX + radiusColumns;
    columnX += 1
  ) {
    for (
      let columnZ = centerColumnZ - radiusColumns;
      columnZ <= centerColumnZ + radiusColumns;
      columnZ += 1
    ) {
      const topVoxel = currentTopVoxel(
        bundle.oracle,
        removed,
        columnX,
        columnZ,
      );
      if (topVoxel === null) continue;
      const topY = (topVoxel + 1) * TERRAIN.voxelEdgeM;
      const center = voxelCenter({ x: columnX, y: topVoxel, z: columnZ });
      const truth = bundle.oracle.sample(center.x, center.z);
      const halfHeight = (topY - floorY) / 2;
      colliders.push({
        kind: "cuboid",
        center: {
          x: center.x,
          y: floorY + halfHeight,
          z: center.z,
        },
        halfExtents: {
          x: TERRAIN.voxelEdgeM / 2,
          y: halfHeight,
          z: TERRAIN.voxelEdgeM / 2,
        },
        friction:
          truth?.surface === "ICE"
            ? PHYSICS.iceFriction
            : PHYSICS.dryRockFriction,
      });
    }
  }
  return colliders;
}

export function terrainPatchesForCandidate(
  bundle: DemBundle,
  world: CanonicalWorld,
  candidate: CandidateCommit,
) {
  const mutation = candidate.proof.mutation;
  const points: Array<{ x: number; z: number }> = [];
  const removed = [...world.removedTerrainVoxels];

  if (mutation.source.kind === "STONE") {
    const sourceStoneId = mutation.source.stoneId;
    const existing = world.stones.find(
      (stone) => stone.id === sourceStoneId,
    );
    if (existing) points.push(existing.pose.translation);
  } else if (mutation.source.kind === "TERRAIN") {
    points.push(voxelCenter(mutation.source.voxel));
    removed.push(mutation.source.voxel);
  }
  const releasePose = mutationReleasePose(mutation);
  if (releasePose) points.push(releasePose.translation);

  const unique = points.filter(
    (point, index) =>
      points.findIndex(
        (candidatePoint) =>
          Math.hypot(
            candidatePoint.x - point.x,
            candidatePoint.z - point.z,
          ) < TERRAIN.localPhysicsRadiusM,
      ) === index,
  );
  const columns = new Map<string, TerrainCollider>();
  for (const point of unique) {
    for (const collider of terrainColumnsAt(bundle, removed, point)) {
      if (collider.kind !== "cuboid") continue;
      columns.set(`${collider.center.x}:${collider.center.z}`, collider);
    }
  }
  return [...columns.values()];
}

export function worldForCandidate(
  world: CanonicalWorld,
  bundle: DemBundle,
  candidate: CandidateCommit,
): CanonicalWorld {
  return {
    ...world,
    terrain: terrainPatchesForCandidate(bundle, world, candidate),
  };
}
