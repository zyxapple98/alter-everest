import assert from "node:assert/strict";
import test from "node:test";
import { renderIntervalMs } from "../app/everest/render-budget";

test("render budget reserves full motion for interaction and expeditions", () => {
  assert.equal(
    renderIntervalMs({
      visible: true,
      highMotion: true,
      reducedMotion: false,
    }),
    1000 / 60,
  );
  assert.equal(
    renderIntervalMs({
      visible: true,
      highMotion: false,
      reducedMotion: false,
    }),
    1000 / 24,
  );
});

test("render budget throttles reduced-motion and hidden pages", () => {
  assert.equal(
    renderIntervalMs({
      visible: true,
      highMotion: false,
      reducedMotion: true,
    }),
    1000 / 12,
  );
  assert.equal(
    renderIntervalMs({
      visible: false,
      highMotion: true,
      reducedMotion: false,
    }),
    500,
  );
});
