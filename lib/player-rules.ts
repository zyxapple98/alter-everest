import playerRules from "../protocol/player-rules.json";

export const PLAYER_RULES = playerRules;
export const PLAYER_DOCS = playerRules.docs;

interface ErrorRule {
  ruleId: string;
  summary: string;
  next: string;
  doc: string;
  relatedValues?: string[];
}

function valueAtPath(path: string) {
  let value: unknown = playerRules;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object" || !(part in value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function guidanceForCode(code: string | null | undefined) {
  if (!code) return null;
  const rule = (
    playerRules.errors as Record<string, ErrorRule | undefined>
  )[code];
  if (!rule) return null;
  const limits = Object.fromEntries(
    (rule.relatedValues ?? [])
      .map((path) => [path, valueAtPath(path)] as const)
      .filter((entry) => entry[1] !== undefined),
  );
  return {
    ruleId: rule.ruleId,
    summary: rule.summary,
    next: rule.next,
    doc: rule.doc,
    ...(Object.keys(limits).length === 0 ? {} : { limits }),
  };
}

export interface PlayerHelpSection {
  heading: string;
  lines: string[];
}

export function formatPlayerHelp(input: {
  command: string;
  purpose: string;
  usage: string;
  sections?: PlayerHelpSection[];
  output: string;
  next: string[];
  docs: string[];
}) {
  const lines = [
    input.command,
    "",
    input.purpose,
    "",
    `Usage: ${input.usage}`,
  ];
  for (const section of input.sections ?? []) {
    lines.push("", `${section.heading}:`, ...section.lines.map((line) => `  ${line}`));
  }
  lines.push(
    "",
    "Output:",
    `  ${input.output}`,
    "",
    "Next:",
    ...input.next.map((line) => `  ${line}`),
    "",
    "Player docs:",
    ...input.docs.map((line) => `  ${line}`),
  );
  return lines.join("\n");
}
