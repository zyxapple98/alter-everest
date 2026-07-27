import assert from "node:assert/strict";
import test from "node:test";
import { snowVisualProfile } from "../app/everest/snow-field";

test("snow becomes larger and denser at human work scale", () => {
  const work = snowVisualProfile(40);
  const mountain = snowVisualProfile(1_200);
  const overview = snowVisualProfile(18_000);

  assert.equal(work.mode, "work");
  assert.equal(mountain.mode, "mountain");
  assert.equal(overview.mode, "overview");
  assert.ok(work.pointPixels > mountain.pointPixels);
  assert.ok(mountain.pointPixels > overview.pointPixels);
  assert.ok(work.visibleCount > mountain.visibleCount);
  assert.ok(mountain.visibleCount > overview.visibleCount);
  assert.ok(work.fallRate > overview.fallRate);
});

test("snow transition is continuous around scale boundaries", () => {
  const beforeWorkBoundary = snowVisualProfile(259.9);
  const afterWorkBoundary = snowVisualProfile(260.1);
  const beforeOverviewBoundary = snowVisualProfile(4_799.9);
  const afterOverviewBoundary = snowVisualProfile(4_800.1);

  assert.ok(
    Math.abs(
      beforeWorkBoundary.pointPixels -
        afterWorkBoundary.pointPixels,
    ) < 0.01,
  );
  assert.ok(
    Math.abs(
      beforeOverviewBoundary.opacity -
        afterOverviewBoundary.opacity,
    ) < 0.01,
  );
});

test("reduced motion keeps atmosphere while greatly reducing movement", () => {
  const regular = snowVisualProfile(80);
  const reduced = snowVisualProfile(80, true);

  assert.ok(reduced.visibleCount >= 64);
  assert.ok(reduced.visibleCount < regular.visibleCount / 2);
  assert.ok(reduced.opacity < regular.opacity / 2);
  assert.ok(reduced.fallRate < regular.fallRate / 5);
});
