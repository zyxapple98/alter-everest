import { createHash } from "node:crypto";
import {
  appendFile,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

const eventPath = argument("--event") ?? process.env.GITHUB_EVENT_PATH;
const outputPath = argument("--out");
const token = process.env.GITHUB_TOKEN;
const allowApplied = process.argv.includes("--allow-applied");

if (!eventPath || !outputPath || !token) {
  throw new Error(
    "Usage: node scripts/admit-candidate-pr.mjs --event <event.json> --out <candidate.json>",
  );
}

const [event, protocolManifest, canonicalWorld] = await Promise.all([
  readFile(resolve(eventPath), "utf8").then(JSON.parse),
  readFile(new URL("../protocol/manifest.json", import.meta.url), "utf8").then(
    JSON.parse,
  ),
  readFile(new URL("../world/snapshot.json", import.meta.url), "utf8").then(
    JSON.parse,
  ),
]);

const repository = event.repository?.full_name;
const pullNumber = Number(
  event.pull_request?.number ?? event.client_payload?.pull_number,
);
if (!repository || !Number.isInteger(pullNumber) || pullNumber < 1) {
  throw new Error("The event does not identify a GitHub pull request.");
}

const apiBase = process.env.GITHUB_API_URL ?? "https://api.github.com";
const headers = {
  accept: "application/vnd.github+json",
  authorization: `Bearer ${token}`,
  "user-agent": "alter-everest-admission",
  "x-github-api-version": "2022-11-28",
};

async function github(path) {
  const response = await fetch(`${apiBase}${path}`, { headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status}: ${body.slice(0, 500)}`);
  }
  return response.json();
}

const pullRequest =
  event.pull_request ??
  (await github(`/repos/${repository}/pulls/${pullNumber}`));
const actor = String(pullRequest.user?.login ?? "");
const headSha = String(pullRequest.head?.sha ?? "");
const expectedHead = argument("--expected-head");
if (!actor || !headSha) {
  throw new Error("Pull-request identity metadata is incomplete.");
}
if (expectedHead && expectedHead !== headSha) {
  throw new Error(
    `The verified head ${expectedHead} is stale; the pull request is now ${headSha}.`,
  );
}
if (pullRequest.state && pullRequest.state !== "open") {
  throw new Error("The expedition pull request is no longer open.");
}

if (process.env.GITHUB_RUN_ID) {
  const acceptedBefore = (canonicalWorld.expeditions ?? []).some(
    (expedition) => expedition.agentId === actor,
  );
  const dailyLimit = acceptedBefore ? 30 : 3;
  const now = Date.now();
  const countRunsSince = async (milliseconds) => {
    const created = new Date(now - milliseconds).toISOString();
    const query = new URLSearchParams({
      actor,
      event: "pull_request_target",
      created: `>=${created}`,
      per_page: "1",
    });
    const result = await github(
      `/repos/${repository}/actions/workflows/expedition.yml/runs?${query}`,
    );
    return Number(result.total_count ?? 0);
  };
  const [hourlyRuns, dailyRuns] = await Promise.all([
    countRunsSince(60 * 60 * 1000),
    countRunsSince(24 * 60 * 60 * 1000),
  ]);
  if (hourlyRuns > 6) {
    throw new Error("This identity exceeded six verifier runs in one hour.");
  }
  if (dailyRuns > dailyLimit) {
    throw new Error(
      `This identity exceeded its daily verifier limit of ${dailyLimit}.`,
    );
  }
}

const files = [];
for (let page = 1; page <= 2; page += 1) {
  const batch = await github(
    `/repos/${repository}/pulls/${pullNumber}/files?per_page=100&page=${page}`,
  );
  files.push(...batch);
  if (batch.length < 100) break;
}

if (files.length !== 1) {
  throw new Error(
    `An expedition pull request must add exactly one file; found ${files.length}.`,
  );
}

const [change] = files;
const candidatePath = String(change.filename ?? "").replaceAll("\\", "/");
const expectedDirectory = actor.toLowerCase();
const safePath =
  /^candidates\/[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9][a-z0-9._-]{0,127}\.json$/;

if (change.status !== "added") {
  throw new Error("An expedition pull request may only add a new candidate.");
}
if (!safePath.test(candidatePath)) {
  throw new Error(
    "Candidate path must be candidates/<github-login>/<candidate-id>.json.",
  );
}
if (candidatePath.split("/")[1] !== expectedDirectory) {
  throw new Error(
    `Candidate directory must match the pull-request author: ${expectedDirectory}.`,
  );
}

const openByActor = await github(
  `/search/issues?q=${encodeURIComponent(
    `repo:${repository} is:pr is:open author:${actor}`,
  )}&per_page=10`,
);
for (const item of openByActor.items ?? []) {
  const otherNumber = Number(item.number);
  if (otherNumber >= pullNumber) continue;
  const otherFiles = await github(
    `/repos/${repository}/pulls/${otherNumber}/files?per_page=2&page=1`,
  );
  if (
    otherFiles.some((file) =>
      String(file.filename ?? "").replaceAll("\\", "/").startsWith("candidates/"),
    )
  ) {
    throw new Error(
      "Only the oldest open expedition pull request for an identity may enter admission.",
    );
  }
}

const encodedPath = candidatePath
  .split("/")
  .map(encodeURIComponent)
  .join("/");
const content = await github(
  `/repos/${repository}/contents/${encodedPath}?ref=${encodeURIComponent(headSha)}`,
);
if (content.type !== "file" || content.encoding !== "base64") {
  throw new Error("Candidate must be a regular Git blob.");
}
if (content.size > protocolManifest.candidate.maximumBytes) {
  throw new Error(
    `Candidate exceeds ${protocolManifest.candidate.maximumBytes} bytes.`,
  );
}

const bytes = Buffer.from(String(content.content).replace(/\s/g, ""), "base64");
if (bytes.byteLength !== content.size) {
  throw new Error("Candidate byte count does not match the Git blob metadata.");
}
const candidate = JSON.parse(bytes.toString("utf8"));
const candidateHash = createHash("sha256").update(bytes).digest("hex");

if (!allowApplied) {
  if (
    typeof candidate.id === "string" &&
    (canonicalWorld.expeditions ?? []).some(
      (expedition) => expedition.id === candidate.id,
    )
  ) {
    throw new Error("This candidate ID is already part of the canonical world.");
  }

  const eventsArgument = argument("--events-dir");
  const eventsDirectory = eventsArgument
    ? resolve(eventsArgument)
    : new URL("../world/events/", import.meta.url);
  const eventNames = (await readdir(eventsDirectory)).filter((name) =>
    name.endsWith(".json"),
  );
  for (const eventName of eventNames) {
    const eventPath =
      eventsDirectory instanceof URL
        ? new URL(eventName, eventsDirectory)
        : resolve(eventsDirectory, eventName);
    const event = JSON.parse(
      await readFile(eventPath, "utf8"),
    );
    if (event.candidateHash === candidateHash) {
      throw new Error(
        "These exact candidate bytes are already part of the canonical world.",
      );
    }
  }
}

const resolvedOutput = resolve(outputPath);
await writeFile(resolvedOutput, bytes, { flag: "wx" });

if (process.env.GITHUB_OUTPUT) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    [
      `actor=${actor}`,
      `candidate_path=${candidatePath}`,
      `candidate_file=${resolvedOutput}`,
      `candidate_blob_sha=${content.sha}`,
      `candidate_hash=${candidateHash}`,
      `head_sha=${headSha}`,
      `pull_number=${pullNumber}`,
      "",
    ].join("\n"),
  );
}

console.log(
  JSON.stringify(
    {
      admitted: true,
      actor,
      pullNumber,
      candidatePath,
      candidateBytes: bytes.byteLength,
      candidateBlobSha: content.sha,
      candidateHash,
      headSha,
    },
    null,
    2,
  ),
);
