import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compileAuthoringRoute } from "../lib/route-authoring";

const inputPath = process.argv[2];
const outIndex = process.argv.indexOf("--out");
const outputPath =
  outIndex === -1 ? null : process.argv[outIndex + 1] ?? null;

if (!inputPath || inputPath === "--help") {
  console.log(
    [
      "route:encode",
      "",
      "Losslessly encode an exact local stance trace as ae-microtrace-v2.",
      "",
      "Usage: npm run route:encode -- <route.json> [--out <encoded-route.json>]",
      "",
      "Input shape: { stances: [{ cell, label? }], acceptOneWayDeath? }",
      "This command losslessly encodes the supplied stance cells.",
    ].join("\n"),
  );
  process.exit(0);
}

const input = JSON.parse(
  await readFile(resolve(inputPath), "utf8"),
) as unknown;
const compiled = compileAuthoringRoute(input);
const text = `${JSON.stringify(compiled.route, null, 2)}\n`;
if (outputPath) {
  await writeFile(resolve(outputPath), text);
}
console.log(
  JSON.stringify(
    {
      route: compiled.route,
      labelSteps: compiled.labelSteps,
      ...(outputPath ? { output: resolve(outputPath) } : {}),
    },
    null,
    2,
  ),
);
