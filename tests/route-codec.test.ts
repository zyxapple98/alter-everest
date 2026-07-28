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
import { ROUTE } from "../engine/constants";

const options = { maximumSteps: 250_000, requireCanonical: true };
const baseRoute = {
  codec: "ae-microtrace-v2",
  start: { x: 10, y: 20, z: 30 },
} as const;

function program(bytes: number[]) {
  return Buffer.from(bytes).toString("base64url");
}

test("codec movement bounds come from public player rules", () => {
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
});

test("ae-microtrace-v2 round-trips exact cells without agent locomotion state", () => {
  const stances = [
    { cell: { x: 10, y: 20, z: 30 } },
    { cell: { x: 11, y: 20, z: 30 } },
    { cell: { x: 12, y: 21, z: 29 } },
    { cell: { x: 13, y: 23, z: 28 } },
  ];
  const route = exactRouteFromStances(stances, true);
  const decoded = decodeRouteProgram(route, options);

  assert.equal(route.acceptOneWayDeath, true);
  assert.deepEqual(
    decoded.stances.map(({ cell }) => ({ cell })),
    stances,
  );
  assert.equal(encodeRouteProgram(decoded.movements), route.program);
});

test("long repeated microtraces remain compact and bounded", () => {
  const movement: MicroMovement = { dx: 1, dy: 0, dz: 0 };
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
        program: program([137]),
      },
      message: /Unknown route opcode/,
    },
    {
      route: {
        ...baseRoute,
        stepCount: 3,
        program: program([136, 136, 3]),
      },
      message: /movement opcode/,
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
