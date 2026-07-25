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
const pullRequestState = String(pullRequest.state ?? "open");

const files = [];
for (let page = 1; page <= 2; page += 1) {
  const batch = await github(
    `/repos/${repository}/pulls/${pullNumber}/files?per_page=100&page=${page}`,
  );
  files.push(...batch);
  if (batch.length < 100) break;
}

const safePath =
  /^candidates\/[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9][a-z0-9._-]{0,127}\.json$/;
const expectedDirectory = actor.toLowerCase();

function isCandidateOnlyChange(changes) {
  if (changes.length !== 1) return false;
  const [candidateChange] = changes;
  const path = String(candidateChange.filename ?? "").replaceAll("\\", "/");
  return (
    candidateChange.status === "added" &&
    safePath.test(path) &&
    path.split("/")[1] === expectedDirectory
  );
}

if (files.length !== 1) {
  throw new Error(
    `An expedition pull request must add exactly one file; found ${files.length}.`,
  );
}

const [change] = files;
const candidatePath = String(change.filename ?? "").replaceAll("\\", "/");

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

if (process.env.GITHUB_RUN_ID && !allowApplied) {
  const runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT ?? "1");
  if (!Number.isInteger(runAttempt) || runAttempt !== 1) {
    throw new Error(
      "Authoritative verifier jobs cannot be manually re-run. Push a new candidate head to request another attempt.",
    );
  }

  const acceptedCount = (canonicalWorld.expeditions ?? []).filter(
    (expedition) =>
      String(expedition.agentId).toLowerCase() === actor.toLowerCase(),
  ).length;
  const limits =
    acceptedCount === 0
      ? { hourly: 6, daily: 12 }
      : acceptedCount < 10
        ? { hourly: 10, daily: 30 }
        : { hourly: 20, daily: 100 };
  const now = Date.now();

  const markerName = `expedition-admission-${actor.toLowerCase()}`;
  const artifacts = [];
  for (let page = 1; page <= 2; page += 1) {
    const query = new URLSearchParams({
      name: markerName,
      per_page: "100",
      page: String(page),
    });
    const result = await github(
      `/repos/${repository}/actions/artifacts?${query}`,
    );
    if (Number(result.total_count ?? 0) > 200) {
      throw new Error(
        "The verifier rate window is too large to evaluate safely.",
      );
    }
    artifacts.push(...(result.artifacts ?? []));
    if ((result.artifacts ?? []).length < 100) break;
  }
  const startsByHead = new Map();
  for (const artifact of artifacts.filter((item) => !item.expired)) {
    const markerHead = String(artifact.workflow_run?.head_sha ?? "");
    const createdAt = Date.parse(String(artifact.created_at ?? ""));
    if (!markerHead || !Number.isFinite(createdAt)) {
      throw new Error("A verifier admission marker has invalid provenance.");
    }
    const existing = startsByHead.get(markerHead);
    if (existing === undefined || createdAt < existing) {
      startsByHead.set(markerHead, createdAt);
    }
  }
  if (startsByHead.has(headSha)) {
    throw new Error(
      "This exact candidate head already started the authoritative verifier. Push a new candidate head to request another attempt.",
    );
  }
  const createdTimes = [...startsByHead.values()];
  const countVerifierStartsSince = (milliseconds) =>
    createdTimes.filter((createdAt) => createdAt >= now - milliseconds).length;
  const hourlyStarts = countVerifierStartsSince(60 * 60 * 1000);
  const dailyStarts = countVerifierStartsSince(24 * 60 * 60 * 1000);
  if (hourlyStarts >= limits.hourly) {
    throw new Error(
      `This identity reached its verifier limit of ${limits.hourly} starts in one hour.`,
    );
  }
  if (dailyStarts >= limits.daily) {
    throw new Error(
      `This identity reached its daily verifier limit of ${limits.daily}.`,
    );
  }
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
  if (isCandidateOnlyChange(otherFiles)) {
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
const eventsArgument = argument("--events-dir");
const eventsDirectory = eventsArgument
  ? resolve(eventsArgument)
  : new URL("../world/events/", import.meta.url);
const eventNames = (await readdir(eventsDirectory)).filter((name) =>
  name.endsWith(".json"),
);
let matchingCanonicalEvent = null;

for (const eventName of eventNames) {
  const eventPath =
    eventsDirectory instanceof URL
      ? new URL(eventName, eventsDirectory)
      : resolve(eventsDirectory, eventName);
  const event = JSON.parse(await readFile(eventPath, "utf8"));
  if (event.candidateHash === candidateHash) {
    matchingCanonicalEvent = event;
    break;
  }
}

if (
  pullRequestState !== "open" &&
  !(allowApplied && matchingCanonicalEvent)
) {
  throw new Error(
    "A closed expedition pull request may only replay bytes already present in the canonical event log.",
  );
}

if (!allowApplied) {
  if (
    typeof candidate.id === "string" &&
    (canonicalWorld.expeditions ?? []).some(
      (expedition) => expedition.id === candidate.id,
    )
  ) {
    throw new Error("This candidate ID is already part of the canonical world.");
  }

  if (matchingCanonicalEvent) {
    throw new Error(
      "These exact candidate bytes are already part of the canonical world.",
    );
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
