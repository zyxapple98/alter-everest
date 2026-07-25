import type {
  CandidateCommit,
  CanonicalWorld,
  CommitVerdict,
  ExpeditionRecord,
  TombstoneState,
  ModifiedChunkState,
  ModifiedTileState,
  StoneState,
  VoxelCoordinate,
} from "./types";
import { TERRAIN } from "./constants";
import { chunkForVoxel } from "./surface";
import { operationLabel, voxelKey } from "./mutation";

function hex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function computeWorldHash(world: CanonicalWorld) {
  const canonical = JSON.stringify({
    sequence: world.sequence,
    terrainHash: world.terrainHash,
    baseCamp: world.baseCamp,
    extractionZones: world.extractionZones,
    stones: world.stones,
    identities: world.identities,
    tombstones: world.tombstones,
    expeditions: world.expeditions,
    removedTerrainVoxels: world.removedTerrainVoxels,
    modifiedChunks: world.modifiedChunks,
    modifiedTiles: world.modifiedTiles,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return hex(new Uint8Array(digest));
}

async function sha256Canonical(value: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return hex(new Uint8Array(digest));
}

export async function buildSpatialManifest(
  stones: readonly StoneState[],
  removedTerrainVoxels: readonly VoxelCoordinate[],
) {
  const chunkData = new Map<
    string,
    {
      x: number;
      z: number;
      removedTerrainVoxels: VoxelCoordinate[];
      stones: StoneState[];
    }
  >();
  const chunkAt = (x: number, z: number) => ({
    x: Math.floor(x / TERRAIN.physicsChunkEdgeM),
    z: Math.floor(z / TERRAIN.physicsChunkEdgeM),
  });
  const ensureChunk = (x: number, z: number) => {
    const id = `${x}:${z}`;
    let chunk = chunkData.get(id);
    if (!chunk) {
      chunk = { x, z, removedTerrainVoxels: [], stones: [] };
      chunkData.set(id, chunk);
    }
    return chunk;
  };
  for (const voxel of removedTerrainVoxels) {
    const chunk = chunkForVoxel(voxel);
    ensureChunk(chunk.x, chunk.z).removedTerrainVoxels.push(voxel);
  }
  for (const stone of stones) {
    const chunk = chunkAt(stone.pose.translation.x, stone.pose.translation.z);
    ensureChunk(chunk.x, chunk.z).stones.push(stone);
  }

  const modifiedChunks: ModifiedChunkState[] = [];
  for (const [id, chunk] of [...chunkData.entries()].sort()) {
    chunk.removedTerrainVoxels.sort((a, b) =>
      voxelKey(a).localeCompare(voxelKey(b)),
    );
    chunk.stones.sort((a, b) => a.id.localeCompare(b.id));
    modifiedChunks.push({
      id,
      x: chunk.x,
      z: chunk.z,
      removedTerrainVoxels: chunk.removedTerrainVoxels,
      stoneIds: chunk.stones.map((stone) => stone.id),
      hash: await sha256Canonical({
        x: chunk.x,
        z: chunk.z,
        removedTerrainVoxels: chunk.removedTerrainVoxels,
        stones: chunk.stones,
      }),
    });
  }

  const tileData = new Map<
    string,
    { x: number; z: number; chunks: ModifiedChunkState[] }
  >();
  for (const chunk of modifiedChunks) {
    const tileX = Math.floor(
      (chunk.x * TERRAIN.physicsChunkEdgeM) / TERRAIN.streamTileEdgeM,
    );
    const tileZ = Math.floor(
      (chunk.z * TERRAIN.physicsChunkEdgeM) / TERRAIN.streamTileEdgeM,
    );
    const id = `${tileX}:${tileZ}`;
    const tile = tileData.get(id) ?? { x: tileX, z: tileZ, chunks: [] };
    tile.chunks.push(chunk);
    tileData.set(id, tile);
  }
  const modifiedTiles: ModifiedTileState[] = [];
  for (const [id, tile] of [...tileData.entries()].sort()) {
    tile.chunks.sort((a, b) => a.id.localeCompare(b.id));
    const chunkHashes = tile.chunks.map((chunk) => chunk.hash);
    modifiedTiles.push({
      id,
      x: tile.x,
      z: tile.z,
      chunkHashes,
      hash: await sha256Canonical({
        x: tile.x,
        z: tile.z,
        chunks: tile.chunks.map((chunk) => ({
          id: chunk.id,
          hash: chunk.hash,
        })),
      }),
    });
  }
  return { modifiedChunks, modifiedTiles };
}

export async function applyAcceptedCandidate(
  candidate: CandidateCommit,
  currentWorld: CanonicalWorld,
  verdict: CommitVerdict,
): Promise<CanonicalWorld> {
  if (
    !verdict.accepted ||
    !verdict.route ||
    !verdict.physics ||
    !verdict.nextIdentityStatus ||
    verdict.score === null
  ) {
    throw new Error("Only an accepted, fully evaluated candidate can be applied.");
  }

  const terminal = candidate.proof.route.at(-1)!;
  const identities = currentWorld.identities.filter(
    (identity) => identity.id !== candidate.agentId,
  );
  identities.push({
    id: candidate.agentId,
    status: verdict.nextIdentityStatus,
  });
  identities.sort((a, b) => a.id.localeCompare(b.id));

  const tombstones = [...currentWorld.tombstones];
  if (verdict.nextIdentityStatus === "DEAD") {
    const tombstone: TombstoneState = {
      id: `tombstone-${candidate.id}`,
      agentId: candidate.agentId,
      expeditionId: candidate.id,
      position: { x: terminal.x, y: terminal.y, z: terminal.z },
      altitudeM: terminal.altitudeM,
      enduranceUsed: verdict.route.enduranceUsed,
    };
    tombstones.push(tombstone);
  }

  const actionIndex =
    candidate.proof.mutation.destination.kind === "BASE"
      ? candidate.proof.pickupIndex!
      : candidate.proof.releaseIndex!;
  const actionSample = candidate.proof.route[actionIndex];
  const record: ExpeditionRecord = {
    id: candidate.id,
    agentId: candidate.agentId,
    action: operationLabel(candidate.proof.mutation),
    outcome: verdict.nextIdentityStatus,
    altitudeM: actionSample.altitudeM,
    enduranceUsed: verdict.route.enduranceUsed,
    energyKj: verdict.route.energyKj,
    score: verdict.score,
  };

  const removedTerrainVoxels =
    candidate.proof.mutation.source.kind === "TERRAIN"
      ? [
          ...currentWorld.removedTerrainVoxels,
          candidate.proof.mutation.source.voxel,
        ]
      : currentWorld.removedTerrainVoxels;
  const spatial = await buildSpatialManifest(
    verdict.physics.finalStones,
    removedTerrainVoxels,
  );
  const next: CanonicalWorld = {
    ...currentWorld,
    sequence: currentWorld.sequence + 1,
    stones: verdict.physics.finalStones,
    identities,
    tombstones,
    expeditions: [...currentWorld.expeditions, record],
    removedTerrainVoxels,
    ...spatial,
    worldHash: "",
  };
  next.worldHash = await computeWorldHash(next);
  return next;
}
