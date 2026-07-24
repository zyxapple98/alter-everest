import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const AUTHORITY_FILES = [
  "lib/protocol.ts",
  "lib/receipt.ts",
  "package-lock.json",
  "package.json",
  "protocol/manifest.json",
  "schemas/candidate.schema.json",
  "scripts/expedition-kit.ts",
  "scripts/verification.ts",
  "scripts/verifier-integrity.ts",
];

async function engineFiles(root: string) {
  const directory = resolve(root, "engine");
  const names = await readdir(directory);
  return names
    .filter((name) => name.endsWith(".ts"))
    .map((name) => relative(root, resolve(directory, name)).replaceAll("\\", "/"));
}

export function sha256Bytes(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function computeVerifierHash(root = PROJECT_ROOT) {
  const paths = [...AUTHORITY_FILES, ...(await engineFiles(root))].sort();
  const digest = createHash("sha256");

  for (const path of paths) {
    const source = await readFile(resolve(root, path), "utf8");
    digest.update(path);
    digest.update("\0");
    digest.update(source.replaceAll("\r\n", "\n"));
    digest.update("\0");
  }

  return digest.digest("hex");
}
