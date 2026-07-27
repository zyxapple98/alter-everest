import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function command(file, args) {
  try {
    const result = await execute(file, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    });
    return result.stdout.trim();
  } catch {
    return null;
  }
}

const cwd = resolve(".");
const gitRoot = await command("git", ["rev-parse", "--show-toplevel"]);
const root = gitRoot ? resolve(gitRoot) : cwd;
const requiredFiles = [
  "AGENTS.md",
  "package.json",
  "package-lock.json",
  "protocol/player-rules.json",
  "world/snapshot.json",
];
const files = Object.fromEntries(
  await Promise.all(
    requiredFiles.map(async (path) => [
      path,
      await exists(join(root, path)),
    ]),
  ),
);
const nodeVersion = process.versions.node;
const [major, minor] = nodeVersion.split(".").map(Number);
const nodeSupported = major > 22 || (major === 22 && minor >= 13);
const dependenciesInstalled =
  (await exists(join(root, "node_modules", ".bin", "tsx"))) ||
  (await exists(join(root, "node_modules", ".bin", "tsx.cmd")));
const remoteLines =
  (await command("git", ["-C", root, "remote", "-v"])) ?? "";
const remotes = [
  ...new Map(
    remoteLines
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [name, url] = line.split(/\s+/);
        return [name, { name, url }];
      }),
  ).values(),
];
const branch = await command("git", [
  "-C",
  root,
  "branch",
  "--show-current",
]);
const githubLogin = await command("gh", [
  "api",
  "user",
  "--jq",
  ".login",
]);
const repositoryComplete =
  gitRoot !== null && Object.values(files).every(Boolean);
const readyForInspect =
  repositoryComplete && nodeSupported && dependenciesInstalled;

console.log(
  JSON.stringify(
    {
      repositoryRoot: root,
      invokedFromRepositoryRoot: cwd.toLowerCase() === root.toLowerCase(),
      repositoryComplete,
      files,
      runtime: {
        nodeVersion,
        required: ">=22.13.0",
        supported: nodeSupported,
        dependenciesInstalled,
      },
      git: {
        branch: branch || null,
        remotes,
      },
      github: {
        login: githubLogin,
        authenticated: githubLogin !== null,
        requiredNow: false,
        requiredForSubmission: true,
      },
      readyForInspect,
      next: !repositoryComplete
        ? "Open a complete Git checkout of the supplied repository URL, cd to its root, and rerun agent:doctor."
        : !nodeSupported
          ? "Install a supported Node.js runtime, then rerun agent:doctor."
          : !dependenciesInstalled
            ? "Run npm ci, then rerun agent:doctor."
            : "Read AGENTS.md completely, then run npm run agent:inspect and the exact local rehearsal.",
    },
    null,
    2,
  ),
);
if (!repositoryComplete || !nodeSupported) process.exitCode = 1;
