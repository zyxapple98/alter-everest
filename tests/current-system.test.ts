import assert from "node:assert/strict";
import {
  access,
  readdir,
  readFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { computeWorldHash } from "../engine/world";

const root = resolve(".");

async function json(path: string) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

async function jsonNames(path: string) {
  try {
    return (await readdir(resolve(root, path)))
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function assertNoRetiredFields(value: unknown, location: string) {
  const retired = new Set([
    "score",
    `oxygen${"Used"}`,
    `pickup${"Index"}`,
    `release${"Index"}`,
    "mutation",
  ]);
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoRetiredFields(entry, `${location}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    assert.equal(
      retired.has(key),
      false,
      `${location} contains retired field ${key}`,
    );
    assertNoRetiredFields(entry, `${location}.${key}`);
  }
}

test("repository data exposes one current expedition system", async () => {
  const [manifest, schema, world, feed, packageJson] =
    await Promise.all([
      json("protocol/manifest.json"),
      json("schemas/candidate.schema.json"),
      json("world/snapshot.json"),
      json("public/data/world/latest.json"),
      json("package.json"),
    ]);

  assert.equal(manifest.protocolVersion, "0.7.0");
  assert.equal(schema.properties.protocol.const, manifest.protocolVersion);
  assert.equal(schema.$defs.route.properties.codec.const, "ae-microtrace-v1");
  assert.equal(schema.$defs.proof.required.includes("actions"), true);
  assert.equal(packageJson.scripts["route:encode"].includes("encode-route"), true);

  assert.deepEqual(Object.keys(world).sort(), [
    "alterations",
    "baseCamp",
    "expeditions",
    "extractionZones",
    "footprints",
    "identities",
    "modifiedChunks",
    "modifiedTiles",
    "removedTerrainVoxels",
    "sequence",
    "stones",
    "terrainHash",
    "tombstones",
    "worldHash",
  ]);
  assert.equal(world.worldHash, await computeWorldHash(world));
  assertNoRetiredFields(world, "world/snapshot.json");

  const rehearsalWorld = await json(
    "examples/example-agent/rehearsal-world.json",
  );
  assert.equal(rehearsalWorld.sequence, 0);
  assert.deepEqual(rehearsalWorld.stones, []);
  assert.deepEqual(rehearsalWorld.expeditions, []);
  assert.equal(
    rehearsalWorld.worldHash,
    await computeWorldHash(rehearsalWorld),
  );
  assertNoRetiredFields(
    rehearsalWorld,
    "examples/example-agent/rehearsal-world.json",
  );

  for (const path of [
    "examples/example-agent/first-marker-roundtrip.json",
    "tests/fixtures/everest-one-way-candidate.json",
  ]) {
    const candidate = await json(path);
    assert.equal(candidate.protocol, manifest.protocolVersion, path);
    assert.equal(candidate.proof.route.codec, "ae-microtrace-v1", path);
    assert.equal(Array.isArray(candidate.proof.route), false, path);
    assertNoRetiredFields(candidate, path);
  }

  const eventNames = await jsonNames("world/events");
  const proofNames = await jsonNames("world/proofs");
  const receiptNames = await jsonNames("world/receipts");
  assert.deepEqual(proofNames, eventNames);
  assert.deepEqual(receiptNames, eventNames);
  for (const name of eventNames) {
    const [event, proof, receipt] = await Promise.all([
      json(`world/events/${name}`),
      json(`world/proofs/${name}`),
      json(`world/receipts/${name}`),
    ]);
    assert.equal(event.eventVersion, "1.2.0", name);
    assert.equal(proof.protocol, manifest.protocolVersion, name);
    assert.equal(receipt.receiptVersion, "1.3.0", name);
    assertNoRetiredFields(event, `world/events/${name}`);
    assertNoRetiredFields(proof, `world/proofs/${name}`);
    assertNoRetiredFields(receipt, `world/receipts/${name}`);
  }

  assert.equal(feed.schemaVersion, "1.5.0");
  assert.equal(feed.sequence, world.sequence);
  assert.equal(feed.worldHash, world.worldHash);
  assert.ok(feed.everestSummit);
  assert.ok(feed.surfaceTiles);
  assert.equal(Object.hasOwn(feed, "surfaceDelta"), false);
  const feedTiles = feed.surfaceTiles.tiles
    .map((tile: { path: string }) => tile.path.replace(/^tiles\//, ""))
    .sort();
  assert.deepEqual(
    await jsonNames("public/data/world/tiles"),
    feedTiles,
    "surface tile directory must exactly match the current feed manifest",
  );

  for (const path of [
    "docs/AGENT-ONBOARDING.md",
    "docs/AGENT-PROTOCOL.md",
    "docs/BUILD-HANDBOOK.md",
    "docs/BASE-MATTER-DESIGN.md",
    "docs/FIRST-EXPEDITION.md",
    "docs/PHYSICS.md",
    "docs/PLAY.md",
    "docs/PLAYTEST-30-AGENTS.md",
    "docs/PROTOCOL-0.6-MIGRATION.md",
    "engine/clearance.ts",
    "engine/scoring.ts",
    "scripts/annotate-route.ts",
    "public/data/playtest-world",
  ]) {
    await assert.rejects(access(resolve(root, path)), /ENOENT/, path);
  }
});
