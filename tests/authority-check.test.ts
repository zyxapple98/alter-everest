import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const projectRoot = resolve(".");
const authorityScript = resolve("scripts/check-authority.ts");
const tsxLoader = import.meta.resolve("tsx");

async function git(cwd: string, args: string[]) {
  return execute("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
}

async function authority(cwd: string) {
  try {
    const result = await execute(
      process.execPath,
      ["--import", tsxLoader, authorityScript, "--fetch"],
      { cwd, encoding: "utf8", windowsHide: true },
    );
    return {
      exitCode: 0,
      output: JSON.parse(result.stdout),
    };
  } catch (error) {
    const failed = error as Error & {
      code: number;
      stdout: string;
    };
    return {
      exitCode: failed.code,
      output: JSON.parse(failed.stdout),
    };
  }
}

test("authority freshness accepts an ahead candidate branch but rejects an outdated base", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ae-authority-"));
  const source = join(directory, "source");
  const remote = join(directory, "remote.git");
  const candidate = join(directory, "candidate");
  try {
    await mkdir(source);
    await git(source, ["init", "-b", "main"]);
    await git(source, ["config", "user.name", "Authority Test"]);
    await git(source, ["config", "user.email", "authority@example.invalid"]);
    for (const path of [
      "world/snapshot.json",
      "protocol/manifest.json",
      "protocol/release.json",
    ]) {
      const target = join(source, path);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(resolve(projectRoot, path), target);
    }
    await git(source, ["add", "."]);
    await git(source, ["commit", "-m", "canonical authority"]);

    await mkdir(remote);
    await git(remote, ["init", "--bare"]);
    await git(remote, ["symbolic-ref", "HEAD", "refs/heads/main"]);
    await git(source, ["remote", "add", "origin", remote]);
    await git(source, ["push", "-u", "origin", "main"]);
    await git(directory, ["clone", remote, candidate]);
    await git(candidate, ["config", "user.name", "Candidate Test"]);
    await git(candidate, ["config", "user.email", "candidate@example.invalid"]);
    await git(candidate, ["checkout", "-b", "expedition"]);
    await writeFile(join(candidate, "candidate-marker.txt"), "candidate\n");
    await git(candidate, ["add", "candidate-marker.txt"]);
    await git(candidate, ["commit", "-m", "candidate"]);

    const ahead = await authority(candidate);
    assert.equal(ahead.exitCode, 0);
    assert.equal(ahead.output.fresh, true);
    assert.equal(ahead.output.remoteIsAncestor, true);
    assert.notEqual(ahead.output.localHead, ahead.output.remoteHead);

    await writeFile(join(source, "unrelated.txt"), "new canonical commit\n");
    await git(source, ["add", "unrelated.txt"]);
    await git(source, ["commit", "-m", "advance canonical main"]);
    await git(source, ["push", "origin", "main"]);

    const outdated = await authority(candidate);
    assert.notEqual(outdated.exitCode, 0);
    assert.equal(outdated.output.fresh, false);
    assert.equal(outdated.output.remoteIsAncestor, false);
    assert.deepEqual(outdated.output.changed, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
