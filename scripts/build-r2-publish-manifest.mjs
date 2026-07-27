import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function repositoryPath(path) {
  const value = relative(process.cwd(), path).replaceAll("\\", "/");
  if (!value || value === ".." || value.startsWith("../")) {
    throw new Error(`Publish source is outside the repository: ${path}`);
  }
  return value;
}

async function immutableArtifact(source, key) {
  const bytes = await readFile(source);
  return {
    source: repositoryPath(source),
    key,
    sha256: sha256(bytes),
    contentType: "application/json",
    cacheControl: "public, max-age=31536000, immutable",
  };
}

const outputPath = argument("--out");
const candidateHash = argument("--candidate-hash");
const includeAll = process.argv.includes("--all");
if (!outputPath || (!candidateHash && !includeAll) || (candidateHash && includeAll)) {
  throw new Error(
    "Usage: node scripts/build-r2-publish-manifest.mjs (--candidate-hash <sha256> | --all) --out <manifest.json>",
  );
}
if (candidateHash && !/^[a-f0-9]{64}$/.test(candidateHash)) {
  throw new Error("Candidate hash must be a lowercase SHA-256 digest.");
}

const eventsDirectory = resolve("world/events");
const receiptsDirectory = resolve("world/receipts");
const proofsDirectory = resolve("world/proofs");
const snapshotPath = resolve("world/snapshot.json");
const badgesPath = resolve("public/data/world/badges.json");
const latestPath = resolve("public/data/world/latest.json");
const eventNames = (await readdir(eventsDirectory))
  .filter((name) => name.endsWith(".json"))
  .sort();
const selectedEvents = [];

for (const name of eventNames) {
  const source = resolve(eventsDirectory, name);
  const event = JSON.parse(await readFile(source, "utf8"));
  if (includeAll || event.candidateHash === candidateHash) {
    selectedEvents.push({ name, source, event });
  }
}

if (!includeAll && selectedEvents.length !== 1) {
  throw new Error(
    `Expected one canonical event for candidate hash ${candidateHash}; found ${selectedEvents.length}.`,
  );
}

const immutable = [];
for (const { name, source, event } of selectedEvents) {
  const proofPath = resolve(proofsDirectory, name);
  const receiptPath = resolve(receiptsDirectory, name);
  const proofBytes = await readFile(proofPath);
  if (sha256(proofBytes) !== event.candidateHash) {
    throw new Error(`Proof hash mismatch for ${name}.`);
  }
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  if (receipt.candidateHash !== event.candidateHash) {
    throw new Error(`Receipt candidate hash mismatch for ${name}.`);
  }

  const [eventArtifact, receiptArtifact, proofArtifact] = await Promise.all([
    immutableArtifact(source, `events/sha256/${sha256(await readFile(source))}.json`),
    immutableArtifact(
      receiptPath,
      `receipts/sha256/${sha256(await readFile(receiptPath))}.json`,
    ),
    immutableArtifact(proofPath, `proofs/sha256/${event.candidateHash}.json`),
  ]);
  immutable.push(eventArtifact, receiptArtifact, proofArtifact);
}

const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
const snapshotArtifact = await immutableArtifact(
  snapshotPath,
  `worlds/${snapshot.worldHash}.json`,
);
immutable.push(snapshotArtifact);

const latestFeed = JSON.parse(await readFile(latestPath, "utf8"));
for (const tile of latestFeed.surfaceTiles.tiles) {
  if (
    typeof tile.path !== "string" ||
    tile.path.startsWith("/") ||
    tile.path.includes("..") ||
    tile.path.includes("\\")
  ) {
    throw new Error("World feed contains an invalid surface tile path.");
  }
  immutable.push(
    await immutableArtifact(
      resolve(dirname(latestPath), tile.path),
      `world/${tile.path}`,
    ),
  );
}

const uniqueImmutable = [
  ...new Map(immutable.map((artifact) => [artifact.key, artifact])).values(),
];
const manifest = {
  schemaVersion: "1.0.0",
  worldHash: snapshot.worldHash,
  candidateHashes: selectedEvents.map(({ event }) => event.candidateHash),
  immutable: uniqueImmutable,
  mutable: [
    {
      source: repositoryPath(snapshotPath),
      key: "world/snapshot.json",
      contentType: "application/json",
      cacheControl: "public, max-age=15, must-revalidate",
    },
    {
      source: repositoryPath(badgesPath),
      key: "world/badges.json",
      contentType: "application/json",
      cacheControl: "public, max-age=300, must-revalidate",
    },
    {
      source: repositoryPath(latestPath),
      key: "world/latest.json",
      contentType: "application/json",
      cacheControl: "public, max-age=15, must-revalidate",
    },
  ],
};

const resolvedOutput = resolve(outputPath);
await mkdir(dirname(resolvedOutput), { recursive: true });
await writeFile(resolvedOutput, `${JSON.stringify(manifest, null, 2)}\n`, {
  flag: "w",
});
console.log(
  JSON.stringify(
    {
      manifest: resolvedOutput,
      worldHash: manifest.worldHash,
      immutableObjects: manifest.immutable.length,
      mutablePointers: manifest.mutable.length,
    },
    null,
    2,
  ),
);
