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
import { CANDIDATE_LIMITS, TERRAIN } from "./constants";
import {
  applyAlterationFacts,
  buildFootprints,
} from "./footprint";
import { stancePoint } from "./movement";
import { iterateRouteTransitions } from "./route-codec";
import { chunkForVoxel } from "./surface";
import {
  operationLabel,
  operationSummary,
  voxelKey,
} from "./mutation";

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
    alterations: world.alterations,
    footprints: world.footprints,
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
    const chunk = chunkForVoxel(stone.cell);
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
    !verdict.footprintDelta
  ) {
    throw new Error("Only an accepted, fully evaluated candidate can be applied.");
  }

  let terminalCell = { ...candidate.proof.route.start };
  for (const transition of iterateRouteTransitions(
    candidate.proof.route,
    {
      maximumSteps: CANDIDATE_LIMITS.maximumDecodedRouteSteps,
      requireCanonical: true,
    },
  )) {
    terminalCell = transition.to.cell;
  }
  const terminal = stancePoint(terminalCell);
  const existingIdentity = currentWorld.identities.find(
    (identity) =>
      identity.id.toLowerCase() === candidate.agentId.toLowerCase(),
  );
  const canonicalAgentId = existingIdentity?.id ?? candidate.agentId;
  const canonicalCandidate = {
    ...candidate,
    agentId: canonicalAgentId,
  };
  const identities = currentWorld.identities.filter(
    (identity) =>
      identity.id.toLowerCase() !== canonicalAgentId.toLowerCase(),
  );
  identities.push({
    id: canonicalAgentId,
    status: verdict.nextIdentityStatus,
  });
  identities.sort((a, b) => a.id.localeCompare(b.id));

  const tombstones = [...currentWorld.tombstones];
  if (verdict.nextIdentityStatus === "DEAD") {
    const tombstone: TombstoneState = {
      id: `tombstone-${candidate.id}`,
      agentId: canonicalAgentId,
      expeditionId: candidate.id,
      position: { x: terminal.x, y: terminal.y, z: terminal.z },
      altitudeM: verdict.route.terminalAltitudeM,
      enduranceUsed: verdict.route.enduranceUsed,
    };
    tombstones.push(tombstone);
  }

  const operations = candidate.proof.actions.map(operationLabel);
  const record: ExpeditionRecord = {
    id: candidate.id,
    agentId: canonicalAgentId,
    action: operationSummary(candidate.proof.actions),
    actions: operations,
    actionCount: operations.length,
    outcome: verdict.nextIdentityStatus,
    altitudeM: verdict.route.maximumAltitudeM,
    enduranceUsed: verdict.route.enduranceUsed,
    energyKj: verdict.route.energyKj,
    distanceMillimeters: verdict.route.distanceMillimeters,
    alterationDelta: verdict.footprintDelta,
  };

  const removedTerrainVoxels = [
    ...currentWorld.removedTerrainVoxels,
    ...candidate.proof.actions.flatMap((action) =>
      action.source.kind === "TERRAIN" ? [action.source.voxel] : [],
    ),
  ];
  const spatial = await buildSpatialManifest(
    verdict.physics.finalStones,
    removedTerrainVoxels,
  );
  const alterations = applyAlterationFacts(
    currentWorld,
    canonicalCandidate,
  );
  const next: CanonicalWorld = {
    ...currentWorld,
    sequence: currentWorld.sequence + 1,
    stones: verdict.physics.finalStones,
    identities,
    tombstones,
    expeditions: [...currentWorld.expeditions, record],
    removedTerrainVoxels,
    alterations,
    footprints: [],
    ...spatial,
    worldHash: "",
  };
  next.footprints = buildFootprints(next);
  next.worldHash = await computeWorldHash(next);
  return next;
}
