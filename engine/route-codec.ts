import type {
  ExactRoute,
  LocomotionMode,
  MicroMovement,
  RouteStance,
  VoxelCoordinate,
} from "./types";
import { ROUTE } from "./constants";

export const EXACT_ROUTE_CODEC = "ae-microtrace-v1" as const;

const HORIZONTAL_DIRECTIONS = ROUTE.horizontalDirections;
const MINIMUM_DY = ROUTE.minimumVerticalDeltaCells;
const MAXIMUM_DY = ROUTE.maximumVerticalDeltaCells;
const MOVEMENT_OPCODE_COUNT =
  HORIZONTAL_DIRECTIONS.length * (MAXIMUM_DY - MINIMUM_DY + 1);
const RUN = MOVEMENT_OPCODE_COUNT;
const SET_WALK = RUN + 1;
const SET_SCRAMBLE = RUN + 2;
const SET_CLIMB = RUN + 3;
const PROTECTION_OFF = RUN + 4;
const PROTECTION_ON = RUN + 5;

export const ROUTE_CODEC_LIMITS = {
  minimumDy: MINIMUM_DY,
  maximumDy: MAXIMUM_DY,
  movementOpcodes: MOVEMENT_OPCODE_COUNT,
  maximumOpcode: PROTECTION_ON,
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
    left.dz === right.dz &&
    left.mode === right.mode &&
    left.protected === right.protected
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
    throw new Error("Movement deltas are outside ae-microtrace-v1.");
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

function movementFromOpcode(
  opcode: number,
  mode: LocomotionMode,
  protectedState: boolean,
): MicroMovement {
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
    mode,
    protected: protectedState,
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

function modeOpcode(mode: LocomotionMode) {
  if (mode === "WALK") return SET_WALK;
  if (mode === "SCRAMBLE") return SET_SCRAMBLE;
  return SET_CLIMB;
}

function appendStateChange(
  output: number[],
  current: { mode: LocomotionMode; protected: boolean },
  movement: MicroMovement,
) {
  if (movement.mode !== current.mode) {
    output.push(modeOpcode(movement.mode));
    current.mode = movement.mode;
  }
  if (movement.protected !== current.protected) {
    output.push(movement.protected ? PROTECTION_ON : PROTECTION_OFF);
    current.protected = movement.protected;
  }
}

export function encodeRouteProgram(movements: readonly MicroMovement[]) {
  const output: number[] = [];
  const current: { mode: LocomotionMode; protected: boolean } = {
    mode: "WALK",
    protected: false,
  };
  for (let index = 0; index < movements.length; ) {
    const movement = movements[index];
    appendStateChange(output, current, movement);
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

function modeFromOpcode(opcode: number): LocomotionMode | null {
  if (opcode === SET_WALK) return "WALK";
  if (opcode === SET_SCRAMBLE) return "SCRAMBLE";
  if (opcode === SET_CLIMB) return "CLIMB";
  return null;
}

export function decodeRouteProgram(
  route: ExactRoute,
  options: RouteCodecOptions,
): DecodedRoute {
  const stances: RouteStance[] = [
    {
      step: 0,
      cell: { ...route.start },
      mode: "WALK",
      protected: false,
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
  let mode: LocomotionMode = "WALK";
  let protectedState = false;
  let offset = 0;
  let previousMovementOpcode: number | null = null;
  let previousPlainCount = 0;
  let previousInstructionWasRun = false;
  let pendingModeChange = false;
  let pendingProtectionChange = false;
  let stateChangedSinceMovement = false;
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
      !stateChangedSinceMovement &&
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
    movementFromOpcode(opcode, mode, protectedState);
    decodedSteps += count;
    previousMovementOpcode = opcode;
    previousInstructionWasRun = fromRun;
    pendingModeChange = false;
    pendingProtectionChange = false;
    stateChangedSinceMovement = false;
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
    const nextMode = modeFromOpcode(opcode);
    if (nextMode) {
      if (nextMode === mode) {
        throw new Error("Redundant locomotion state change is not canonical.");
      }
      if (
        options.requireCanonical !== false &&
        (pendingModeChange || pendingProtectionChange)
      ) {
        throw new Error(
          "Locomotion state changes must be singular and precede protection changes.",
        );
      }
      mode = nextMode;
      pendingModeChange = true;
      stateChangedSinceMovement = true;
      continue;
    }
    if (opcode === PROTECTION_OFF || opcode === PROTECTION_ON) {
      const nextProtection = opcode === PROTECTION_ON;
      if (nextProtection === protectedState) {
        throw new Error("Redundant protection state change is not canonical.");
      }
      if (
        options.requireCanonical !== false &&
        pendingProtectionChange
      ) {
        throw new Error(
          "Protection state may change only once before a movement.",
        );
      }
      protectedState = nextProtection;
      pendingProtectionChange = true;
      stateChangedSinceMovement = true;
      continue;
    }
    throw new Error(`Unknown route opcode ${opcode}.`);
  }

  if (
    options.requireCanonical !== false &&
    (pendingModeChange || pendingProtectionChange)
  ) {
    throw new Error("Route program ends with an unused state change.");
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
  let mode: LocomotionMode = "WALK";
  let protectedState = false;
  let offset = 0;
  let from: RouteStance = {
    step: 0,
    cell: { ...route.start },
    mode,
    protected: protectedState,
  };

  while (offset < bytes.length) {
    const opcode = bytes[offset++];
    if (opcode < MOVEMENT_OPCODE_COUNT) {
      const movement = movementFromOpcode(
        opcode,
        mode,
        protectedState,
      );
      const to: RouteStance = {
        step: from.step + 1,
        cell: {
          x: from.cell.x + movement.dx,
          y: from.cell.y + movement.dy,
          z: from.cell.z + movement.dz,
        },
        mode: movement.mode,
        protected: movement.protected,
      };
      yield { from, to, movement: { ...movement } };
      from = to;
      continue;
    }
    if (opcode === RUN) {
      const movementOpcodeValue = bytes[offset++];
      const decoded = decodeUnsigned(bytes, offset);
      offset = decoded.offset;
      const movement = movementFromOpcode(
        movementOpcodeValue,
        mode,
        protectedState,
      );
      for (let repeat = 0; repeat < decoded.value; repeat += 1) {
        const to: RouteStance = {
          step: from.step + 1,
          cell: {
            x: from.cell.x + movement.dx,
            y: from.cell.y + movement.dy,
            z: from.cell.z + movement.dz,
          },
          mode: movement.mode,
          protected: movement.protected,
        };
        yield { from, to, movement: { ...movement } };
        from = to;
      }
      continue;
    }
    const nextMode = modeFromOpcode(opcode);
    if (nextMode) {
      mode = nextMode;
      continue;
    }
    protectedState = opcode === PROTECTION_ON;
  }
}

export function movementsFromStances(
  stances: readonly Omit<RouteStance, "step">[],
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
      mode: to.mode,
      protected: to.protected,
    };
    movementOpcode(movement);
    movements.push(movement);
  }
  return movements;
}

export function exactRouteFromStances(
  stances: readonly Omit<RouteStance, "step">[],
  safeStop = false,
): ExactRoute {
  const movements = movementsFromStances(stances);
  return {
    codec: EXACT_ROUTE_CODEC,
    start: { ...stances[0].cell },
    stepCount: movements.length,
    program: encodeRouteProgram(movements),
    ...(safeStop ? { safeStop: true } : {}),
  };
}
