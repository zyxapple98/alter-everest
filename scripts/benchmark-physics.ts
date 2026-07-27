import { performance } from "node:perf_hooks";
import { PHYSICS } from "../engine/constants";
import { simulateMutation } from "../engine/physics";
import { syntheticReliefM } from "../engine/surface";
import type { TerrainOracle } from "../engine/terrain";
import type { PhysicsSnapshot, StoneState } from "../engine/types";

const stonesIndex = process.argv.indexOf("--stones");
const count =
  stonesIndex === -1
    ? PHYSICS.maximumAffectedStoneCells
    : Number(process.argv[stonesIndex + 1]);
if (
  !Number.isSafeInteger(count) ||
  count < 1 ||
  count > PHYSICS.maximumAffectedStoneCells
) {
  throw new Error(
    `--stones must be 1..${PHYSICS.maximumAffectedStoneCells}`,
  );
}

const terrain: TerrainOracle = {
  sample(x, z) {
    return {
      y: -syntheticReliefM(x, z),
      altitudeM: 5_350 - syntheticReliefM(x, z),
      slopeDegrees: 0,
      surface: "ROCK",
    };
  },
};
const columns = Math.ceil(Math.sqrt(count));
const stones: StoneState[] = Array.from({ length: count }, (_, index) => ({
  id: `benchmark-${String(index).padStart(5, "0")}`,
  cell: {
    x: index % columns,
    y: 1,
    z: Math.floor(index / columns),
  },
}));
const snapshot: PhysicsSnapshot = {
  worldHash: "benchmark",
  stones,
  removedTerrainVoxels: [],
};
const started = performance.now();
const verdict = await simulateMutation(
  snapshot,
  {
    kind: "RELOCATE",
    matterId: "benchmark-00000",
    source: { kind: "STONE" },
    destination: {
      kind: "WORLD",
      cell: { x: -1, y: 1, z: 0 },
    },
  },
  { terrain },
);
const wallMs = performance.now() - started;

console.log(
  JSON.stringify(
    {
      ruleset: PHYSICS.rulesetVersion,
      stoneCount: count,
      wallMs: Number(wallMs.toFixed(2)),
      verifierBudgetMs: 4_000,
      withinBudget: wallMs < 4_000,
      verdict: {
        valid: verdict.valid,
        code: verdict.code,
        evaluatedStoneCells: verdict.evaluatedStoneCells,
        cavityCellsChecked: verdict.cavityCellsChecked,
        affected: verdict.affectedStoneIds.length,
      },
    },
    null,
    2,
  ),
);
