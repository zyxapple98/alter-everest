import type {
  ExactRoute,
  MicroMovement,
  RouteStance,
  VoxelCoordinate,
} from "./types";
import { ROUTE } from "./constants";

export const EXACT_ROUTE_CODEC = "ae-microtrace-v2" as const;

const HORIZONTAL_DIRECTIONS = ROUTE.horizontalDirections;
const MINIMUM_DY = ROUTE.minimumVerticalDeltaCells;
const MAXIMUM_DY = ROUTE.maximumVerticalDeltaCells;
const MOVEMENT_OPCODE_COUNT =
  HORIZONTAL_DIRECTIONS.length * (MAXIMUM_DY - MINIMUM_DY + 1);
const RUN = MOVEMENT_OPCODE_COUNT;

export const ROUTE_CODEC_LIMITS = {
  minimumDy: MINIMUM_DY,
  maximumDy: MAXIMUM_DY,
  movementOpcodes: MOVEMENT_OPCODE_COUNT,
  maximumOpcode: RUN,
} as const;

export interface RouteCodecOptions {
  maximumSteps: number;
  requireCanonical?: boolean;
}

export interface DecodedRoute {
  stances: RouteStance[];
  movements: MicroMovement[];
}

export interface RouteTransition {
  from: RouteStance;
  to: RouteStance;
  movement: MicroMovement;
}

function sameCell(
  left: VoxelCoordinate,
  right: VoxelCoordinate,
) {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.z === right.z
  );
}

function sameMovement(
  left: MicroMovement,
  right: MicroMovement,
) {
  return (
    left.dx === right.dx &&
    left.dy === right.dy &&
    left.dz === right.dz
  );
}

function movementOpcode(
  movement: Pick<MicroMovement, "dx" | "dy" | "dz">,
) {
  if (
    !Number.isSafeInteger(movement.dx) ||
    !Number.isSafeInteger(movement.dy) ||
    !Number.isSafeInteger(movement.dz) ||
    movement.dy < MINIMUM_DY ||
    movement.dy > MAXIMUM_DY
  ) {
    throw new Error("Movement deltas are outside ae-microtrace-v2.");
  }
  const direction = HORIZONTAL_DIRECTIONS.findIndex(
    (entry) => entry.x === movement.dx && entry.z === movement.dz,
  );
  if (direction === -1) {
    throw new Error(
      "Each movement must enter one horizontally adjacent 20 cm column.",
    );
  }
  return (
    (movement.dy - MINIMUM_DY) * HORIZONTAL_DIRECTIONS.length +
    direction
  );
}

function movementFromOpcode(opcode: number): MicroMovement {
  if (opcode < 0 || opcode >= MOVEMENT_OPCODE_COUNT) {
    throw new Error(`Invalid movement opcode ${opcode}.`);
  }
  const dy =
    Math.floor(opcode / HORIZONTAL_DIRECTIONS.length) + MINIMUM_DY;
  const direction =
    HORIZONTAL_DIRECTIONS[opcode % HORIZONTAL_DIRECTIONS.length];
  return {
    dx: direction.x,
    dy,
    dz: direction.z,
  };
}

function encodeUnsigned(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Route repeat count must be a non-negative safe integer.");
  }
  const bytes: number[] = [];
  let remaining = value;
  do {
    const low = remaining % 128;
    remaining = Math.floor(remaining / 128);
    bytes.push(low | (remaining > 0 ? 0x80 : 0));
  } while (remaining > 0);
  return bytes;
}

function decodeUnsigned(bytes: Uint8Array, offset: number) {
  let value = 0;
  let multiplier = 1;
  let cursor = offset;
  for (let index = 0; index < 8; index += 1) {
    if (cursor >= bytes.length) {
      throw new Error("Truncated route repeat count.");
    }
    const byte = bytes[cursor++];
    value += (byte & 0x7f) * multiplier;
    if (!Number.isSafeInteger(value)) {
      throw new Error("Route repeat count exceeds safe integer range.");
    }
    if ((byte & 0x80) === 0) {
      const canonical = encodeUnsigned(value);
      if (
        canonical.length !== cursor - offset ||
        canonical.some((entry, index) => entry !== bytes[offset + index])
      ) {
        throw new Error("Route repeat count is not canonically encoded.");
      }
      return { value, offset: cursor };
    }
    multiplier *= 128;
  }
  throw new Error("Route repeat count is too long.");
}

function canonicalBase64Url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64url");
}

function decodeBase64Url(value: string) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]*$/.test(value) ||
    value.includes("=")
  ) {
    throw new Error("Route program must be unpadded canonical base64url.");
  }
  const bytes = new Uint8Array(Buffer.from(value, "base64url"));
  if (canonicalBase64Url(bytes) !== value) {
    throw new Error("Route program is not canonical base64url.");
  }
  return bytes;
}

export function encodeRouteProgram(movements: readonly MicroMovement[]) {
  const output: number[] = [];
  for (let index = 0; index < movements.length; ) {
    const movement = movements[index];
    const opcode = movementOpcode(movement);
    let count = 1;
    while (
      index + count < movements.length &&
      sameMovement(movement, movements[index + count])
    ) {
      count += 1;
    }
    if (count >= 3) {
      output.push(RUN, opcode, ...encodeUnsigned(count));
    } else {
      for (let repeat = 0; repeat < count; repeat += 1) {
        output.push(opcode);
      }
    }
    index += count;
  }
  return canonicalBase64Url(Uint8Array.from(output));
}

export function decodeRouteProgram(
  route: ExactRoute,
  options: RouteCodecOptions,
): DecodedRoute {
  const stances: RouteStance[] = [
    {
      step: 0,
      cell: { ...route.start },
    },
  ];
  const movements: MicroMovement[] = [];
  for (const transition of iterateRouteTransitions(route, options)) {
    movements.push(transition.movement);
    stances.push(transition.to);
  }
  return { stances, movements };
}

export function validateRouteProgram(
  route: ExactRoute,
  options: RouteCodecOptions,
) {
  if (route.codec !== EXACT_ROUTE_CODEC) {
    throw new Error(`Unsupported route codec ${String(route.codec)}.`);
  }
  if (
    !Number.isSafeInteger(route.stepCount) ||
    route.stepCount < 1 ||
    route.stepCount > options.maximumSteps
  ) {
    throw new Error(
      `Route stepCount must be 1–${options.maximumSteps}.`,
    );
  }
  if (
    !Number.isSafeInteger(route.start.x) ||
    !Number.isSafeInteger(route.start.y) ||
    !Number.isSafeInteger(route.start.z)
  ) {
    throw new Error("Route start must be an integer voxel stance.");
  }

  const bytes = decodeBase64Url(route.program);
  let offset = 0;
  let previousMovementOpcode: number | null = null;
  let previousPlainCount = 0;
  let previousInstructionWasRun = false;
  let decodedSteps = 0;

  const appendMovement = (opcode: number, count: number, fromRun: boolean) => {
    if (count < 1 || decodedSteps + count > route.stepCount) {
      throw new Error("Route program exceeds declared stepCount.");
    }
    if (fromRun && count < 3) {
      throw new Error("RUN is non-canonical for fewer than three movements.");
    }
    if (
      options.requireCanonical !== false &&
      opcode === previousMovementOpcode
    ) {
      if (fromRun || previousInstructionWasRun) {
        throw new Error("Adjacent equal movement runs are not canonical.");
      }
      previousPlainCount += count;
      if (previousPlainCount >= 3) {
        throw new Error("Repeated movement must use canonical RUN encoding.");
      }
    } else {
      previousPlainCount = fromRun ? 0 : count;
    }
    movementFromOpcode(opcode);
    decodedSteps += count;
    previousMovementOpcode = opcode;
    previousInstructionWasRun = fromRun;
  };

  while (offset < bytes.length) {
    const opcode = bytes[offset++];
    if (opcode < MOVEMENT_OPCODE_COUNT) {
      appendMovement(opcode, 1, false);
      continue;
    }
    if (opcode === RUN) {
      if (offset >= bytes.length) throw new Error("Truncated RUN movement.");
      const movement = bytes[offset++];
      if (movement >= MOVEMENT_OPCODE_COUNT) {
        throw new Error("RUN requires a movement opcode.");
      }
      const decoded = decodeUnsigned(bytes, offset);
      offset = decoded.offset;
      appendMovement(movement, decoded.value, true);
      continue;
    }
    throw new Error(`Unknown route opcode ${opcode}.`);
  }

  if (decodedSteps !== route.stepCount) {
    throw new Error(
      `Route program decodes to ${decodedSteps} steps, expected ${route.stepCount}.`,
    );
  }
  return { decodedSteps, programBytes: bytes.byteLength };
}

export function* iterateRouteTransitions(
  route: ExactRoute,
  options: RouteCodecOptions,
): Generator<RouteTransition> {
  validateRouteProgram(route, options);
  const bytes = decodeBase64Url(route.program);
  let offset = 0;
  let from: RouteStance = {
    step: 0,
    cell: { ...route.start },
  };

  const emit = function* (
    movementOpcodeValue: number,
    count: number,
  ): Generator<RouteTransition> {
    const movement = movementFromOpcode(movementOpcodeValue);
    for (let repeat = 0; repeat < count; repeat += 1) {
      const to: RouteStance = {
        step: from.step + 1,
        cell: {
          x: from.cell.x + movement.dx,
          y: from.cell.y + movement.dy,
          z: from.cell.z + movement.dz,
        },
      };
      yield { from, to, movement: { ...movement } };
      from = to;
    }
  };

  while (offset < bytes.length) {
    const opcode = bytes[offset++];
    if (opcode < MOVEMENT_OPCODE_COUNT) {
      yield* emit(opcode, 1);
      continue;
    }
    const movementOpcodeValue = bytes[offset++];
    const decoded = decodeUnsigned(bytes, offset);
    offset = decoded.offset;
    yield* emit(movementOpcodeValue, decoded.value);
  }
}

export function movementsFromStances(
  stances: readonly Pick<RouteStance, "cell">[],
) {
  if (stances.length < 2) {
    throw new Error("An exact trace needs at least two stances.");
  }
  const movements: MicroMovement[] = [];
  for (let index = 1; index < stances.length; index += 1) {
    const from = stances[index - 1];
    const to = stances[index];
    if (sameCell(from.cell, to.cell)) {
      throw new Error(`Stance ${index} does not move.`);
    }
    const movement: MicroMovement = {
      dx: to.cell.x - from.cell.x,
      dy: to.cell.y - from.cell.y,
      dz: to.cell.z - from.cell.z,
    };
    movementOpcode(movement);
    movements.push(movement);
  }
  return movements;
}

export function exactRouteFromStances(
  stances: readonly Pick<RouteStance, "cell">[],
  acceptOneWayDeath = false,
): ExactRoute {
  const movements = movementsFromStances(stances);
  return {
    codec: EXACT_ROUTE_CODEC,
    start: { ...stances[0].cell },
    stepCount: movements.length,
    program: encodeRouteProgram(movements),
    ...(acceptOneWayDeath ? { acceptOneWayDeath: true } : {}),
  };
}

interface HistoricalV1Route {
  codec: "ae-microtrace-v1";
  start: VoxelCoordinate;
  stepCount: number;
  program: string;
  safeStop?: boolean;
}

/**
 * Read-only compatibility for immutable accepted proof artifacts. Candidate
 * admission and verification still accept ae-microtrace-v2 only.
 */
export function decodeStoredRouteProgram(
  route: ExactRoute | HistoricalV1Route,
  options: RouteCodecOptions,
): DecodedRoute {
  if (route.codec === EXACT_ROUTE_CODEC) {
    return decodeRouteProgram(route, options);
  }
  if (
    !Number.isSafeInteger(route.stepCount) ||
    route.stepCount < 1 ||
    route.stepCount > options.maximumSteps
  ) {
    throw new Error("Historical route step count is outside current bounds.");
  }
  const bytes = decodeBase64Url(route.program);
  const stances: RouteStance[] = [
    { step: 0, cell: { ...route.start } },
  ];
  const movements: MicroMovement[] = [];
  let offset = 0;
  let current = stances[0];

  const append = (opcode: number, count: number) => {
    const movement = movementFromOpcode(opcode);
    if (movements.length + count > route.stepCount) {
      throw new Error("Historical route exceeds its declared step count.");
    }
    for (let repeat = 0; repeat < count; repeat += 1) {
      const next = {
        step: current.step + 1,
        cell: {
          x: current.cell.x + movement.dx,
          y: current.cell.y + movement.dy,
          z: current.cell.z + movement.dz,
        },
      };
      movements.push({ ...movement });
      stances.push(next);
      current = next;
    }
  };

  while (offset < bytes.length) {
    const opcode = bytes[offset++];
    if (opcode < MOVEMENT_OPCODE_COUNT) {
      append(opcode, 1);
      continue;
    }
    if (opcode === RUN) {
      if (offset >= bytes.length) {
        throw new Error("Truncated historical RUN movement.");
      }
      const movementOpcodeValue = bytes[offset++];
      const decoded = decodeUnsigned(bytes, offset);
      offset = decoded.offset;
      append(movementOpcodeValue, decoded.value);
      continue;
    }
    if (opcode >= RUN + 1 && opcode <= RUN + 6) {
      continue;
    }
    throw new Error(`Unknown historical route opcode ${opcode}.`);
  }
  if (movements.length !== route.stepCount) {
    throw new Error("Historical route does not match its step count.");
  }
  return { stances, movements };
}
