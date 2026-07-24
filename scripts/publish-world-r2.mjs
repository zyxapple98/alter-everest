import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeSource(source) {
  const root = resolve(".");
  const path = resolve(source);
  const relativePath = relative(root, path);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    throw new Error(`R2 publish source is outside the repository: ${source}`);
  }
  return path;
}

function validateArtifact(artifact, immutable) {
  if (
    !artifact ||
    typeof artifact.source !== "string" ||
    typeof artifact.key !== "string" ||
    typeof artifact.contentType !== "string" ||
    typeof artifact.cacheControl !== "string" ||
    artifact.key.startsWith("/") ||
    artifact.key.includes("..") ||
    artifact.key.includes("\\")
  ) {
    throw new Error("R2 publish manifest contains an invalid artifact.");
  }
  if (immutable && !/^[a-f0-9]{64}$/.test(artifact.sha256 ?? "")) {
    throw new Error(`Immutable artifact ${artifact.key} lacks a SHA-256 digest.`);
  }
}

const manifestPath = argument("--manifest");
const bucket = argument("--bucket") ?? process.env.WORLD_BUCKET;
const dryRun = process.argv.includes("--dry-run");
if (!manifestPath || !bucket) {
  throw new Error(
    "Usage: node scripts/publish-world-r2.mjs --manifest <manifest.json> [--bucket <name>] [--dry-run]",
  );
}
if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
  throw new Error("WORLD_BUCKET is not a valid R2 bucket name.");
}

const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
if (
  manifest.schemaVersion !== "1.0.0" ||
  !Array.isArray(manifest.immutable) ||
  !Array.isArray(manifest.mutable) ||
  manifest.mutable.at(-1)?.key !== "world/latest.json"
) {
  throw new Error(
    "R2 publish manifest must end with the world/latest.json pointer.",
  );
}

const artifacts = [
  ...manifest.immutable.map((artifact) => ({ ...artifact, immutable: true })),
  ...manifest.mutable.map((artifact) => ({ ...artifact, immutable: false })),
];
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const published = [];

for (const artifact of artifacts) {
  validateArtifact(artifact, artifact.immutable);
  const source = safeSource(artifact.source);
  const bytes = await readFile(source);
  const digest = sha256(bytes);
  if (artifact.immutable && digest !== artifact.sha256) {
    throw new Error(`Immutable artifact changed before publish: ${artifact.source}`);
  }

  if (!dryRun) {
    execFileSync(
      npx,
      [
        "--no-install",
        "wrangler",
        "r2",
        "object",
        "put",
        `${bucket}/${artifact.key}`,
        "--file",
        source,
        "--remote",
        "--force",
        "--content-type",
        artifact.contentType,
        "--cache-control",
        artifact.cacheControl,
      ],
      { stdio: "inherit" },
    );
  }
  published.push({ key: artifact.key, sha256: digest, dryRun });
}

console.log(
  JSON.stringify(
    {
      bucket,
      worldHash: manifest.worldHash,
      published,
    },
    null,
    2,
  ),
);
