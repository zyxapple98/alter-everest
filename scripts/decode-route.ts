import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CANDIDATE_LIMITS } from "../engine/constants";
import { decodeRouteProgram } from "../engine/route-codec";
import type { CandidateCommit, ExactRoute } from "../engine/types";

const inputPath = process.argv[2];
const outIndex = process.argv.indexOf("--out");
const outputPath =
  outIndex === -1 ? null : process.argv[outIndex + 1] ?? null;
const summaryOnly = process.argv.includes("--summary");

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

if (!inputPath || inputPath === "--help") {
  console.log(
    [
      "route:decode",
      "",
      "Expand canonical ae-microtrace-v2 for inspection and conformance tests.",
      "",
      "Usage: npm run route:decode -- <route-or-candidate.json> [--summary] [--range <first:last> | --around-step <step>] [--out <stances.json>]",
      "",
      "--summary omits expanded stances.",
      "--range selects an inclusive stance range.",
      "--around-step selects five stances centred on one step.",
      "--out writes the selected expansion and prints only a compact receipt.",
    ].join("\n"),
  );
  process.exit(0);
}

const parsed = JSON.parse(
  await readFile(resolve(inputPath), "utf8"),
) as ExactRoute | CandidateCommit;
const route =
  "proof" in parsed ? parsed.proof.route : parsed;
const decoded = decodeRouteProgram(route, {
  maximumSteps: CANDIDATE_LIMITS.maximumDecodedRouteSteps,
  requireCanonical: true,
});

const rangeArgument = argument("--range");
const aroundArgument = argument("--around-step");
if (rangeArgument && aroundArgument) {
  throw new Error("Choose either --range or --around-step, not both.");
}
let first = 0;
let last = decoded.stances.length - 1;
if (rangeArgument) {
  const match = /^(\d+):(\d+)$/.exec(rangeArgument);
  if (!match) throw new Error("--range must be formatted as <first:last>.");
  first = Number(match[1]);
  last = Number(match[2]);
} else if (aroundArgument) {
  const step = Number(aroundArgument);
  if (!Number.isSafeInteger(step) || step < 0) {
    throw new Error("--around-step must be a non-negative integer.");
  }
  first = Math.max(0, step - 2);
  last = Math.min(decoded.stances.length - 1, step + 2);
}
if (
  first > last ||
  first < 0 ||
  last >= decoded.stances.length
) {
  throw new Error(
    `Selected stance range must stay within 0:${decoded.stances.length - 1}.`,
  );
}

const cells = decoded.stances.map((stance) => stance.cell);
const minimum = { ...cells[0] };
const maximum = { ...cells[0] };
for (const cell of cells.slice(1)) {
  minimum.x = Math.min(minimum.x, cell.x);
  minimum.y = Math.min(minimum.y, cell.y);
  minimum.z = Math.min(minimum.z, cell.z);
  maximum.x = Math.max(maximum.x, cell.x);
  maximum.y = Math.max(maximum.y, cell.y);
  maximum.z = Math.max(maximum.z, cell.z);
}
const summary = {
  codec: route.codec,
  stepCount: route.stepCount,
  stanceCount: decoded.stances.length,
  start: decoded.stances[0],
  end: decoded.stances.at(-1),
  bounds: {
    minimum,
    maximum,
  },
  verticalDeltas: Object.fromEntries(
    [...new Set(decoded.movements.map((movement) => movement.dy))]
      .sort((left, right) => left - right)
      .map((dy) => [
        String(dy),
        decoded.movements.filter((movement) => movement.dy === dy).length,
      ]),
  ),
};
const output = summaryOnly
  ? summary
  : {
      ...summary,
      selectedRange: { first, last },
      stances: decoded.stances.slice(first, last + 1),
    };
const text = `${JSON.stringify(output, null, 2)}\n`;
if (outputPath) await writeFile(resolve(outputPath), text);
console.log(
  outputPath
    ? JSON.stringify(
        {
          output: resolve(outputPath),
          ...summary,
          writtenStances: summaryOnly ? 0 : last - first + 1,
          ...(summaryOnly ? {} : { selectedRange: { first, last } }),
        },
        null,
        2,
      )
    : text.trimEnd(),
);
