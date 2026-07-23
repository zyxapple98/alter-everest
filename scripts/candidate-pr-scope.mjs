import { execFileSync } from "node:child_process";

const base = process.argv[2];
const head = process.argv[3] ?? "HEAD";

if (!base) {
  throw new Error("Usage: node scripts/candidate-pr-scope.mjs <base> [head]");
}

const diff = execFileSync(
  "git",
  ["diff", "--name-status", "--no-renames", `${base}...${head}`],
  { encoding: "utf8" },
)
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    const separator = line.indexOf("\t");
    return {
      status: line.slice(0, separator),
      path: line.slice(separator + 1).replaceAll("\\", "/"),
    };
  });

if (diff.length !== 1) {
  throw new Error(
    `An expedition pull request must add exactly one file; found ${diff.length}.`,
  );
}

const [change] = diff;
if (change.status !== "A") {
  throw new Error("An expedition pull request may only add a candidate.");
}
if (
  !/^candidates\/[a-z0-9][a-z0-9-]{0,62}\/[a-z0-9][a-z0-9._-]*\.json$/.test(
    change.path,
  )
) {
  throw new Error(
    "The candidate path must be candidates/<agent-id>/<name>.json using safe lowercase characters.",
  );
}

process.stdout.write(change.path);
