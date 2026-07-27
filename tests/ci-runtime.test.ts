import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("expedition CI keeps its protected runtime minimal and verifier-bound", async () => {
  const [manifestText, lockText, dockerfile, reducer, integritySource] =
    await Promise.all(
      [
        "ci/expedition-runtime/package.json",
        "ci/expedition-runtime/package-lock.json",
        "Dockerfile.verifier",
        ".github/workflows/reduce.yml",
        "scripts/verifier-integrity.ts",
      ].map((path) => readFile(path, "utf8")),
    );
  const manifest = JSON.parse(manifestText);
  const lock = JSON.parse(lockText);

  assert.deepEqual(manifest.dependencies, { tsx: "4.23.1" });
  assert.deepEqual(lock.packages[""].dependencies, manifest.dependencies);
  assert.ok(
    Object.keys(lock.packages)
      .filter(Boolean)
      .every(
        (path) =>
          path === "node_modules/tsx" ||
          path === "node_modules/esbuild" ||
          path === "node_modules/fsevents" ||
          path.startsWith("node_modules/@esbuild/"),
      ),
  );

  assert.match(
    dockerfile,
    /npm ci --ignore-scripts --no-audit --no-fund --prefix ci\/expedition-runtime/,
  );
  assert.match(
    dockerfile,
    /\.\/ci\/expedition-runtime\/node_modules\/tsx\/dist\/loader\.mjs/,
  );
  assert.match(
    reducer,
    /--prefix ci\/expedition-runtime/,
  );
  assert.match(
    integritySource,
    /"ci\/expedition-runtime\/package-lock\.json"/,
  );
});
