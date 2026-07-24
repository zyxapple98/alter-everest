import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildSpatialManifest } from "../engine/world";
import type { CanonicalWorld } from "../engine/types";

const paths =
  process.argv.length > 2
    ? process.argv.slice(2).map((path) => resolve(path))
    : [resolve("world", "snapshot.json")];

for (const path of paths) {
  const world = JSON.parse(await readFile(path, "utf8")) as CanonicalWorld;
  world.removedTerrainVoxels ??= [];
  Object.assign(
    world,
    await buildSpatialManifest(
      world.stones,
      world.removedTerrainVoxels,
    ),
  );
  await writeFile(path, `${JSON.stringify(world, null, 2)}\n`);
  console.log(`Rebuilt spatial manifest: ${path}`);
}
