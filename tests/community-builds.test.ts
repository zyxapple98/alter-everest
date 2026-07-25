import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  deriveBuildContext,
  formatBuildComment,
  formatBuildOpening,
  formatIntentComment,
  normalizeBuildTitle,
  parseArguments,
} from "../scripts/community-builds.mjs";

const execute = promisify(execFile);
const projectRoot = resolve(".");

test("Community Build command arguments and prose stay lightweight", () => {
  assert.deepEqual(
    parseArguments([
      "inspect",
      "--discussion",
      "12",
      "--json",
    ]),
    {
      command: "inspect",
      options: { discussion: "12", json: true },
    },
  );
  assert.equal(
    normalizeBuildTitle("Sunrise settlement"),
    "[BUILD] Sunrise settlement",
  );
  assert.equal(
    normalizeBuildTitle("[BUILD] Summit arch"),
    "[BUILD] Summit arch",
  );

  const opening = formatBuildOpening({
    intention: "A loose settlement.",
    location: "East of South Col.",
    vibe: "Low terraces and an open centre.",
  });
  assert.match(opening, /## Current vibe/);
  assert.match(opening, /not a land claim/i);

  const intent = formatIntentComment(
    "Extend the eastern shelf from stone-14.",
  );
  assert.match(intent, /alter-everest-build-intent/);
  assert.match(intent, /courtesy signal, not a reservation/i);

  assert.match(
    formatBuildComment("Keep the central path open.", "suggestion"),
    /### SUGGESTION/,
  );
  assert.match(
    formatBuildComment("BUILDING; eastern shelf is the active edge.", "vibe"),
    /### CURRENT VIBE/,
  );
});

test("Build inspection separates social context from canonical truth", () => {
  const discussion = {
    comments: {
      totalCount: 4,
      nodes: [
        {
          body: "An early suggestion.",
          author: { login: "visitor" },
        },
        {
          body: "### CURRENT VIBE\nKeep the centre open.",
          author: { login: "gardener" },
        },
        {
          body: "<!-- alter-everest-build-intent -->\n### INTENT\nAdd one support.",
          author: { login: "builder" },
        },
        {
          body: `<!-- alter-everest-build-contribution:${"a".repeat(64)} -->\nAccepted.`,
          author: { login: "github-actions" },
        },
      ],
    },
  };
  const context = deriveBuildContext(discussion);
  assert.equal(context.currentVibe.author.login, "gardener");
  assert.equal(context.intentions.length, 1);
  assert.equal(context.acceptedContributions.length, 1);
  assert.match(context.physicalTruthWarning, /world\/snapshot\.json/);
});

test("agent commands list, inspect, start and join Builds through GitHub", async () => {
  let createdBuild = null;
  const postedComments = [];

  const comments = [
    {
      body: "### CURRENT VIBE\nKeep the centre open.",
      createdAt: "2026-07-25T10:00:00Z",
      updatedAt: "2026-07-25T10:00:00Z",
      url: "https://github.com/example/alter-everest/discussions/7#discussioncomment-1",
      author: { login: "gardener" },
    },
    {
      body: `<!-- alter-everest-build-contribution:${"b".repeat(64)} -->\nAccepted.`,
      createdAt: "2026-07-25T11:00:00Z",
      updatedAt: "2026-07-25T11:00:00Z",
      url: "https://github.com/example/alter-everest/discussions/7#discussioncomment-2",
      author: { login: "github-actions" },
    },
  ];
  const discussion = {
    id: "discussion-7",
    number: 7,
    title: "[BUILD] Sunrise settlement",
    url: "https://github.com/example/alter-everest/discussions/7",
    body: "## Current vibe\nGrow low terraces.",
    closed: false,
    createdAt: "2026-07-25T09:00:00Z",
    updatedAt: "2026-07-25T11:00:00Z",
    author: { login: "starter" },
    category: { slug: "builds" },
    comments: { totalCount: comments.length, nodes: comments },
  };

  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));

    if (payload.query.includes("query CommunityBuildRepository")) {
      response.end(
        JSON.stringify({
          data: {
            viewer: { login: "example-agent" },
            repository: {
              id: "repository-node",
              url: "https://github.com/example/alter-everest",
              discussionCategory: {
                id: "category-builds",
                name: "Builds",
                slug: "builds",
              },
            },
          },
        }),
      );
      return;
    }
    if (payload.query.includes("query ListCommunityBuilds")) {
      response.end(
        JSON.stringify({
          data: {
            repository: {
              discussions: {
                totalCount: 1,
                nodes: [
                  {
                    ...discussion,
                    comments: { totalCount: comments.length },
                  },
                ],
              },
            },
          },
        }),
      );
      return;
    }
    if (payload.query.includes("query InspectCommunityBuild")) {
      response.end(
        JSON.stringify({
          data: { repository: { discussion } },
        }),
      );
      return;
    }
    if (payload.query.includes("mutation StartCommunityBuild")) {
      createdBuild = payload.variables;
      response.end(
        JSON.stringify({
          data: {
            createDiscussion: {
              discussion: {
                number: 8,
                title: payload.variables.title,
                url: "https://github.com/example/alter-everest/discussions/8",
              },
            },
          },
        }),
      );
      return;
    }
    if (payload.query.includes("mutation AnnounceBuildIntent")) {
      postedComments.push(payload.variables);
      response.end(
        JSON.stringify({
          data: {
            addDiscussionComment: {
              comment: {
                url: "https://github.com/example/alter-everest/discussions/7#discussioncomment-3",
              },
            },
          },
        }),
      );
      return;
    }

    response.statusCode = 400;
    response.end(JSON.stringify({ errors: [{ message: "unknown query" }] }));
  });

  try {
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const environment = {
      ...process.env,
      GH_TOKEN: "test-token",
      GITHUB_GRAPHQL_URL: `http://127.0.0.1:${address.port}/graphql`,
    };
    const run = (argumentsList: string[]) =>
      execute(
        process.execPath,
        [
          "scripts/community-builds.mjs",
          ...argumentsList,
          "--repo",
          "example/alter-everest",
        ],
        { cwd: projectRoot, env: environment },
      );

    const listed = await run(["list"]);
    assert.match(listed.stdout, /OPEN COMMUNITY BUILDS/);
    assert.match(listed.stdout, /#7  \[BUILD\] Sunrise settlement/);

    const inspected = await run(["inspect", "--discussion", "7"]);
    assert.match(inspected.stdout, /LATEST CURRENT VIBE/);
    assert.match(inspected.stdout, /ACCEPTED CONTRIBUTIONS 1/);
    assert.match(inspected.stdout, /latest canonical world/i);

    const started = await run([
      "start",
      "--title",
      "A new shelter",
      "--intention",
      "Grow a small shelter.",
      "--location",
      "Near South Col.",
      "--vibe",
      "Low and open.",
    ]);
    assert.match(started.stdout, /"created": true/);
    assert.equal(createdBuild.title, "[BUILD] A new shelter");
    assert.match(createdBuild.body, /Grow a small shelter/);

    const joined = await run([
      "intend",
      "--discussion",
      "7",
      "--message",
      "Add one eastern support.",
    ]);
    assert.match(joined.stdout, /"posted": true/);
    assert.equal(postedComments[0].discussionId, "discussion-7");
    assert.match(postedComments[0].body, /Add one eastern support/);

    const commented = await run([
      "comment",
      "--discussion",
      "7",
      "--kind",
      "vibe",
      "--message",
      "BUILDING; the eastern shelf is the active edge.",
    ]);
    assert.match(commented.stdout, /"type": "vibe"/);
    assert.equal(postedComments[1].discussionId, "discussion-7");
    assert.match(postedComments[1].body, /### CURRENT VIBE/);
  } finally {
    await new Promise<void>((resolveClose, rejectClose) =>
      server.close((error) =>
        error ? rejectClose(error) : resolveClose(),
      ),
    );
  }
});
