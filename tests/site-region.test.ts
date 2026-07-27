import assert from "node:assert/strict";
import test from "node:test";
import { siteRegionBoundaryPositions } from "../app/everest/site-region";

test("site boundaries preserve the canonical radius and follow terrain", () => {
  const centerX = 12;
  const centerZ = -7;
  const centerSurfaceY = 4;
  const radiusWorld = 1.4;
  const positions = siteRegionBoundaryPositions({
    centerX,
    centerZ,
    centerSurfaceY,
    radiusWorld,
    segments: 32,
    sampleSurfaceY: (x, z) => 4 + x * 0.1 - z * 0.05,
  });

  assert.equal(positions.length, 32 * 3);
  for (let index = 0; index < positions.length; index += 3) {
    const offsetX = positions[index];
    const offsetY = positions[index + 1];
    const offsetZ = positions[index + 2];
    assert.ok(
      Math.abs(Math.hypot(offsetX, offsetZ) - radiusWorld) < 1e-6,
    );
    assert.ok(
      Math.abs(
        offsetY -
          ((centerX + offsetX) * 0.1 -
            (centerZ + offsetZ) * 0.05),
      ) < 1e-6,
    );
  }
});
