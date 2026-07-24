import { performance } from "node:perf_hooks";
import { PHYSICS } from "../engine/constants";
import { simulateMutation } from "../engine/physics";
import {
  IDENTITY_QUATERNION,
  type PhysicsSnapshot,
  type StoneState,
} from "../engine/types";

const count = Number(
  process.argv[process.argv.indexOf("--stones") + 1] ??
    PHYSICS.maxContactIslandStones,
);
if (
  !Number.isSafeInteger(count) ||
  count < 1 ||
  count > PHYSICS.maxContactIslandStones
) {
  throw new Error(`--stones must be 1..${PHYSICS.maxContactIslandStones}`);
}

const columns = 32;
const stones: StoneState[] = Array.from({ length: count }, (_, index) => ({
  id: `benchmark-${String(index).padStart(4, "0")}`,
  pose: {
    translation: {
      x: (index % columns) * PHYSICS.stoneEdgeM,
      y: PHYSICS.stoneEdgeM / 2,
      z: Math.floor(index / columns) * PHYSICS.stoneEdgeM,
    },
    rotation: IDENTITY_QUATERNION,
  },
}));
const snapshot: PhysicsSnapshot = {
  worldHash: "benchmark",
  stones,
  terrain: [
    {
      kind: "cuboid",
      center: { x: 3.1, y: -0.5, z: 1.5 },
      halfExtents: { x: 8, y: 0.5, z: 8 },
    },
  ],
};
const started = performance.now();
const verdict = await simulateMutation(snapshot, {
  kind: "RELOCATE",
  matterId: "benchmark-0000",
  source: { kind: "STONE", stoneId: "benchmark-0000" },
  destination: {
    kind: "WORLD",
    releasePose: {
      translation: { x: 0.1, y: 0.31, z: 0.1 },
      rotation: IDENTITY_QUATERNION,
    },
  },
});
const wallMs = performance.now() - started;

console.log(
  JSON.stringify(
    {
      stoneCount: count,
      wallMs: Number(wallMs.toFixed(2)),
      verifierBudgetMs: 4000,
      withinBudget: wallMs < 4000,
      verdict: {
        valid: verdict.valid,
        code: verdict.code,
        simulatedSeconds: verdict.simulatedSeconds,
        affected: verdict.affectedStoneIds.length,
      },
    },
    null,
    2,
  ),
);
