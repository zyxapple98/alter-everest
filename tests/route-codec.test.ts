import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeRouteProgram,
  encodeRouteProgram,
  exactRouteFromStances,
  iterateRouteTransitions,
  ROUTE_CODEC_LIMITS,
} from "../engine/route-codec";
import type { ExactRoute, MicroMovement } from "../engine/types";
import { LOCOMOTION, ROUTE } from "../engine/constants";

const options = { maximumSteps: 250_000, requireCanonical: true };
const baseRoute = {
  codec: "ae-microtrace-v1",
  start: { x: 10, y: 20, z: 30 },
} as const;

function program(bytes: number[]) {
  return Buffer.from(bytes).toString("base64url");
}

test("codec and locomotion bounds come from public player rules", () => {
  assert.equal(
    ROUTE_CODEC_LIMITS.minimumDy,
    ROUTE.minimumVerticalDeltaCells,
  );
  assert.equal(
    ROUTE_CODEC_LIMITS.maximumDy,
    ROUTE.maximumVerticalDeltaCells,
  );
  assert.equal(
    ROUTE_CODEC_LIMITS.movementOpcodes,
    ROUTE.horizontalDirections.length *
      (ROUTE.maximumVerticalDeltaCells -
        ROUTE.minimumVerticalDeltaCells +
        1),
  );
  assert.equal(LOCOMOTION.CLIMB.requiresProtection, true);
});

test("ae-microtrace-v1 round-trips cells and locomotion state exactly", () => {
  const stances = [
    {
      cell: { x: 10, y: 20, z: 30 },
      mode: "WALK" as const,
      protected: false,
    },
    {
      cell: { x: 11, y: 20, z: 30 },
      mode: "WALK" as const,
      protected: false,
    },
    {
      cell: { x: 12, y: 21, z: 29 },
      mode: "SCRAMBLE" as const,
      protected: false,
    },
    {
      cell: { x: 13, y: 22, z: 28 },
      mode: "CLIMB" as const,
      protected: true,
    },
  ];
  const route = exactRouteFromStances(stances, true);
  const decoded = decodeRouteProgram(route, options);

  assert.equal(route.safeStop, true);
  assert.deepEqual(
    decoded.stances.map(({ cell, mode, protected: protectedState }) => ({
      cell,
      mode,
      protected: protectedState,
    })),
    stances,
  );
  assert.equal(
    encodeRouteProgram(decoded.movements),
    route.program,
  );
});

test("long repeated microtraces remain compact and bounded", () => {
  const movement: MicroMovement = {
    dx: 1,
    dy: 0,
    dz: 0,
    mode: "WALK",
    protected: false,
  };
  const movements = Array.from({ length: 250_000 }, () => movement);
  const route: ExactRoute = {
    ...baseRoute,
    stepCount: movements.length,
    program: encodeRouteProgram(movements),
  };
  assert.ok(Buffer.from(route.program, "base64url").byteLength <= 6);

  let decodedSteps = 0;
  let terminal = route.start;
  for (const transition of iterateRouteTransitions(route, options)) {
    decodedSteps += 1;
    terminal = transition.to.cell;
  }
  assert.equal(decodedSteps, 250_000);
  assert.deepEqual(terminal, {
    x: 250_010,
    y: 20,
    z: 30,
  });
});

test("decoder rejects non-canonical and adversarial programs", () => {
  const invalid: Array<{ route: ExactRoute; message: RegExp }> = [
    {
      route: { ...baseRoute, stepCount: 1, program: "RA==" },
      message: /canonical base64url/,
    },
    {
      route: {
        ...baseRoute,
        stepCount: 3,
        program: program([68, 68, 68]),
      },
      message: /canonical RUN/,
    },
    {
      route: {
        ...baseRoute,
        stepCount: 2,
        program: program([136, 68, 2]),
      },
      message: /fewer than three/,
    },
    {
      route: {
        ...baseRoute,
        stepCount: 3,
        program: program([136, 68, 0x83, 0]),
      },
      message: /not canonically encoded/,
    },
    {
      route: {
        ...baseRoute,
        stepCount: 6,
        program: program([136, 68, 3, 136, 68, 3]),
      },
      message: /Adjacent equal movement runs/,
    },
    {
      route: {
        ...baseRoute,
        stepCount: 4,
        program: program([136, 68, 3, 68]),
      },
      message: /Adjacent equal movement runs/,
    },
    {
      route: {
        ...baseRoute,
        stepCount: 1,
        program: program([137, 68]),
      },
      message: /Redundant locomotion/,
    },
    {
      route: {
        ...baseRoute,
        stepCount: 1,
        program: program([141, 138, 68]),
      },
      message: /precede protection changes/,
    },
    {
      route: {
        ...baseRoute,
        stepCount: 1,
        program: program([68, 138]),
      },
      message: /unused state change/,
    },
    {
      route: {
        ...baseRoute,
        stepCount: 1,
        program: program([142]),
      },
      message: /Unknown route opcode/,
    },
    {
      route: {
        ...baseRoute,
        stepCount: 1,
        program: program([136, 68, 3]),
      },
      message: /exceeds declared stepCount/,
    },
  ];

  for (const entry of invalid) {
    assert.throws(
      () => decodeRouteProgram(entry.route, options),
      entry.message,
    );
  }
  assert.throws(
    () =>
      decodeRouteProgram(
        {
          ...baseRoute,
          stepCount: 250_001,
          program: program([68]),
        },
        options,
      ),
    /1–250000/,
  );
});
