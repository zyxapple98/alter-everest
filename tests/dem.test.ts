import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the bundled Everest DEM matches its source manifest", async () => {
  const [metadataText, elevations] = await Promise.all([
    readFile(new URL("../public/data/everest-dem.json", import.meta.url), "utf8"),
    readFile(new URL("../public/data/everest-dem.int16", import.meta.url)),
  ]);
  const metadata = JSON.parse(metadataText);

  assert.equal(metadata.source, "Copernicus WorldDEM-30 (GLO-30)");
  assert.equal(metadata.sourceResolutionM, 30);
  assert.equal(elevations.byteLength, metadata.width * metadata.height * 2);
  assert.equal(
    createHash("sha256").update(elevations).digest("hex"),
    metadata.sha256,
  );
  assert.ok(Math.abs(metadata.maximumCoordinate.latitude - 27.9881) < 0.003);
  assert.ok(Math.abs(metadata.maximumCoordinate.longitude - 86.925) < 0.003);
  assert.ok(metadata.maximumM > 8_700);
});
