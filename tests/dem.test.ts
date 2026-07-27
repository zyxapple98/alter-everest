import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CLIMBER, TERRAIN } from "../engine/constants";
import {
  chunkForVoxel,
  syntheticReliefM,
  tileForVoxel,
} from "../engine/surface";
import { loadDemBundle } from "../scripts/expedition-kit";

const layers = [
  {
    stem: "everest-dem-authority",
    lod: "authority",
    displayResolutionM: 30,
  },
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
  const [
    { metadata: authority },
    { metadata: core },
    { metadata: mid },
    { metadata: far },
  ] = await Promise.all(layers.map((layer) => readLayer(layer.stem)));

  assert.ok(authority.bounds.north >= 28.19);
  assert.ok(authority.bounds.south <= 27.91);
  assert.ok(authority.bounds.west <= 86.79);
  assert.ok(authority.bounds.east >= 87.06);
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

test("the authoritative route grid contains both south and north bases", async () => {
  const terrain = await loadDemBundle();
  const registration = terrain.config.registration;
  const longitudeScale =
    111_320 * Math.cos((registration.originLatitude * Math.PI) / 180);
  const local = (latitude: number, longitude: number) => ({
    x: (longitude - registration.originLongitude) * longitudeScale,
    z: (registration.originLatitude - latitude) * 111_320,
  });
  const south = local(28.0026, 86.8528);
  const north = local(28.142, 86.852);
  assert.ok(terrain.oracle.sample(south.x, south.z));
  assert.ok(terrain.oracle.sample(north.x, north.z));
});

test("the canonical spawn is the sole Base site and lies on the DEM", async () => {
  const [terrain, sites, world] = await Promise.all([
    loadDemBundle(),
    readFile(new URL("../world/sites.json", import.meta.url), "utf8").then(
      JSON.parse,
    ),
    readFile(new URL("../world/snapshot.json", import.meta.url), "utf8").then(
      JSON.parse,
    ),
  ]);
  const bases = sites.sites.filter(
    (site: { kind: string }) => site.kind === "BASE",
  );
  assert.equal(bases.length, 1);

  const [base] = bases;
  assert.equal(base.id, "south-base-camp");
  assert.equal(base.radiusM, CLIMBER.baseCampRadiusM);
  const registration = terrain.config.registration;
  const longitudeScale =
    111_320 * Math.cos((registration.originLatitude * Math.PI) / 180);
  const expected = {
    x: (base.longitude - registration.originLongitude) * longitudeScale,
    z: (registration.originLatitude - base.latitude) * 111_320,
  };
  const surface = terrain.oracle.sample(expected.x, expected.z);
  assert.ok(surface);
  assert.deepEqual(world.baseCamp, {
    x: expected.x,
    y: surface.y,
    z: expected.z,
  });
});

test("the observatory exposes fifteen synchronized real route sites", async () => {
  const [canonical, published] = await Promise.all([
    readFile(new URL("../world/sites.json", import.meta.url), "utf8").then(
      JSON.parse,
    ),
    readFile(
      new URL("../public/data/sites.json", import.meta.url),
      "utf8",
    ).then(JSON.parse),
  ]);
  assert.equal(canonical.sites.length, 15);
  assert.deepEqual(published, canonical);
  for (const id of [
    "south-camp-1",
    "western-cwm",
    "south-camp-2",
    "south-camp-3",
    "geneva-spur",
    "the-balcony",
    "south-summit",
    "hillary-step",
  ]) {
    assert.ok(canonical.sites.some((site: { id: string }) => site.id === id));
  }
});

test("naturalized 20 cm columns map deterministically into 32 m chunks and 256 m tiles", () => {
  assert.equal(syntheticReliefM(123.4, -987.6), syntheticReliefM(123.4, -987.6));
  assert.ok(Math.abs(syntheticReliefM(123.4, -987.6)) <= 0.42);
  const voxel = {
    x: Math.floor(40 / TERRAIN.voxelEdgeM),
    y: 0,
    z: Math.floor(-300 / TERRAIN.voxelEdgeM),
  };
  assert.deepEqual(chunkForVoxel(voxel), { x: 1, z: -10 });
  assert.deepEqual(tileForVoxel(voxel), { x: 0, z: -2 });
});
