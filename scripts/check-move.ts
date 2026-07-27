import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CLIMBER, ROUTE } from "../engine/constants";
import {
  createMovementWorldView,
  validateMovement,
  validateStance,
} from "../engine/movement";
import type {
  LocomotionMode,
  MicroMovement,
  RouteStance,
} from "../engine/types";
import { loadCanonicalWorld, loadDemBundle } from "./expedition-kit";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv.includes("--help")) {
  console.log(
    [
      "move:check",
      "",
      "Evaluate one exact 20 cm micro-transition against a named local world.",
      "",
      "Usage:",
      "  npm run move:check -- --x <cell> --y <cell> --z <cell> --dx <-1..1> --dy <-8..8> --dz <-1..1> --mode <WALK|SCRAMBLE|CLIMB> [--protected] [--carrying] [--world <snapshot.json>]",
      "  npm run move:check -- --moves <moves.json> [--world <snapshot.json>]",
      "",
      "Batch entries use {label?, from:{x,y,z}, movement:{dx,dy,dz,mode,protected?,carrying?}}.",
      "A batch contains 1–4096 independent transitions evaluated against the same world.",
      "This command checks supplied transitions. It never searches for another move.",
    ].join("\n"),
  );
  process.exit(0);
}

const integerArgument = (name: string) => {
  const value = Number(argument(name));
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be an integer.`);
  }
  return value;
};

interface ProposedMove {
  label?: string;
  from: { x: number; y: number; z: number };
  movement: MicroMovement & { carrying?: boolean };
}

function parseMove(value: unknown, index: number): ProposedMove {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`move ${index} must be an object.`);
  }
  const proposed = value as Record<string, unknown>;
  const from = proposed.from as Record<string, unknown> | undefined;
  const movement = proposed.movement as Record<string, unknown> | undefined;
  if (
    Object.keys(proposed).some(
      (key) => !["label", "from", "movement"].includes(key),
    ) ||
    (proposed.label !== undefined && typeof proposed.label !== "string") ||
    !from ||
    !movement ||
    Object.keys(from).some((key) => !["x", "y", "z"].includes(key)) ||
    ["x", "y", "z"].some((axis) => !Number.isSafeInteger(from[axis])) ||
    Object.keys(movement).some(
      (key) =>
        ![
          "dx",
          "dy",
          "dz",
          "mode",
          "protected",
          "carrying",
        ].includes(key),
    ) ||
    ["dx", "dy", "dz"].some(
      (axis) => !Number.isSafeInteger(movement[axis]),
    ) ||
    !["WALK", "SCRAMBLE", "CLIMB"].includes(String(movement.mode)) ||
    (movement.protected !== undefined &&
      typeof movement.protected !== "boolean") ||
    (movement.carrying !== undefined &&
      typeof movement.carrying !== "boolean")
  ) {
    throw new Error(`move ${index} has an invalid exact transition shape.`);
  }
  const directionAllowed = ROUTE.horizontalDirections.some(
    (direction) =>
      direction.x === movement.dx && direction.z === movement.dz,
  );
  if (
    !directionAllowed ||
    (movement.dy as number) < ROUTE.minimumVerticalDeltaCells ||
    (movement.dy as number) > ROUTE.maximumVerticalDeltaCells
  ) {
    throw new Error(`move ${index} is outside the public route opcode bounds.`);
  }
  return {
    ...(proposed.label === undefined
      ? {}
      : { label: proposed.label as string }),
    from: {
      x: from.x as number,
      y: from.y as number,
      z: from.z as number,
    },
    movement: {
      dx: movement.dx as number,
      dy: movement.dy as number,
      dz: movement.dz as number,
      mode: movement.mode as LocomotionMode,
      protected: movement.protected === true,
      carrying: movement.carrying === true,
    },
  };
}

const movesPath = argument("--moves");
let proposedMoves: ProposedMove[];
if (movesPath) {
  const parsed = JSON.parse(
    await readFile(resolve(movesPath), "utf8"),
  ) as unknown;
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 4096) {
    throw new Error("--moves must contain an array of 1–4096 transitions.");
  }
  proposedMoves = parsed.map(parseMove);
} else {
  const mode = argument("--mode") as LocomotionMode | undefined;
  if (!mode || !["WALK", "SCRAMBLE", "CLIMB"].includes(mode)) {
    throw new Error("--mode must be WALK, SCRAMBLE or CLIMB.");
  }
  proposedMoves = [
    parseMove(
      {
        from: {
          x: integerArgument("--x"),
          y: integerArgument("--y"),
          z: integerArgument("--z"),
        },
        movement: {
          dx: integerArgument("--dx"),
          dy: integerArgument("--dy"),
          dz: integerArgument("--dz"),
          mode,
          protected: process.argv.includes("--protected"),
          carrying: process.argv.includes("--carrying"),
        },
      },
      0,
    ),
  ];
}
const [world, terrain] = await Promise.all([
  loadCanonicalWorld(argument("--world")),
  loadDemBundle(),
]);
const view = createMovementWorldView(world, terrain.oracle);
const results = proposedMoves.map((proposed, index) => {
  const from: RouteStance = {
    step: 0,
    cell: { ...proposed.from },
    mode: "WALK",
    protected: false,
  };
  const movement = proposed.movement;
  const to: RouteStance = {
    step: 1,
    cell: {
      x: from.cell.x + movement.dx,
      y: from.cell.y + movement.dy,
      z: from.cell.z + movement.dz,
    },
    mode: movement.mode,
    protected: movement.protected,
  };
  const fromVerdict = validateStance(view, from);
  const movementVerdict = fromVerdict.valid
    ? validateMovement(
        view,
        from,
        to,
        movement,
        movement.carrying === true,
      )
    : null;
  const toVerdict =
    movementVerdict?.valid === true ? validateStance(view, to) : null;
  const valid =
    fromVerdict.valid &&
    movementVerdict?.valid === true &&
    toVerdict?.valid === true;
  return {
    index,
    ...(proposed.label === undefined ? {} : { label: proposed.label }),
    valid,
    from: fromVerdict,
    movement: movementVerdict,
    to: toVerdict,
    carrying: movement.carrying === true,
  };
});
const validCount = results.filter((result) => result.valid).length;
const valid = validCount === results.length;

console.log(
  JSON.stringify(
    {
      valid,
      count: results.length,
      validCount,
      invalidCount: results.length - validCount,
      results,
      enduranceCapacity: CLIMBER.enduranceCapacity,
      next: valid
        ? "Every supplied transition is locally legal in the named world."
        : "Revise rejected transitions; no replacement moves were generated.",
    },
    null,
    2,
  ),
);
if (!valid) process.exitCode = 1;
