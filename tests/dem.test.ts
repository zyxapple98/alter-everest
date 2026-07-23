import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const layers = [
  { stem: "everest-dem", lod: "core", displayResolutionM: 30 },
  { stem: "everest-dem-mid", lod: "mid", displayResolutionM: 90 },
  { stem: "everest-dem-far", lod: "far", displayResolutionM: 300 },
] as const;

async function readLayer(stem: string) {
  const [metadataText, elevations] = await Promise.all([
    readFile(
      new URL(`../public/data/${stem}.json`, import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(`../public/data/${stem}.int16`, import.meta.url),
    ),
  ]);
  return { metadata: JSON.parse(metadataText), elevations };
}

test("the bundled Everest DEM levels match their source manifests", async () => {
  for (const expected of layers) {
    const { metadata, elevations } = await readLayer(expected.stem);

    assert.equal(metadata.source, "Copernicus WorldDEM-30 (GLO-30)");
    assert.equal(metadata.sourceResolutionM, 30);
    assert.equal(metadata.lod, expected.lod);
    assert.equal(metadata.displayResolutionM, expected.displayResolutionM);
    assert.equal(
      elevations.byteLength,
      metadata.width * metadata.height * 2,
    );
    assert.equal(
      createHash("sha256").update(elevations).digest("hex"),
      metadata.sha256,
    );
    assert.ok(metadata.maximumM > 8_700);
  }
});

test("the real terrain LODs nest around Everest and reach beyond 100 km", async () => {
  const [{ metadata: core }, { metadata: mid }, { metadata: far }] =
    await Promise.all(layers.map((layer) => readLayer(layer.stem)));

  assert.ok(core.bounds.west > mid.bounds.west);
  assert.ok(core.bounds.east < mid.bounds.east);
  assert.ok(core.bounds.south > mid.bounds.south);
  assert.ok(core.bounds.north < mid.bounds.north);
  assert.ok(mid.bounds.west > far.bounds.west);
  assert.ok(mid.bounds.east < far.bounds.east);
  assert.ok(mid.bounds.south > far.bounds.south);
  assert.ok(mid.bounds.north < far.bounds.north);

  const northSouthCoverageKm =
    (far.bounds.north - far.bounds.south) * 111.32;
  assert.ok(northSouthCoverageKm > 100);
  assert.ok(Math.abs(core.maximumCoordinate.latitude - 27.9881) < 0.003);
  assert.ok(Math.abs(core.maximumCoordinate.longitude - 86.925) < 0.003);
});
