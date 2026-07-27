import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function git(args: string[]) {
  const result = await execute("git", args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  return result.stdout.trim();
}

if (process.argv.includes("--help")) {
  console.log(
    [
      "authority:check",
      "",
      "Compare local world/protocol authority with the canonical Git remote without changing working-tree files.",
      "",
      "Usage: npm run authority:check -- [--remote <name>] [--branch <name>] [--fetch]",
      "",
      "--fetch explicitly refreshes the remote-tracking ref before comparison.",
      "The command never merges, rebases, resets or rewrites a candidate.",
    ].join("\n"),
  );
  process.exit(0);
}

const remotes = (await git(["remote"]))
  .split(/\r?\n/)
  .filter(Boolean);
const remote =
  argument("--remote") ??
  (remotes.includes("upstream") ? "upstream" : "origin");
if (!remotes.includes(remote)) {
  throw new Error(
    `Unknown remote "${remote}". Available: ${remotes.join(", ") || "none"}`,
  );
}
const branch = argument("--branch") ?? "main";
const remoteUrl = await git(["remote", "get-url", remote]);
const lsRemote = await git(["ls-remote", remoteUrl, `refs/heads/${branch}`]);
const remoteHead = lsRemote.split(/\s+/)[0] || null;
if (!remoteHead) {
  throw new Error(`Remote ${remote} has no branch ${branch}.`);
}
if (process.argv.includes("--fetch")) {
  await git(["fetch", "--no-tags", remote, branch]);
}
const trackingRef = `refs/remotes/${remote}/${branch}`;
let fetchedHead: string | null = null;
try {
  fetchedHead = await git(["rev-parse", trackingRef]);
} catch {
  // A non-fetched clone can still report the remote head.
}
const localHead = await git(["rev-parse", "HEAD"]);
let remoteIsAncestor = false;
try {
  await git(["merge-base", "--is-ancestor", remoteHead, localHead]);
  remoteIsAncestor = true;
} catch {
  // A candidate branch must contain the current canonical branch.
}

async function localJson(path: string) {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function remoteJson(path: string) {
  if (!fetchedHead || fetchedHead !== remoteHead) return null;
  return JSON.parse(
    await git(["show", `${trackingRef}:${path}`]),
  ) as Record<string, unknown>;
}

const [localWorld, localManifest, localRelease] = await Promise.all([
  localJson("world/snapshot.json"),
  localJson("protocol/manifest.json"),
  localJson("protocol/release.json"),
]);
const [remoteWorld, remoteManifest, remoteRelease] = await Promise.all([
  remoteJson("world/snapshot.json"),
  remoteJson("protocol/manifest.json"),
  remoteJson("protocol/release.json"),
]);

const localAuthority = {
  worldHash: localWorld.worldHash ?? null,
  terrainHash: localWorld.terrainHash ?? null,
  protocolVersion: localManifest.protocolVersion ?? null,
  verifierReleaseHash: localRelease.verifierSourceSha256 ?? null,
};
const remoteAuthority = remoteWorld
  ? {
      worldHash: remoteWorld.worldHash ?? null,
      terrainHash: remoteWorld.terrainHash ?? null,
      protocolVersion: remoteManifest?.protocolVersion ?? null,
      verifierReleaseHash:
        remoteRelease?.verifierSourceSha256 ?? null,
    }
  : null;
const changed = remoteAuthority
  ? Object.keys(localAuthority).filter(
      (key) =>
        localAuthority[key as keyof typeof localAuthority] !==
        remoteAuthority[key as keyof typeof remoteAuthority],
    )
  : [];
const fresh =
  remoteAuthority !== null &&
  remoteIsAncestor &&
  changed.length === 0;

console.log(
  JSON.stringify(
    {
      fresh,
      remote,
      branch,
      remoteUrl,
      localHead,
      remoteHead,
      fetchedHead,
      remoteIsAncestor,
      remoteAuthorityKnown: remoteAuthority !== null,
      localAuthority,
      remoteAuthority,
      changed,
      next: fresh
        ? "Authority is current. Recompile and run the complete verifier immediately before submission."
        : remoteAuthority === null
          ? `Run authority:check with --fetch to inspect ${remote}/${branch} authority.`
          : !remoteIsAncestor
            ? "Update or rebase onto the canonical branch, regenerate the candidate, and rerun expedition:check."
            : "Canonical authority changed. Regenerate the candidate and rerun expedition:check.",
    },
    null,
    2,
  ),
);
if (!fresh) process.exitCode = 1;
