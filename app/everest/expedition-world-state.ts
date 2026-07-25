import type { ObservatoryExpeditionAction } from "../../lib/world";
import type { ReplayMatterState } from "./expedition-replay";

export interface ExpeditionReplayWorldState {
  /**
   * Changes only when terrain occupancy changes. Stone releases do not force
   * an expensive terrain remesh.
   */
  terrainKey: string;
  /** Final-world terrain removals that must be undone at this replay time. */
  restoredTerrainVoxelKeys: ReadonlySet<string>;
  /** Final-world stones that do not exist yet at this replay time. */
  hiddenStoneIds: ReadonlySet<string>;
}

export const FINAL_WORLD_REPLAY_STATE: ExpeditionReplayWorldState = {
  terrainKey: "final",
  restoredTerrainVoxelKeys: new Set(),
  hiddenStoneIds: new Set(),
};

export function replayVoxelKey(cell: {
  x: number;
  y: number;
  z: number;
}) {
  return `${cell.x}:${cell.y}:${cell.z}`;
}

/**
 * Produces one authoritative historical world state for a replay frame.
 * Static terrain and stones are rendered from this state by the terrain
 * streamer. The scene layer only needs to draw the one actively carried item.
 */
export function expeditionReplayWorldState(
  actions: readonly ObservatoryExpeditionAction[],
  matterStates: readonly ReplayMatterState[],
): ExpeditionReplayWorldState {
  const restoredTerrainVoxelKeys = new Set<string>();
  const hiddenStoneIds = new Set<string>();

  actions.forEach((action, index) => {
    const phase = matterStates[index]?.phase ?? "waiting";
    if (
      action.sourceKind === "TERRAIN" &&
      action.sourceCell &&
      phase === "waiting"
    ) {
      restoredTerrainVoxelKeys.add(replayVoxelKey(action.sourceCell));
    }
    if (phase !== "placed") hiddenStoneIds.add(action.matterId);
  });

  return {
    terrainKey:
      restoredTerrainVoxelKeys.size === 0
        ? "final"
        : `restore:${[...restoredTerrainVoxelKeys].sort().join("|")}`,
    restoredTerrainVoxelKeys,
    hiddenStoneIds,
  };
}
