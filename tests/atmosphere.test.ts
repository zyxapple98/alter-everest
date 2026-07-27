import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  celestialDirectionAtKathmandu,
  createCameraAtmosphere,
  disposeCameraAtmosphere,
  updateCameraAtmosphere,
} from "../app/everest/atmosphere";
import {
  kathmanduSkyPhase,
  SKY_PHASES,
} from "../app/everest/sky-cycle";

const palette = {
  top: "#02070e",
  middle: "#071827",
  horizon: "#294454",
  nadir: "#111a1f",
  celestial: "#d9edf5",
  celestialGlow: "#8cc7e4",
  celestialRadiusRadians: 0.011,
  starOpacity: 0.5,
};

test("the celestial body stays in the world sky throughout its cycle", () => {
  const samples = [
    "2026-07-27T00:00:00.000Z",
    "2026-07-27T06:00:00.000Z",
    "2026-07-27T12:00:00.000Z",
    "2026-07-27T18:00:00.000Z",
  ];

  for (const sample of samples) {
    const direction = celestialDirectionAtKathmandu(new Date(sample));
    assert.ok(Math.abs(direction.length() - 1) < 1e-10);
    assert.ok(direction.y > 0);
  }
});

test("the atmosphere follows camera position without following rotation", () => {
  const createdAt = new Date("2026-07-27T12:00:00.000Z");
  const atmosphere = createCameraAtmosphere(500, palette, createdAt);
  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 600);
  camera.position.set(12, 34, 56);
  camera.rotation.set(0.4, 1.1, 0);
  const celestialBefore = (
    atmosphere.sky.material.uniforms.celestialDirection
      .value as THREE.Vector3
  ).clone();

  updateCameraAtmosphere(atmosphere, camera, createdAt);

  assert.deepEqual(atmosphere.root.position.toArray(), [12, 34, 56]);
  assert.deepEqual(
    (
      atmosphere.sky.material.uniforms.celestialDirection
        .value as THREE.Vector3
    ).toArray(),
    celestialBefore.toArray(),
  );
  assert.deepEqual(atmosphere.root.rotation.toArray(), [
    0,
    0,
    0,
    "XYZ",
  ]);

  disposeCameraAtmosphere(atmosphere);
});

test("the Kathmandu sky cycle makes early morning fully readable", () => {
  const phaseAtLocalTime = (localIsoTime: string) =>
    kathmanduSkyPhase(
      new Date(`2026-07-26T${localIsoTime}:00+05:45`),
    );

  assert.equal(phaseAtLocalTime("04:30"), "night");
  assert.equal(phaseAtLocalTime("05:45"), "dawn");
  assert.equal(phaseAtLocalTime("07:10"), "day");
  assert.equal(phaseAtLocalTime("18:30"), "dusk");
  assert.equal(phaseAtLocalTime("20:00"), "night");
});

test("each sky phase has a continuous, non-black terrain horizon", () => {
  for (const palette of Object.values(SKY_PHASES)) {
    assert.equal(palette.fog, palette.atmosphere.horizon);
    assert.notEqual(palette.atmosphere.top, "#000000");
    assert.notEqual(palette.atmosphere.middle, "#000000");
    assert.notEqual(palette.atmosphere.horizon, "#000000");
  }
});
