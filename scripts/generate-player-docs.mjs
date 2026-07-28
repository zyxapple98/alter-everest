import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(".");

function number(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function routeLocomotion(rules) {
  const rows = Object.entries(rules.climber.locomotion).map(
    ([mode, rule]) =>
      `| ${mode} | ${rule.maximumStepM} m | ${rule.maximumSlopeDegrees}° | ${rule.speedMps} m/s | ${
        rule.stepSpeedMps === undefined ? "—" : `${rule.stepSpeedMps} m/s`
      } |`,
  );
  return [
    "| Derived mode | Maximum step | Maximum effective support slope | Surface speed | 20 cm step speed |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...rows,
  ].join("\n");
}

function matterFlows(rules) {
  const meanings = {
    ADD: "import one new stone",
    MOVE: "relocate an existing stone",
    QUARRY: "remove exposed terrain and place it",
    RECOVER: "carry matter back to Camp",
  };
  return [
    "| Operation | Flow | Meaning |",
    "| --- | --- | --- |",
    ...Object.entries(rules.matter.legalFlows).map(
      ([operation, flow]) =>
        `| ${operation} | \`${flow}\` | ${meanings[operation]} |`,
    ),
  ].join("\n");
}

function physicsBounds(rules) {
  return [
    `- ${number(rules.physics.maximumAffectedStoneCells)} affected stone cells;`,
    `- ${number(rules.physics.maximumDistinctStoneLevels)} distinct stone levels;`,
    `- ${number(rules.physics.maximumTouchedPhysicsChunks)} touched physics chunks;`,
    `- ${number(rules.physics.maximumCavityWindowCells)} cells in one local cavity window;`,
    `- ${number(rules.candidate.maximumActions)} actions;`,
    `- ${number(rules.candidate.maximumCumulativeEvaluatedStoneCells)} cumulative evaluated stone cells;`,
    `- ${number(rules.candidate.maximumCumulativeCavityWindowCells)} cumulative cavity cells.`,
  ].join("\n");
}

function errorCatalog(rules) {
  const groups = [
    {
      heading: "Input, identity and submission",
      matches: (rule) =>
        /(?:IDENTITY-AND-FOOTPRINT|SUBMISSION)/.test(rule.doc),
    },
    {
      heading: "Route and terrain",
      matches: (rule) => /ROUTE\.md/.test(rule.doc),
    },
    {
      heading: "Matter and timing",
      matches: (rule) => /MATTER\.md/.test(rule.doc),
    },
    {
      heading: "Structures and excavation",
      matches: (rule) => /PHYSICS\.md/.test(rule.doc),
    },
  ];
  const entries = Object.entries(rules.errors);
  return groups
    .map(({ heading, matches }) => {
      const lines = entries
        .filter(([, rule]) => matches(rule))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([code, rule]) => `- \`${code}\` — ${rule.summary}`);
      return [`## ${heading}`, "", ...lines].join("\n");
    })
    .join("\n\n");
}

const targets = [
  {
    path: "docs/player/ROUTE.md",
    name: "route-locomotion",
    render: routeLocomotion,
  },
  {
    path: "docs/player/MATTER.md",
    name: "matter-flows",
    render: matterFlows,
  },
  {
    path: "docs/player/PHYSICS.md",
    name: "physics-bounds",
    render: physicsBounds,
  },
  {
    path: "docs/player/ERRORS.md",
    name: "error-catalog",
    render: errorCatalog,
  },
];

export async function generatePlayerDocs({ write = true } = {}) {
  const rules = JSON.parse(
    await readFile(resolve(root, "protocol/player-rules.json"), "utf8"),
  );
  const changed = [];
  for (const target of targets) {
    const path = resolve(root, target.path);
    const source = await readFile(path, "utf8");
    const expression = new RegExp(
      `(<!-- generated: ${target.name}:start -->)\\r?\\n[\\s\\S]*?\\r?\\n(<!-- generated: ${target.name}:end -->)`,
    );
    assert.match(
      source,
      expression,
      `${target.path} is missing generated block ${target.name}`,
    );
    const replacement = `$1\n\n${target.render(rules)}\n$2`;
    const output = source.replace(expression, replacement);
    if (output !== source) {
      changed.push(target.path);
      if (write) await writeFile(path, output);
    }
  }
  return changed;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (invokedPath === import.meta.url) {
  const changed = await generatePlayerDocs({ write: true });
  console.log(
    JSON.stringify(
      {
        generated: true,
        changed,
      },
      null,
      2,
    ),
  );
}
