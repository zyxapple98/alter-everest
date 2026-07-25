import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execute = promisify(execFile);
const BUILD_CATEGORY_SLUG = "builds";
const MAXIMUM_DISCUSSIONS = 50;
const MAXIMUM_COMMENTS = 100;

function usage() {
  return `Community Build commands

Read:
  npm run build:list -- [--json] [--all] [--repo OWNER/REPO]
  npm run build:inspect -- --discussion NUMBER [--json] [--repo OWNER/REPO]

Write:
  npm run build:start -- --title TEXT --intention TEXT --location TEXT --vibe TEXT
    [--first-move TEXT] [--boundaries TEXT] [--dry-run]
  npm run build:intend -- --discussion NUMBER --message TEXT [--dry-run]
  npm run build:comment -- --discussion NUMBER --message TEXT
    [--kind suggestion|vibe] [--dry-run]

Authentication:
  Set GH_TOKEN or GITHUB_TOKEN, or sign in with "gh auth login".

Build writes are social GitHub actions. They never mutate the canonical world.`;
}

export function parseArguments(argv) {
  const command = argv[0] ?? "help";
  const options = {};
  const booleanOptions = new Set(["all", "dry-run", "json", "help"]);

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const name = token.slice(2);
    if (booleanOptions.has(name)) {
      options[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`--${name} requires a value.`);
    }
    options[name] = value;
    index += 1;
  }
  return { command, options };
}

function textOption(options, name, { required = false, maximum = 5000 } = {}) {
  const value =
    typeof options[name] === "string" ? options[name].trim() : "";
  if (required && value.length === 0) {
    throw new Error(`--${name} is required.`);
  }
  if (value.length > maximum) {
    throw new Error(`--${name} may contain at most ${maximum} characters.`);
  }
  return value;
}

function discussionOption(options) {
  const value = Number(options.discussion);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("--discussion must be a positive Discussion number.");
  }
  return value;
}

export function normalizeBuildTitle(value) {
  const title = String(value ?? "").trim();
  if (title.length === 0) throw new Error("--title is required.");
  if (title.length > 100) {
    throw new Error("--title may contain at most 100 characters.");
  }
  return /^\[BUILD\]\s/i.test(title) ? title : `[BUILD] ${title}`;
}

export function formatBuildOpening({
  intention,
  location,
  vibe,
  firstMove = "",
  boundaries = "",
}) {
  return [
    "## What would you like to grow here?",
    "",
    intention.trim(),
    "",
    "## Where should it begin?",
    "",
    location.trim(),
    "",
    "## Current vibe",
    "",
    vibe.trim(),
    "",
    "## What might happen first?",
    "",
    firstMove.trim() || "_Open to the first builder._",
    "",
    "## Open questions and boundaries",
    "",
    boundaries.trim() || "_Still open._",
    "",
    "---",
    "",
    "This is an open invitation, not a land claim. Announce a local intention,",
    "inspect the latest canonical world, and link accepted work with",
    "`Build-Thread: #NUMBER` in the expedition PR.",
  ].join("\n");
}

export function formatIntentComment(message) {
  const intent = String(message ?? "").trim();
  if (intent.length === 0) throw new Error("--message is required.");
  if (intent.length > 5000) {
    throw new Error("--message may contain at most 5000 characters.");
  }
  return [
    "<!-- alter-everest-build-intent -->",
    "### INTENT",
    "",
    intent,
    "",
    "_This is a courtesy signal, not a reservation. The latest canonical world remains physical truth._",
  ].join("\n");
}

export function formatBuildComment(message, kind = "suggestion") {
  const content = String(message ?? "").trim();
  if (content.length === 0) throw new Error("--message is required.");
  if (content.length > 5000) {
    throw new Error("--message may contain at most 5000 characters.");
  }
  if (!["suggestion", "vibe"].includes(kind)) {
    throw new Error("--kind must be suggestion or vibe.");
  }
  const heading = kind === "vibe" ? "CURRENT VIBE" : "SUGGESTION";
  const footer =
    kind === "vibe"
      ? "_A social summary for reconnecting builders; it does not replace canonical world inspection._"
      : "_A suggestion for the shared direction, not a vote or physical reservation._";
  return [`### ${heading}`, "", content, "", footer].join("\n");
}

function githubRepositoryFromUrl(value) {
  const url = String(value ?? "").trim();
  const match = url.match(
    /github\.com(?::|\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/,
  );
  return match ? `${match[1]}/${match[2]}` : null;
}

async function defaultRepository() {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const repository =
    typeof packageJson.repository === "string"
      ? packageJson.repository
      : packageJson.repository?.url;
  const parsed = githubRepositoryFromUrl(repository);
  if (!parsed) {
    throw new Error(
      "package.json must name the canonical GitHub repository.",
    );
  }
  return parsed;
}

async function resolveRepository(options) {
  const repository =
    textOption(options, "repo") ||
    process.env.COMMUNITY_REPOSITORY ||
    (await defaultRepository());
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("repository must use OWNER/REPO syntax.");
  }
  return repository;
}

async function resolveToken() {
  const environmentToken =
    process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
  if (environmentToken) return environmentToken;

  try {
    const result = await execute("gh", ["auth", "token"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const token = result.stdout.trim();
    if (token) return token;
  } catch {
    // The actionable error below is safer than forwarding CLI output.
  }
  throw new Error(
    'GitHub authentication is required. Run "gh auth login" or set GH_TOKEN.',
  );
}

function createClient(token) {
  const endpoint =
    process.env.GITHUB_GRAPHQL_URL ?? "https://api.github.com/graphql";
  return async (query, variables) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "alter-everest-community-builds",
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
  };
}

async function repositoryContext(client, repository) {
  const [owner, name] = repository.split("/");
  const query = `
    query CommunityBuildRepository(
      $owner: String!
      $name: String!
      $slug: String!
    ) {
      viewer { login }
      repository(owner: $owner, name: $name) {
        id
        url
        discussionCategory(slug: $slug) {
          id
          name
          slug
        }
      }
    }
  `;
  const data = await client(query, {
    owner,
    name,
    slug: BUILD_CATEGORY_SLUG,
  });
  if (!data.repository) {
    throw new Error(`GitHub repository ${repository} was not found.`);
  }
  if (!data.repository.discussionCategory) {
    throw new Error(
      `${repository} does not have a Builds Discussion category.`,
    );
  }
  return {
    owner,
    name,
    repository,
    repositoryId: data.repository.id,
    repositoryUrl: data.repository.url,
    categoryId: data.repository.discussionCategory.id,
    viewer: data.viewer.login,
  };
}

async function listBuilds(client, context, includeClosed) {
  const query = `
    query ListCommunityBuilds(
      $owner: String!
      $name: String!
      $categoryId: ID!
      $count: Int!
    ) {
      repository(owner: $owner, name: $name) {
        discussions(
          first: $count
          categoryId: $categoryId
          orderBy: { field: UPDATED_AT, direction: DESC }
        ) {
          totalCount
          nodes {
            number
            title
            url
            body
            closed
            createdAt
            updatedAt
            author { login }
            comments { totalCount }
          }
        }
      }
    }
  `;
  const data = await client(query, {
    owner: context.owner,
    name: context.name,
    categoryId: context.categoryId,
    count: MAXIMUM_DISCUSSIONS,
  });
  const connection = data.repository.discussions;
  const builds = connection.nodes.filter(
    (discussion) => includeClosed || !discussion.closed,
  );
  return {
    repository: context.repository,
    category: BUILD_CATEGORY_SLUG,
    viewer: context.viewer,
    totalInCategory: connection.totalCount,
    returned: builds.length,
    truncated: connection.totalCount > MAXIMUM_DISCUSSIONS,
    builds,
  };
}

function containsHeading(body, heading) {
  return new RegExp(
    `(?:^|\\n)\\s*#{0,6}\\s*${heading}\\b`,
    "i",
  ).test(String(body ?? ""));
}

export function deriveBuildContext(discussion) {
  const comments = discussion.comments?.nodes ?? [];
  const currentVibe = [...comments]
    .reverse()
    .find((comment) => containsHeading(comment.body, "CURRENT VIBE"));
  const acceptedContributions = comments.filter((comment) =>
    String(comment.body).includes(
      "alter-everest-build-contribution:",
    ),
  );
  const intentions = comments.filter(
    (comment) =>
      String(comment.body).includes("alter-everest-build-intent") ||
      containsHeading(comment.body, "INTENT"),
  );
  return {
    physicalTruthWarning:
      "Discussion is social context. Re-inspect the latest canonical world in world/snapshot.json before planning.",
    currentVibe: currentVibe ?? null,
    acceptedContributions,
    intentions,
    recentComments: comments.slice(-20),
    commentsReturned: comments.length,
    commentsTotal: discussion.comments?.totalCount ?? comments.length,
    commentsTruncated:
      (discussion.comments?.totalCount ?? comments.length) > comments.length,
  };
}

async function inspectBuild(client, context, discussionNumber) {
  const query = `
    query InspectCommunityBuild(
      $owner: String!
      $name: String!
      $number: Int!
      $commentCount: Int!
    ) {
      repository(owner: $owner, name: $name) {
        discussion(number: $number) {
          id
          number
          title
          url
          body
          closed
          createdAt
          updatedAt
          author { login }
          category { slug }
          comments(last: $commentCount) {
            totalCount
            nodes {
              body
              createdAt
              updatedAt
              url
              author { login }
            }
          }
        }
      }
    }
  `;
  const data = await client(query, {
    owner: context.owner,
    name: context.name,
    number: discussionNumber,
    commentCount: MAXIMUM_COMMENTS,
  });
  const discussion = data.repository.discussion;
  if (!discussion) {
    throw new Error(`Discussion #${discussionNumber} was not found.`);
  }
  if (discussion.category.slug !== BUILD_CATEGORY_SLUG) {
    throw new Error(
      `Discussion #${discussionNumber} is not in the Builds category.`,
    );
  }
  return {
    repository: context.repository,
    viewer: context.viewer,
    discussion,
    context: deriveBuildContext(discussion),
  };
}

async function createBuild(client, context, title, body) {
  const mutation = `
    mutation StartCommunityBuild(
      $repositoryId: ID!
      $categoryId: ID!
      $title: String!
      $body: String!
    ) {
      createDiscussion(
        input: {
          repositoryId: $repositoryId
          categoryId: $categoryId
          title: $title
          body: $body
        }
      ) {
        discussion {
          number
          title
          url
        }
      }
    }
  `;
  const data = await client(mutation, {
    repositoryId: context.repositoryId,
    categoryId: context.categoryId,
    title,
    body,
  });
  return data.createDiscussion.discussion;
}

async function addIntent(client, discussionId, body) {
  const mutation = `
    mutation AnnounceBuildIntent($discussionId: ID!, $body: String!) {
      addDiscussionComment(
        input: { discussionId: $discussionId, body: $body }
      ) {
        comment {
          url
        }
      }
    }
  `;
  const data = await client(mutation, { discussionId, body });
  return data.addDiscussionComment.comment;
}

function excerpt(value, maximum = 700) {
  const text = String(value ?? "").trim();
  return text.length <= maximum
    ? text
    : `${text.slice(0, maximum - 1).trimEnd()}…`;
}

function printList(result) {
  if (result.builds.length === 0) {
    console.log("No open Community Builds.");
    console.log(
      'Start one with "npm run build:start -- --title ... --intention ... --location ... --vibe ...".',
    );
    return;
  }
  console.log(`OPEN COMMUNITY BUILDS · ${result.repository}`);
  for (const build of result.builds) {
    console.log("");
    console.log(`#${build.number}  ${build.title}`);
    console.log(
      `  @${build.author?.login ?? "unknown"} · ${build.comments.totalCount} comments · updated ${build.updatedAt}`,
    );
    console.log(`  ${build.url}`);
  }
  if (result.truncated) {
    console.log("");
    console.log("Results are truncated; use GitHub Discussions for older Builds.");
  }
}

function printInspection(result) {
  const { discussion } = result;
  const buildContext = result.context;
  console.log(`${discussion.title} · #${discussion.number}`);
  console.log(
    `@${discussion.author?.login ?? "unknown"} · ${discussion.closed ? "CLOSED" : "OPEN"} · updated ${discussion.updatedAt}`,
  );
  console.log(discussion.url);
  console.log("");
  console.log("OPENING");
  console.log(excerpt(discussion.body, 3000));
  console.log("");
  console.log("LATEST CURRENT VIBE");
  console.log(
    buildContext.currentVibe
      ? `${buildContext.currentVibe.author?.login ?? "unknown"}: ${excerpt(
          buildContext.currentVibe.body,
          2000,
        )}`
      : "No later CURRENT VIBE summary; use the opening and recent comments.",
  );
  console.log("");
  console.log(
    `ACCEPTED CONTRIBUTIONS ${buildContext.acceptedContributions.length} · DECLARED INTENTIONS ${buildContext.intentions.length}`,
  );
  console.log("");
  console.log("RECENT COMMENTS");
  if (buildContext.recentComments.length === 0) {
    console.log("No comments yet.");
  } else {
    for (const comment of buildContext.recentComments) {
      console.log("");
      console.log(
        `@${comment.author?.login ?? "unknown"} · ${comment.createdAt} · ${comment.url}`,
      );
      console.log(excerpt(comment.body));
    }
  }
  console.log("");
  console.log(`IMPORTANT: ${buildContext.physicalTruthWarning}`);
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArguments(argv);
  if (command === "help" || options.help) {
    console.log(usage());
    return;
  }
  if (!["list", "inspect", "start", "intend", "comment"].includes(command)) {
    throw new Error(`Unknown command "${command}".\n\n${usage()}`);
  }

  const repository = await resolveRepository(options);

  if (command === "start") {
    const title = normalizeBuildTitle(
      textOption(options, "title", { required: true, maximum: 100 }),
    );
    const body = formatBuildOpening({
      intention: textOption(options, "intention", { required: true }),
      location: textOption(options, "location", { required: true }),
      vibe: textOption(options, "vibe", { required: true }),
      firstMove: textOption(options, "first-move"),
      boundaries: textOption(options, "boundaries"),
    });
    if (options["dry-run"]) {
      console.log(
        JSON.stringify(
          {
            dryRun: true,
            githubWrite: false,
            targetValidated: false,
            repository,
            title,
            body,
          },
          null,
          2,
        ),
      );
      return;
    }
    const client = createClient(await resolveToken());
    const context = await repositoryContext(client, repository);
    const discussion = await createBuild(client, context, title, body);
    console.log(
      JSON.stringify(
        {
          created: true,
          actor: context.viewer,
          discussion,
          next: `npm run build:inspect -- --discussion ${discussion.number}`,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "intend" || command === "comment") {
    const discussionNumber = discussionOption(options);
    const message = textOption(options, "message", { required: true });
    const kind =
      command === "comment"
        ? textOption(options, "kind") || "suggestion"
        : "intent";
    const body =
      command === "intend"
        ? formatIntentComment(message)
        : formatBuildComment(message, kind);
    if (options["dry-run"]) {
      console.log(
        JSON.stringify(
          {
            dryRun: true,
            githubWrite: false,
            targetValidated: false,
            repository,
            discussionNumber,
            kind,
            body,
          },
          null,
          2,
        ),
      );
      return;
    }
    const client = createClient(await resolveToken());
    const context = await repositoryContext(client, repository);
    const inspection = await inspectBuild(
      client,
      context,
      discussionNumber,
    );
    if (inspection.discussion.closed) {
      throw new Error(`Build Thread #${discussionNumber} is closed.`);
    }
    const comment = await addIntent(
      client,
      inspection.discussion.id,
      body,
    );
    console.log(
      JSON.stringify(
        {
          posted: true,
          type: command === "intend" ? "intent" : kind,
          actor: context.viewer,
          discussionNumber,
          commentUrl: comment.url,
          next:
            command === "intend"
              ? "Inspect the latest canonical world, then plan the expedition."
              : "Treat replies as social context; canonical world state is unchanged.",
        },
        null,
        2,
      ),
    );
    return;
  }

  const client = createClient(await resolveToken());
  const context = await repositoryContext(client, repository);
  if (command === "list") {
    const result = await listBuilds(client, context, Boolean(options.all));
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else printList(result);
    return;
  }

  const result = await inspectBuild(
    client,
    context,
    discussionOption(options),
  );
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else printInspection(result);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
