import assert from "node:assert/strict";
import test from "node:test";
import {
  dampDirectorValue,
  dampDirectorValueAsymmetric,
  requiredCameraLift,
} from "../app/everest/camera-director";

test("camera damping stabilizes height with faster safety lift", () => {
  const smoothed = dampDirectorValue(0, 10, 0.1, 0.5);
  assert.ok(smoothed > 1.8 && smoothed < 1.82);
  const rising = dampDirectorValueAsymmetric(
    0,
    10,
    0.1,
    0.2,
    0.8,
  );
  const falling = dampDirectorValueAsymmetric(
    10,
    0,
    0.1,
    0.2,
    0.8,
  );
  assert.ok(rising > 3.9);
  assert.ok(falling > 8.8);
});

test("camera director clears terrain and constructed walls", () => {
  const subject = { x: 0, y: 2, z: 0 };
  const camera = { x: 0, y: 3, z: 8 };
  const openLift = requiredCameraLift(
    subject,
    camera,
    () => 0,
    0.3,
    0.2,
  );
  assert.equal(openLift, 0);

  const wallLift = requiredCameraLift(
    subject,
    camera,
    (_x, z) => (z > 3.8 && z < 4.2 ? 4 : 0),
    0.3,
    0.2,
  );
  assert.ok(wallLift > 1.7);
});
