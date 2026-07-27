import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { simulateMutation } from "../engine/physics";
import type {
  MatterMutation,
  VoxelCoordinate,
} from "../engine/types";
import {
  formatPlayerHelp,
  guidanceForCode,
  PLAYER_DOCS,
} from "../lib/player-rules";
import { loadCanonicalWorld, loadDemBundle } from "./expedition-kit";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const inputPath = process.argv[2];
const help = formatPlayerHelp({
  command: "matter:check",
  purpose:
    "Evaluate one supplied matter transition against the current terrain and static world without choosing an action or route.",
  usage:
    "npm run matter:check -- <mutation.json> [--world <snapshot.json>]",
  sections: [
    {
      heading: "Input",
      lines: [
        '{ "kind":"RELOCATE", "matterId":"...", "source":..., "destination":... }',
        'STONE sources use { "kind":"STONE" }; matterId identifies the existing stone.',
      ],
    },
    {
      heading: "Boundary",
      lines: [
        "This is one transition only. It excludes interaction reach, pickup/release timing, carrying, route clearance, Endurance and identity.",
      ],
    },
  ],
  output:
    "Static-physics verdict, affected stones, evaluation bounds and the exact state delta.",
  next: [
    "Use the result while authoring exact ordered actions.",
    "Run expedition:check for the complete candidate verdict.",
  ],
  docs: [PLAYER_DOCS.matter, PLAYER_DOCS.physics],
});
if (!inputPath || inputPath === "--help") {
  console.log(help);
  process.exit(0);
}

function exactKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function identifier(value: unknown) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
  );
}

function voxel(value: unknown): value is VoxelCoordinate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const cell = value as Record<string, unknown>;
  return (
    exactKeys(cell, ["x", "y", "z"]) &&
    ["x", "y", "z"].every((axis) => Number.isSafeInteger(cell[axis]))
  );
}

function parseMutation(value: unknown): MatterMutation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Mutation must be an object.");
  }
  const mutation = value as Record<string, unknown>;
  if (
    !exactKeys(mutation, [
      "kind",
      "matterId",
      "source",
      "destination",
    ]) ||
    mutation.kind !== "RELOCATE" ||
    !identifier(mutation.matterId) ||
    !mutation.source ||
    typeof mutation.source !== "object" ||
    Array.isArray(mutation.source) ||
    !mutation.destination ||
    typeof mutation.destination !== "object" ||
    Array.isArray(mutation.destination)
  ) {
    throw new Error("Mutation does not match the public RELOCATE shape.");
  }
  const source = mutation.source as Record<string, unknown>;
  const destination = mutation.destination as Record<string, unknown>;
  const validSource =
    (source.kind === "BASE" && exactKeys(source, ["kind"])) ||
    (source.kind === "STONE" && exactKeys(source, ["kind"])) ||
    (source.kind === "TERRAIN" &&
      exactKeys(source, ["kind", "voxel"]) &&
      voxel(source.voxel));
  const validDestination =
    (destination.kind === "BASE" &&
      exactKeys(destination, ["kind"])) ||
    (destination.kind === "WORLD" &&
      exactKeys(destination, ["kind", "cell"]) &&
      voxel(destination.cell));
  if (
    !validSource ||
    !validDestination ||
    (source.kind === "BASE" && destination.kind === "BASE")
  ) {
    throw new Error("Mutation source or destination is not a legal flow.");
  }
  return mutation as unknown as MatterMutation;
}

const mutation = parseMutation(
  JSON.parse(await readFile(resolve(inputPath), "utf8")) as unknown,
);
const [world, terrain] = await Promise.all([
  loadCanonicalWorld(argument("--world")),
  loadDemBundle(),
]);
const verdict = await simulateMutation(world, mutation, {
  terrain: terrain.oracle,
});
const stateDelta = {
  removedStoneId:
    mutation.source.kind === "STONE" ? mutation.matterId : null,
  removedTerrainVoxel:
    mutation.source.kind === "TERRAIN" ? mutation.source.voxel : null,
  placedStone:
    mutation.destination.kind === "WORLD"
      ? {
          id: mutation.matterId,
          cell: mutation.destination.cell,
        }
      : null,
};

console.log(
  JSON.stringify(
    {
      valid: verdict.valid,
      scope: "ONE_MATTER_TRANSITION_PHYSICS_ONLY",
      code: verdict.code,
      mutation,
      stateDelta,
      physics: {
        contactModel: verdict.contactModel,
        affectedStoneIds: verdict.affectedStoneIds,
        evaluatedStoneCells: verdict.evaluatedStoneCells,
        cavityCellsChecked: verdict.cavityCellsChecked,
        resultingStoneCount: verdict.finalStones.length,
      },
      rule: guidanceForCode(verdict.valid ? null : verdict.code),
      next: verdict.valid
        ? "The isolated transition is physically legal. Bind it to exact pickup/release stances and run expedition:check."
        : "Revise the supplied transition; no repair or replacement was generated.",
    },
    null,
    2,
  ),
);
if (!verdict.valid) process.exitCode = 1;
