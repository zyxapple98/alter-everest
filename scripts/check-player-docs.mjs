import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { generatePlayerDocs } from "./generate-player-docs.mjs";

const root = resolve(".");
const playerRules = JSON.parse(
  await readFile(resolve(root, "protocol/player-rules.json"), "utf8"),
);
const protocolManifest = JSON.parse(
  await readFile(resolve(root, "protocol/manifest.json"), "utf8"),
);
const schema = JSON.parse(
  await readFile(resolve(root, "schemas/candidate.schema.json"), "utf8"),
);
const planSchema = JSON.parse(
  await readFile(
    resolve(root, "schemas/expedition-plan.schema.json"),
    "utf8",
  ),
);
const terrain = JSON.parse(
  await readFile(resolve(root, "world/terrain.json"), "utf8"),
);
const packageJson = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
assert.deepEqual(
  await generatePlayerDocs({ write: false }),
  [],
  "generated player docs are stale; run npm run docs:generate",
);

assert.equal(
  protocolManifest.playerRulesPath,
  "protocol/player-rules.json",
  "protocol manifest must route public gameplay values to player-rules.json",
);
assert.equal(
  schema.$defs.route.properties.stepCount.maximum,
  playerRules.candidate.maximumDecodedRouteSteps,
  "candidate decoded route limit drifted from player rules",
);
assert.equal(
  schema.$defs.proof.properties.actions.maxItems,
  playerRules.candidate.maximumActions,
  "candidate action schema limit drifted from player rules",
);
assert.equal(
  planSchema.$defs.route.properties.stances.maxItems,
  playerRules.candidate.maximumDecodedRouteSteps + 1,
  "authoring plan route limit drifted from player rules",
);
assert.equal(
  planSchema.properties.actions.maxItems,
  playerRules.candidate.maximumActions,
  "authoring plan action limit drifted from player rules",
);
assert.deepEqual(
  schema.$defs.action.properties.source.oneOf[1].required,
  ["kind"],
  "STONE source must use matterId instead of repeating stoneId",
);
assert.equal(
  planSchema.$defs.route.properties.stances.prefixItems[0].allOf[1]
    .properties.mode.const,
  "WALK",
  "authoring schema must expose the codec initial mode",
);
assert.equal(
  planSchema.$defs.route.properties.stances.prefixItems[0].allOf[1]
    .properties.protected.const,
  false,
  "authoring schema must expose the codec initial protection state",
);
assert.equal(
  playerRules.route.horizontalDirections.length,
  playerRules.route.horizontalNeighbourhood,
  "route direction table must match its declared neighbourhood",
);
assert.equal(
  new Set(
    playerRules.route.horizontalDirections.map(
      ({ x, z }) => `${x}:${z}`,
    ),
  ).size,
  playerRules.route.horizontalDirections.length,
  "route directions must be unique",
);
assert.equal(
  playerRules.physics.maximumAffectedStoneCells,
  playerRules.candidate.maximumTouchedStones,
  "stone component and candidate bounds must agree",
);
assert.equal(
  playerRules.physics.maximumDistinctStoneLevels,
  playerRules.candidate.maximumDistinctStoneLevels,
  "stone level bounds must agree",
);
assert.equal(
  playerRules.physics.maximumCavityWindowCells,
  playerRules.candidate.maximumCavityWindowCells,
  "cavity bounds must agree",
);
assert.equal(
  playerRules.physics.maximumTouchedPhysicsChunks,
  playerRules.candidate.maximumTouchedPhysicsChunks,
  "physics chunk bounds must agree",
);
for (const key of [
  "voxelEdgeM",
  "physicsChunkEdgeM",
  "streamTileEdgeM",
  "naturalizationVersion",
  "naturalizationSeed",
  "maximumSyntheticReliefM",
]) {
  const terrainKey =
    key === "naturalizationVersion"
      ? "version"
      : key === "naturalizationSeed"
        ? "seed"
        : key;
  assert.equal(
    playerRules.terrain[key],
    terrain.naturalization[terrainKey],
    `terrain.${key} drifted from canonical terrain configuration`,
  );
}

const entryDocuments = [
  "AGENTS.md",
  ...Object.values(playerRules.docs).filter(
    (value) => value !== "AGENTS.md",
  ),
];
for (const path of entryDocuments) {
  assert.ok(
    (await stat(resolve(root, path))).isFile(),
    `missing player document: ${path}`,
  );
}

function markdownSlug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

const documentCache = new Map();
async function document(path) {
  if (!documentCache.has(path)) {
    documentCache.set(
      path,
      await readFile(resolve(root, path), "utf8"),
    );
  }
  return documentCache.get(path);
}

for (const [code, rule] of Object.entries(playerRules.errors)) {
  const [path, anchor] = rule.doc.split("#");
  const content = await document(path);
  if (anchor) {
    const anchors = new Set(
      [...content.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) =>
        markdownSlug(match[1]),
      ),
    );
    assert.ok(
      anchors.has(anchor),
      `${code} points to missing anchor ${rule.doc}`,
    );
  }
  for (const relatedPath of rule.relatedValues ?? []) {
    let value = playerRules;
    for (const part of relatedPath.split(".")) {
      assert.ok(
        value && typeof value === "object" && part in value,
        `${code} points to missing player rule value ${relatedPath}`,
      );
      value = value[part];
    }
  }
}

const playerPaths = [
  "AGENTS.md",
  ...Object.values(playerRules.docs).filter(
    (value) => value.startsWith("docs/player/"),
  ),
];
const entrySurfacePaths = [
  "README.md",
  ...playerPaths,
  ".github/pull_request_template.md",
  ".github/DISCUSSION_TEMPLATE/builds.yml",
];
const forbiddenPlayerLinks =
  /\]\([^)]*(?:engine\/|tests\/|\.github\/workflows\/|PROTOCOL-0\.6-MIGRATION|IMPLEMENTATION-PLAN)/i;
const retiredPlayerPaths =
  /docs\/(?:AGENT-ONBOARDING|AGENT-PROTOCOL|BUILD-HANDBOOK|FIRST-EXPEDITION|PHYSICS|PLAY|PLAYTEST-30-AGENTS|PROTOCOL-0\.6-MIGRATION)\.md/i;
for (const path of entrySurfacePaths) {
  const content = await document(path);
  assert.doesNotMatch(
    content,
    retiredPlayerPaths,
    `${path} points to a retired player document`,
  );
  assert.doesNotMatch(
    content,
    forbiddenPlayerLinks,
    `${path} leaks implementation or history into the player path`,
  );
  for (const match of content.matchAll(/npm run ([a-z0-9:-]+)/gi)) {
    assert.ok(
      packageJson.scripts[match[1]],
      `${path} names missing package script ${match[1]}`,
    );
  }
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (
      target.startsWith("http://") ||
      target.startsWith("https://") ||
      target.startsWith("#")
    ) {
      continue;
    }
    const pathPart = target.split("#")[0];
    const resolved = resolve(root, dirname(path), pathPart);
    assert.ok(
      (await stat(resolved)).isFile(),
      `${path} links to missing file ${target}`,
    );
  }
}

const readme = await document("README.md");
assert.match(readme, /Everest is a long commute/i);
assert.match(readme, /How do you want to play/i);
assert.match(readme, /Community Build/i);
assert.match(readme, /Send your agent to Base Camp/i);
assert.match(readme, /Meet ALTER EVEREST\. Start with `AGENTS\.md`\./);
assert.doesNotMatch(readme, /npm run/);
const agentEntry = await document("AGENTS.md");
assert.match(agentEntry, /repository acquisition/i);
assert.match(agentEntry, /matter:check/);
assert.match(agentEntry, /route:decode -- work\/route\.json --summary/);
const firstExpedition = await document(
  "docs/player/FIRST-EXPEDITION.md",
);
assert.match(
  firstExpedition,
  /examples\/example-agent\/rehearsal-world\.json/,
);
assert.ok(
  (
    firstExpedition.match(
      /--world examples\/example-agent\/rehearsal-world\.json/g,
    ) ?? []
  ).length >= 5,
  "the complete local rehearsal must stay pinned to its sealed world",
);

const footprintDoc = await document(
  "docs/player/IDENTITY-AND-FOOTPRINT.md",
);
assert.match(footprintDoc, /descriptive footprint/i);
assert.match(footprintDoc, /activeAlterations/);

const intentionsDoc = await document("docs/player/INTENTIONS.md");
assert.equal(
  playerRules.onboarding.intentInterview.requiredAfterLocalRehearsal,
  true,
);
assert.match(intentionsDoc, /first real question/i);
const normalizedIntentions = intentionsDoc
  .replace(/^>\s?/gm, "")
  .replace(/\s+/g, " ");
assert.ok(
  normalizedIntentions.includes(
    playerRules.onboarding.intentInterview.prompt,
  ),
  "intentions doc must contain the canonical human-intent prompt",
);
for (const mission of playerRules.onboarding.starterMissions) {
  assert.match(
    intentionsDoc,
    new RegExp(
      mission.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i",
    ),
    `intentions doc is missing starter mission ${mission.id}`,
  );
}

console.log(
  JSON.stringify(
    {
      valid: true,
      playerEntry: "AGENTS.md",
      playerDocuments: playerPaths.length,
      entrySurfaces: entrySurfacePaths.length,
      errorRules: Object.keys(playerRules.errors).length,
    },
    null,
    2,
  ),
);
