import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { ObservatoryFeed } from "../lib/world";
import {
  agentVisualLod,
  createNormalReplayTimeline,
  replayActionState,
  sampleActionMatterState,
  sampleReplayTimeline,
} from "../app/everest/expedition-replay";
import {
  expeditionReplayWorldState,
  replayVoxelKey,
} from "../app/everest/expedition-world-state";

test("multi-action replay retains every pickup and release in route order", () => {
  const actions = [
    { pickupFraction: 0.1, releaseFraction: 0.2 },
    { pickupFraction: 0.3, releaseFraction: 0.4 },
    { pickupFraction: 0.5, releaseFraction: 0.6 },
    { pickupFraction: 0.7, releaseFraction: 0.8 },
  ];
  const timeline = createNormalReplayTimeline(
    [
      { progress: 0, distanceM: 0 },
      { progress: 1, distanceM: 100 },
    ],
    actions,
  );
  const holds = timeline.segments.filter(
    ({ holdKind }) => holdKind !== null,
  );
  assert.equal(holds.length, actions.length * 2);
  actions.forEach((action, index) => {
    assert.deepEqual(
      holds
        .filter(({ actionIndex }) => actionIndex === index)
        .map(({ holdKind, startProgress }) => ({
          holdKind,
          startProgress,
        })),
      [
        {
          holdKind: "pickup",
          startProgress: action.pickupFraction,
        },
        {
          holdKind: "release",
          startProgress: action.releaseFraction,
        },
      ],
    );
  });
});

test("action state distinguishes approach, carry, placement, and completion", () => {
  const actions = [
    { pickupFraction: 0.1, releaseFraction: 0.2 },
    { pickupFraction: 0.4, releaseFraction: 0.5 },
  ];
  assert.equal(replayActionState(0.05, actions)?.phase, "approaching");
  assert.equal(replayActionState(0.15, actions)?.phase, "carrying");
  assert.equal(replayActionState(0.2, actions)?.phase, "placing");
  assert.deepEqual(replayActionState(0.45, actions), {
    index: 1,
    completed: 1,
    phase: "carrying",
  });
  assert.equal(replayActionState(1, actions)?.phase, "complete");
});

test("agent LOD is physical at work scale and signal-based at mountain scale", () => {
  const work = agentVisualLod(18);
  const encounter = agentVisualLod(70);
  const regional = agentVisualLod(180);
  const overview = agentVisualLod(8_000);

  assert.equal(work.physicalOpacity, 1);
  assert.equal(work.signalOpacity, 0);
  assert.ok(encounter.physicalOpacity > 0);
  assert.ok(encounter.signalOpacity > 0);
  assert.equal(regional.physicalOpacity, 0);
  assert.equal(regional.signalOpacity, 1);
  assert.equal(overview.physicalOpacity, 0);
  assert.equal(overview.signalOpacity, 1);
  assert.equal(overview.signalPixels, 40);
  assert.equal(work.actionMarkerM, 0.24);
  assert.equal(overview.actionMarkerM, 3.2);
});

test("normal replay walks at human pace and pauses for matter handling", () => {
  const timeline = createNormalReplayTimeline(
    [
      { progress: 0, distanceM: 0 },
      { progress: 0.5, distanceM: 50 },
      { progress: 1, distanceM: 100 },
    ],
    [{ pickupFraction: 0.25, releaseFraction: 0.5 }],
  );

  assert.equal(timeline.totalSeconds, 83.2);
  const pickup = sampleReplayTimeline(timeline, 20.5);
  assert.equal(pickup.progress, 0.25);
  assert.equal(pickup.holdKind, "pickup");
  assert.equal(pickup.moving, false);
  const walking = sampleReplayTimeline(timeline, 30);
  assert.equal(walking.moving, true);
});

test("matter exists in exactly one phase before, during, and after handling", () => {
  const actions = [
    { pickupFraction: 0, releaseFraction: 0.2 },
    { pickupFraction: 0.3, releaseFraction: 0.4 },
  ];
  const timeline = createNormalReplayTimeline(
    [
      { progress: 0, distanceM: 0 },
      { progress: 1, distanceM: 10 },
    ],
    actions,
    { startProgress: 0.2, endProgress: 0.4 },
  );
  const firstRelease = timeline.segments.find(
    ({ actionIndex, holdKind }) =>
      actionIndex === 0 && holdKind === "release",
  );
  const secondPickup = timeline.segments.find(
    ({ actionIndex, holdKind }) =>
      actionIndex === 1 && holdKind === "pickup",
  );
  const secondRelease = timeline.segments.find(
    ({ actionIndex, holdKind }) =>
      actionIndex === 1 && holdKind === "release",
  );
  assert.ok(firstRelease);
  assert.ok(secondPickup);
  assert.ok(secondRelease);

  assert.equal(
    sampleActionMatterState(timeline, 0, actions[0], 0).phase,
    "placing",
  );
  assert.equal(
    sampleActionMatterState(
      timeline,
      firstRelease.endedAtSeconds,
      actions[0],
      0,
    ).phase,
    "placed",
  );
  assert.equal(
    sampleActionMatterState(
      timeline,
      secondPickup.startedAtSeconds - 0.01,
      actions[1],
      1,
    ).phase,
    "waiting",
  );
  assert.equal(
    sampleActionMatterState(
      timeline,
      secondPickup.endedAtSeconds,
      actions[1],
      1,
    ).phase,
    "carrying",
  );
  assert.equal(
    sampleActionMatterState(
      timeline,
      secondRelease.startedAtSeconds + 0.2,
      actions[1],
      1,
    ).phase,
    "placing",
  );
  assert.equal(
    sampleActionMatterState(
      timeline,
      secondRelease.endedAtSeconds,
      actions[1],
      1,
    ).phase,
    "placed",
  );
});

test("expedition replay has one terrain and stone state per frame", () => {
  const actions = [
    {
      order: 1,
      matterId: "base-stone",
      operation: "ADD" as const,
      sourceKind: "BASE" as const,
      destinationKind: "WORLD" as const,
      pickupFraction: 0,
      releaseFraction: 0.2,
      pickup: { x: 0, y: 0, z: 0, altitudeM: 5_260 },
      release: { x: 1, y: 0, z: 0, altitudeM: 5_260 },
      destinationCell: { x: 5, y: 4, z: 5 },
    },
    {
      order: 2,
      matterId: "quarried-stone",
      operation: "QUARRY" as const,
      sourceKind: "TERRAIN" as const,
      destinationKind: "WORLD" as const,
      pickupFraction: 0.3,
      releaseFraction: 0.4,
      pickup: { x: 2, y: 0, z: 0, altitudeM: 5_260 },
      release: { x: 3, y: 0, z: 0, altitudeM: 5_260 },
      sourceCell: { x: 1, y: 2, z: 3 },
      destinationCell: { x: 6, y: 4, z: 5 },
    },
  ];
  const beforeQuarry = expeditionReplayWorldState(actions, [
    { phase: "placed", phaseProgress: 1 },
    { phase: "waiting", phaseProgress: 0 },
  ]);
  assert.deepEqual(
    [...beforeQuarry.restoredTerrainVoxelKeys],
    [replayVoxelKey({ x: 1, y: 2, z: 3 })],
  );
  assert.deepEqual([...beforeQuarry.hiddenStoneIds], [
    "quarried-stone",
  ]);

  const duringQuarry = expeditionReplayWorldState(actions, [
    { phase: "placed", phaseProgress: 1 },
    { phase: "picking-up", phaseProgress: 0.2 },
  ]);
  assert.equal(duringQuarry.restoredTerrainVoxelKeys.size, 0);
  assert.deepEqual([...duringQuarry.hiddenStoneIds], [
    "quarried-stone",
  ]);

  const complete = expeditionReplayWorldState(actions, [
    { phase: "placed", phaseProgress: 1 },
    { phase: "placed", phaseProgress: 1 },
  ]);
  assert.equal(complete.terrainKey, "final");
  assert.equal(complete.hiddenStoneIds.size, 0);
});

test("the canonical observatory feed reflects the current world", async () => {
  const [feed, world] = await Promise.all([
    readFile(
      new URL("../public/data/world/latest.json", import.meta.url),
      "utf8",
    ).then((text) => JSON.parse(text) as ObservatoryFeed),
    readFile(
      new URL("../world/snapshot.json", import.meta.url),
      "utf8",
    ).then(JSON.parse),
  ]);
  assert.equal(feed.sequence, world.sequence);
  assert.equal(feed.worldHash, world.worldHash);
  assert.equal(
    feed.recentExpeditions.length,
    Math.min(3, world.expeditions.length),
  );
  assert.equal(
    feed.footprints.length,
    Math.min(50, world.footprints.length),
  );
  const identityStatus = new Map(
    world.identities.map(
      (identity: { id: string; status: "ACTIVE" | "DEAD" }) => [
        identity.id.toLowerCase(),
        identity.status,
      ],
    ),
  );
  assert.deepEqual(
    feed.footprints,
    world.footprints
      .map(
        (footprint: {
          agentId: string;
          acceptedExpeditions: number;
          totalDistanceMillimeters: number;
          activeTerrainRemovals: number;
          activeStonePlacements: number;
          activeAlterations: number;
        }) => ({
          ...footprint,
          agent: footprint.agentId,
          outcome:
            identityStatus.get(footprint.agentId.toLowerCase()) ??
            "ACTIVE",
        }),
      )
      .sort(
        (left: { agent: string }, right: { agent: string }) =>
          left.agent.localeCompare(right.agent),
      )
      .slice(0, 50),
  );
  assert.equal(
    feed.surfaceTiles.tiles.length,
    world.modifiedTiles.length,
  );
  assert.equal(
    feed.worldSummary.expeditionCount,
    world.expeditions.length,
  );
  assert.equal(feed.worldSummary.stoneCount, world.stones.length);
  assert.equal(
    feed.worldSummary.removedTerrainVoxelCount,
    world.removedTerrainVoxels.length,
  );
});
