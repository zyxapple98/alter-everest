import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { CANDIDATE_LIMITS } from "../engine/constants";
import type {
  CandidateCommit,
  ExpeditionAction,
  MatterDestination,
  MatterSource,
} from "../engine/types";
import { validateCandidateShape } from "../lib/protocol";
import { compileAuthoringRoute } from "../lib/route-authoring";
import {
  formatPlayerHelp,
  PLAYER_DOCS,
} from "../lib/player-rules";
import { loadCanonicalWorld } from "./expedition-kit";
import protocolManifest from "../protocol/manifest.json";

const usage =
  "npm run expedition:compile -- <plan.json> [--world <snapshot.json>] [--out <candidate.json>]";
const help = formatPlayerHelp({
  command: "expedition:compile",
  purpose:
    "Losslessly pack an agent-supplied exact stance trace and labelled matter actions into a canonical candidate.",
  usage,
  sections: [
    {
      heading: "Plan shape",
      lines: [
        '{ "id", "agentId", "route": { "stances", "acceptOneWayDeath?" }, "actions" }',
        "Every stance contains an exact integer cell; the verifier derives locomotion.",
        "Each action uses pickupAt and releaseAt stance labels.",
        "Compilation losslessly encodes the supplied stance cells and action labels.",
        "Machine shape: schemas/expedition-plan.schema.json",
      ],
    },
    {
      heading: "Options",
      lines: [
        "--world <snapshot.json>    fill hashes from an isolated local world",
        "--out <candidate.json>     defaults to work/<agentId>/<id>.json",
      ],
    },
  ],
  output:
    "A schema-valid compact candidate plus exact decoded-step and action bindings.",
  next: [
    "Run route:evaluate for exact route preflight.",
    "Run expedition:check for the complete verdict.",
  ],
  docs: [
    PLAYER_DOCS.firstExpedition,
    PLAYER_DOCS.matter,
    PLAYER_DOCS.route,
    PLAYER_DOCS.submission,
  ],
});

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

interface PlanAction {
  kind: "RELOCATE";
  matterId: string;
  source: MatterSource;
  destination: MatterDestination;
  pickupAt: string;
  releaseAt: string;
}

interface ExpeditionPlan {
  id: string;
  agentId: string;
  route: unknown;
  actions: PlanAction[];
}

function parsePlan(value: unknown): ExpeditionPlan {
  if (!value || typeof value !== "object") {
    throw new Error("plan must be a JSON object.");
  }
  const plan = value as Record<string, unknown>;
  const supported = new Set(["id", "agentId", "route", "actions"]);
  if (Object.keys(plan).some((key) => !supported.has(key))) {
    throw new Error(
      "plan supports only id, agentId, route, and actions; hashes and protocol are compiled.",
    );
  }
  if (
    typeof plan.id !== "string" ||
    typeof plan.agentId !== "string" ||
    !Array.isArray(plan.actions) ||
    plan.actions.length < 1 ||
    plan.actions.length > CANDIDATE_LIMITS.maximumActions
  ) {
    throw new Error(
      `plan requires string id/agentId and 1–${CANDIDATE_LIMITS.maximumActions} actions.`,
    );
  }
  for (const [index, entry] of plan.actions.entries()) {
    if (!entry || typeof entry !== "object") {
      throw new Error(`action ${index} must be an object.`);
    }
    const action = entry as Record<string, unknown>;
    const keys = new Set([
      "kind",
      "matterId",
      "source",
      "destination",
      "pickupAt",
      "releaseAt",
    ]);
    if (
      Object.keys(action).some((key) => !keys.has(key)) ||
      action.kind !== "RELOCATE" ||
      typeof action.matterId !== "string" ||
      typeof action.pickupAt !== "string" ||
      typeof action.releaseAt !== "string" ||
      !action.source ||
      typeof action.source !== "object" ||
      !action.destination ||
      typeof action.destination !== "object"
    ) {
      throw new Error(
        `action ${index} requires kind, matterId, source, destination, pickupAt, and releaseAt.`,
      );
    }
  }
  return plan as unknown as ExpeditionPlan;
}

const planPath = process.argv[2];
if (!planPath || planPath === "--help") {
  console.log(help);
  process.exit(0);
}

const plan = parsePlan(
  JSON.parse(await readFile(resolve(planPath), "utf8")) as unknown,
);
const worldPath = argument("--world");
const world = await loadCanonicalWorld(worldPath);
const compiledRoute = compileAuthoringRoute(plan.route);

const actions: ExpeditionAction[] = plan.actions.map((action, index) => {
  const pickupStep = compiledRoute.labelSteps[action.pickupAt];
  const releaseStep = compiledRoute.labelSteps[action.releaseAt];
  if (pickupStep === undefined || releaseStep === undefined) {
    throw new Error(
      `action ${index} refers to an unknown pickupAt or releaseAt label.`,
    );
  }
  return {
    kind: "RELOCATE",
    matterId: action.matterId,
    source: action.source,
    destination: action.destination,
    pickupStep,
    releaseStep,
  };
});

const candidate: CandidateCommit = {
  protocol: protocolManifest.protocolVersion,
  id: plan.id,
  parentWorldHash: world.worldHash,
  terrainHash: world.terrainHash,
  agentId: plan.agentId,
  proof: { route: compiledRoute.route, actions },
};
const shape = validateCandidateShape(candidate);
if (!shape.valid) {
  throw new Error(
    `compiled candidate is not schema-valid:\n- ${shape.errors.join("\n- ")}`,
  );
}

const outputPath = resolve(
  argument("--out") ??
    `work/${candidate.agentId}/${candidate.id}.json`,
);
const worldSuffix = worldPath ? ` --world "${worldPath}"` : "";
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(candidate, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      compiled: true,
      output: outputPath,
      protocol: candidate.protocol,
      worldHash: candidate.parentWorldHash,
      terrainHash: candidate.terrainHash,
      routeCodec: candidate.proof.route.codec,
      routeSteps: candidate.proof.route.stepCount,
      routeProgramBytes: Buffer.from(
        candidate.proof.route.program,
        "base64url",
      ).byteLength,
      actionCount: actions.length,
      bindings: plan.actions.map((action, index) => ({
        action: index + 1,
        matterId: action.matterId,
        pickupAt: action.pickupAt,
        pickupStep: actions[index].pickupStep,
        releaseAt: action.releaseAt,
        releaseStep: actions[index].releaseStep,
      })),
      next: [
        `npm run route:evaluate -- "${outputPath}" --summary${worldSuffix}`,
        `npm run expedition:check -- "${outputPath}"${worldSuffix}`,
      ],
      authority:
        "Compilation is lossless packaging only. expedition:check remains the complete local verdict.",
    },
    null,
    2,
  ),
);
