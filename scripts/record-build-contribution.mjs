import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const BUILD_CATEGORY_SLUG = "builds";
const MAXIMUM_COMMENT_PAGES = 20;

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function safeRepository(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)
  );
}

function discussionNumberFromValue(value, repository) {
  const shortReference = value.match(/^#?([1-9]\d*)$/);
  if (shortReference) return Number(shortReference[1]);

  const urlReference = value.match(
    /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/discussions\/([1-9]\d*)(?:[/?#].*)?$/i,
  );
  if (!urlReference) return null;

  const referencedRepository = `${urlReference[1]}/${urlReference[2]}`;
  if (referencedRepository.toLowerCase() !== repository.toLowerCase()) {
    throw new Error(
      `Build-Thread must reference a Discussion in ${repository}.`,
    );
  }
  return Number(urlReference[3]);
}

export function parseBuildThreadReference(body, repository) {
  if (!safeRepository(repository)) {
    throw new Error("GITHUB_REPOSITORY must be an owner/name pair.");
  }
  if (typeof body !== "string" || body.length === 0) return null;

  const references = [];
  for (const line of body.split(/\r?\n/)) {
    const field = line.match(
      /^\s*(?:[-*]\s*)?Build-Thread\s*:\s*(.*?)\s*$/i,
    );
    if (!field) continue;

    const value = field[1].trim();
    if (!value || value.startsWith("<!--")) continue;
    const number = discussionNumberFromValue(value, repository);
    if (number === null) {
      throw new Error(
        "Build-Thread must be #NUMBER or a same-repository Discussion URL.",
      );
    }
    references.push(number);
  }

  if (references.length === 0) return null;
  const unique = [...new Set(references)];
  if (unique.length !== 1) {
    throw new Error("An expedition may name at most one Build-Thread.");
  }
  return unique[0];
}

export async function findCanonicalEvent(eventsDirectory, candidateHash) {
  if (!/^[a-f0-9]{64}$/.test(candidateHash)) {
    throw new Error("candidate hash must be a lowercase SHA-256 digest");
  }

  const directory = resolve(eventsDirectory);
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .reverse();

  for (const name of names) {
    const path = resolve(directory, name);
    const event = JSON.parse(await readFile(path, "utf8"));
    if (event.candidateHash === candidateHash) {
      return { event, path };
    }
  }
  throw new Error(
    `No canonical event has candidate hash ${candidateHash}.`,
  );
}

function operationSummary(event) {
  const operations = event.actions;
  const counts = new Map();
  for (const operation of operations) {
    const label = String(operation);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts]
    .map(([label, count]) => (count === 1 ? label : `${label} × ${count}`))
    .join(" · ");
}

function stoneSummary(event) {
  const stoneIds = event.stoneIds;
  const visible = stoneIds.slice(0, 8).map((id) => `\`${id}\``);
  if (stoneIds.length > visible.length) {
    visible.push(`and ${stoneIds.length - visible.length} more`);
  }
  return visible.join(", ") || "—";
}

function markdownNumber(value, digits = 0) {
  return Number.isFinite(value)
    ? Number(value).toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : "—";
}

function githubBlobUrl(repository, branch, artifactPath) {
  const cleanPath = artifactPath
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `https://github.com/${repository}/blob/${encodeURIComponent(branch)}/${cleanPath}`;
}

export function buildContributionComment({
  event,
  eventPath,
  repository,
  pullRequest,
  root = process.cwd(),
}) {
  if (!/^[a-f0-9]{64}$/.test(String(event.eventHash ?? ""))) {
    throw new Error("Canonical event is missing a valid event hash.");
  }

  const artifactPath = relative(resolve(root), resolve(eventPath)).replaceAll(
    "\\",
    "/",
  );
  const eventLink =
    artifactPath && !artifactPath.startsWith("../")
      ? githubBlobUrl(
          repository,
          String(pullRequest.base?.ref ?? "main"),
          artifactPath,
        )
      : null;
  const expedition = eventLink
    ? `[\`${event.candidateId}\`](${eventLink})`
    : `\`${event.candidateId}\``;
  const pullUrl = String(
    pullRequest.html_url ??
      `https://github.com/${repository}/pull/${pullRequest.number}`,
  );

  return [
    `<!-- alter-everest-build-contribution:${event.eventHash} -->`,
    "### Accepted expedition joined this build",
    "",
    `@${event.agentId} linked ${expedition} through [PR #${pullRequest.number}](${pullUrl}).`,
    "",
    "| World sequence | Operations | Highest point | Distance | Endurance | Outcome | Active-fact delta |",
    "| ---: | --- | ---: | ---: | ---: | --- | ---: |",
    `| ${markdownNumber(event.sequence)} | ${operationSummary(event)} | ${markdownNumber(event.altitudeM)} m | ${markdownNumber((event.distanceMillimeters ?? 0) / 1000, 1)} m | ${markdownNumber(event.enduranceUsed, 2)} | ${event.outcome} | +${markdownNumber((event.alterationDelta?.terrainRemovalsCreated ?? 0) + (event.alterationDelta?.stonePlacementsCreated ?? 0))} / -${markdownNumber(event.alterationDelta?.stonePlacementsRemoved ?? 0)} |`,
    "",
    `Matter: ${stoneSummary(event)}`,
    "",
    "_The canonical world event is authoritative. This comment only connects that event to the community conversation._",
  ].join("\n");
}

async function rest(path, token, apiBase) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "alter-everest-build-reporter",
      "x-github-api-version": "2022-11-28",
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub REST ${response.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text);
}

async function graphql(query, variables, token, endpoint) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "alter-everest-build-reporter",
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    throw new Error(
      `GitHub GraphQL ${response.status}: ${JSON.stringify(
        payload.errors ?? payload,
      ).slice(0, 1000)}`,
    );
  }
  return payload.data;
}

async function inspectDiscussion({
  owner,
  name,
  number,
  marker,
  token,
  endpoint,
}) {
  const query = `
    query BuildDiscussion(
      $owner: String!
      $name: String!
      $number: Int!
      $cursor: String
    ) {
      repository(owner: $owner, name: $name) {
        discussion(number: $number) {
          id
          number
          url
          title
          closed
          category { slug }
          comments(first: 100, after: $cursor) {
            nodes { body }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }
  `;

  let cursor = null;
  let discussion = null;
  for (let page = 0; page < MAXIMUM_COMMENT_PAGES; page += 1) {
    const data = await graphql(
      query,
      { owner, name, number, cursor },
      token,
      endpoint,
    );
    discussion = data.repository?.discussion ?? null;
    if (!discussion) return { discussion: null, duplicate: false };
    if (
      discussion.comments.nodes.some((comment) =>
        String(comment.body).includes(marker),
      )
    ) {
      return { discussion, duplicate: true };
    }
    if (!discussion.comments.pageInfo.hasNextPage) {
      return { discussion, duplicate: false };
    }
    cursor = discussion.comments.pageInfo.endCursor;
  }
  throw new Error(
    `Build Discussion #${number} exceeds the bounded comment scan.`,
  );
}

async function addDiscussionComment({
  discussionId,
  body,
  token,
  endpoint,
}) {
  const mutation = `
    mutation RecordBuildContribution($discussionId: ID!, $body: String!) {
      addDiscussionComment(
        input: { discussionId: $discussionId, body: $body }
      ) {
        comment { url }
      }
    }
  `;
  const data = await graphql(
    mutation,
    { discussionId, body },
    token,
    endpoint,
  );
  return data.addDiscussionComment.comment.url;
}

export async function main() {
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  const token = process.env.GITHUB_TOKEN ?? "";
  const pullNumber = Number(argument("--pull"));
  const candidateHash = argument("--candidate-hash") ?? "";
  const eventsDirectory = argument("--events-dir") ?? "world/events";
  const apiBase = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const graphqlEndpoint =
    process.env.GITHUB_GRAPHQL_URL ?? "https://api.github.com/graphql";

  if (!safeRepository(repository) || !token) {
    throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required.");
  }
  if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) {
    throw new Error("--pull must be a positive pull-request number.");
  }

  const [owner, name] = repository.split("/");
  const pullRequest = await rest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      name,
    )}/pulls/${pullNumber}`,
    token,
    apiBase,
  );
  const discussionNumber = parseBuildThreadReference(
    pullRequest.body,
    repository,
  );
  if (discussionNumber === null) {
    console.log(
      JSON.stringify(
        { recorded: false, reason: "NO_BUILD_THREAD", pullNumber },
        null,
        2,
      ),
    );
    return;
  }

  const { event, path: eventPath } = await findCanonicalEvent(
    eventsDirectory,
    candidateHash,
  );
  const pullAuthor = String(pullRequest.user?.login ?? "");
  if (pullAuthor.toLowerCase() !== String(event.agentId).toLowerCase()) {
    throw new Error(
      `Canonical agent ${event.agentId} does not match PR author ${pullAuthor}.`,
    );
  }

  const marker = `alter-everest-build-contribution:${event.eventHash}`;
  const inspection = await inspectDiscussion({
    owner,
    name,
    number: discussionNumber,
    marker,
    token,
    endpoint: graphqlEndpoint,
  });
  if (!inspection.discussion) {
    console.log(
      JSON.stringify(
        {
          recorded: false,
          reason: "BUILD_THREAD_NOT_FOUND",
          discussionNumber,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (inspection.discussion.category.slug !== BUILD_CATEGORY_SLUG) {
    console.log(
      JSON.stringify(
        {
          recorded: false,
          reason: "NOT_A_BUILD_THREAD",
          discussionNumber,
          category: inspection.discussion.category.slug,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (inspection.discussion.closed) {
    console.log(
      JSON.stringify(
        {
          recorded: false,
          reason: "BUILD_THREAD_CLOSED",
          discussionNumber,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (inspection.duplicate) {
    console.log(
      JSON.stringify(
        {
          recorded: true,
          idempotent: true,
          discussionNumber,
          eventHash: event.eventHash,
        },
        null,
        2,
      ),
    );
    return;
  }

  const body = buildContributionComment({
    event,
    eventPath,
    repository,
    pullRequest: { ...pullRequest, number: pullNumber },
  });
  const commentUrl = await addDiscussionComment({
    discussionId: inspection.discussion.id,
    body,
    token,
    endpoint: graphqlEndpoint,
  });
  console.log(
    JSON.stringify(
      {
        recorded: true,
        idempotent: false,
        discussionNumber,
        eventHash: event.eventHash,
        commentUrl,
      },
      null,
      2,
    ),
  );
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
