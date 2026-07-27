import { voxelKey } from "./mutation";
import type {
  AlterationState,
  CandidateCommit,
  CanonicalWorld,
  IdentityFootprint,
} from "./types";

export function alterationStateForWorld(
  world: Pick<CanonicalWorld, "alterations">,
): AlterationState {
  return {
    terrainRemovals: world.alterations.terrainRemovals.map((fact) => ({
      cell: { ...fact.cell },
      agentId: fact.agentId,
      expeditionId: fact.expeditionId,
    })),
    stonePlacements: world.alterations.stonePlacements.map((fact) => ({
      stoneId: fact.stoneId,
      cell: { ...fact.cell },
      agentId: fact.agentId,
      expeditionId: fact.expeditionId,
    })),
  };
}

export function applyAlterationFacts(
  world: Pick<CanonicalWorld, "alterations">,
  candidate: CandidateCommit,
): AlterationState {
  const current = alterationStateForWorld(world);
  const removals = new Map(
    current.terrainRemovals.map((fact) => [voxelKey(fact.cell), fact]),
  );
  const placements = new Map(
    current.stonePlacements.map((fact) => [fact.stoneId, fact]),
  );

  for (const action of candidate.proof.actions) {
    if (action.source.kind === "STONE") {
      placements.delete(action.matterId);
    }
    if (action.source.kind === "TERRAIN") {
      removals.set(voxelKey(action.source.voxel), {
        cell: { ...action.source.voxel },
        agentId: candidate.agentId,
        expeditionId: candidate.id,
      });
    }
    if (action.destination.kind === "WORLD") {
      placements.set(action.matterId, {
        stoneId: action.matterId,
        cell: { ...action.destination.cell },
        agentId: candidate.agentId,
        expeditionId: candidate.id,
      });
    }
  }

  return {
    terrainRemovals: [...removals.values()].sort((left, right) =>
      voxelKey(left.cell).localeCompare(voxelKey(right.cell)),
    ),
    stonePlacements: [...placements.values()].sort((left, right) =>
      left.stoneId.localeCompare(right.stoneId),
    ),
  };
}

export function buildFootprints(
  world: Pick<
    CanonicalWorld,
    | "identities"
    | "expeditions"
    | "alterations"
  >,
) {
  const totals = new Map<string, IdentityFootprint>();
  const ensure = (agentId: string) => {
    const key = agentId.toLowerCase();
    const existing = totals.get(key);
    if (existing) return existing;
    const created: IdentityFootprint = {
      agentId,
      acceptedExpeditions: 0,
      totalDistanceMillimeters: 0,
      activeTerrainRemovals: 0,
      activeStonePlacements: 0,
      activeAlterations: 0,
    };
    totals.set(key, created);
    return created;
  };

  world.identities.forEach((identity) => ensure(identity.id));
  for (const expedition of world.expeditions) {
    const footprint = ensure(expedition.agentId);
    footprint.acceptedExpeditions += 1;
    footprint.totalDistanceMillimeters += expedition.distanceMillimeters;
  }
  const alterations = alterationStateForWorld(world);
  for (const fact of alterations.terrainRemovals) {
    ensure(fact.agentId).activeTerrainRemovals += 1;
  }
  for (const fact of alterations.stonePlacements) {
    ensure(fact.agentId).activeStonePlacements += 1;
  }
  for (const footprint of totals.values()) {
    footprint.activeAlterations =
      footprint.activeTerrainRemovals +
      footprint.activeStonePlacements;
  }
  return [...totals.values()].sort((left, right) =>
    left.agentId.localeCompare(right.agentId),
  );
}

export function footprintForAgent(
  world: Parameters<typeof buildFootprints>[0],
  agentId: string,
) {
  return (
    buildFootprints(world).find(
      (footprint) =>
        footprint.agentId.toLowerCase() === agentId.toLowerCase(),
    ) ?? {
      agentId,
      acceptedExpeditions: 0,
      totalDistanceMillimeters: 0,
      activeTerrainRemovals: 0,
      activeStonePlacements: 0,
      activeAlterations: 0,
    }
  );
}
