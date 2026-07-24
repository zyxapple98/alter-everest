import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  CandidateCommit,
  CanonicalExpeditionEvent,
  CanonicalWorld,
} from "../engine/types";

const OUTPUT_PATH = resolve("public/data/world/latest.json");
const BADGES_OUTPUT_PATH = resolve("public/data/world/badges.json");
const COLORS = ["#ff7138", "#d2dd72", "#70c6cf", "#bb91ff", "#f1bd59"];
const METERS_PER_DEGREE_LATITUDE = 111_320;

interface TerrainConfig {
  registration: {
    originLatitude: number;
    originRow: number;
    originColumn: number;
  };
  metadataPath: string;
}

interface DemMetadata {
  sampleSpacingArcSeconds: number;
}

function actionLabel(action: "ADD" | "MOVE" | "RECOVER") {
  return action === "ADD" ? "ADDED" : action === "MOVE" ? "MOVED" : "RECOVERED";
}

function hashBytes(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function loadEvents() {
  const directory = resolve("world/events");
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .reverse();
  return Promise.all(
    names.slice(0, 3).map(async (name) =>
      JSON.parse(
        await readFile(resolve(directory, name), "utf8"),
      ) as CanonicalExpeditionEvent,
    ),
  );
}

async function traceForEvent(
  event: CanonicalExpeditionEvent,
  config: TerrainConfig,
  metadata: DemMetadata,
) {
  if (!event.proofArtifact || event.proofArtifact.startsWith("sha256:")) {
    return null;
  }
  const bytes = await readFile(resolve(event.proofArtifact));
  if (hashBytes(bytes) !== event.candidateHash) {
    throw new Error(`Proof hash mismatch for event ${event.eventHash}.`);
  }
  const candidate = JSON.parse(bytes.toString("utf8")) as CandidateCommit;
  const route = candidate.proof.route;
  const actionIndex =
    candidate.proof.mutation.kind === "RECOVER"
      ? candidate.proof.pickupIndex!
      : candidate.proof.releaseIndex!;
  const degrees = metadata.sampleSpacingArcSeconds / 3600;
  const cellX =
    degrees *
    METERS_PER_DEGREE_LATITUDE *
    Math.cos((config.registration.originLatitude * Math.PI) / 180);
  const cellZ = degrees * METERS_PER_DEGREE_LATITUDE;
  const stride = Math.max(1, Math.ceil(route.length / 220));
  const trace = route
    .filter(
      (_, index) =>
        index === 0 ||
        index === route.length - 1 ||
        index === actionIndex ||
        index % stride === 0,
    )
    .map((sample) => ({
      column: config.registration.originColumn + sample.x / cellX,
      row: config.registration.originRow + sample.z / cellZ,
    }));
  return {
    trace,
    releaseFraction:
      route.length > 1 ? actionIndex / (route.length - 1) : 1,
  };
}

const [world, config] = await Promise.all([
  readFile(resolve("world/snapshot.json"), "utf8").then(
    (text) => JSON.parse(text) as CanonicalWorld,
  ),
  readFile(resolve("world/terrain.json"), "utf8").then(
    (text) => JSON.parse(text) as TerrainConfig,
  ),
]);
const metadata = JSON.parse(
  await readFile(resolve(config.metadataPath), "utf8"),
) as DemMetadata;
const events = await loadEvents();
const totals = new Map<string, number>();
for (const expedition of world.expeditions) {
  totals.set(
    expedition.agentId,
    (totals.get(expedition.agentId) ?? 0) + expedition.score,
  );
}
const identities = new Map(
  world.identities.map((identity) => [identity.id, identity.status]),
);

const recentExpeditions =
  events.length > 0
    ? await Promise.all(
        events.map(async (event, index) => {
          const route = await traceForEvent(event, config, metadata);
          return {
            id: event.candidateId,
            agent: event.agentId,
            action: actionLabel(event.action),
            commit: event.eventHash.slice(0, 7),
            color: COLORS[index % COLORS.length],
            returned: event.outcome === "ACTIVE",
            outcome: event.outcome,
            oxygenUsed: event.oxygenUsed,
            score: event.score,
            releaseFraction: route?.releaseFraction ?? 0.5,
            totalScore: totals.get(event.agentId) ?? event.score,
            trace: route?.trace ?? null,
          };
        }),
      )
    : world.expeditions.slice(0, 3).map((expedition, index) => ({
        id: expedition.id,
        agent: expedition.agentId,
        action: actionLabel(expedition.action),
        commit: world.worldHash.slice(-7),
        color: COLORS[index % COLORS.length],
        returned: expedition.outcome === "ACTIVE",
        outcome: expedition.outcome,
        oxygenUsed: expedition.oxygenUsed,
        score: expedition.score,
        releaseFraction: 0.5,
        totalScore: totals.get(expedition.agentId) ?? expedition.score,
        trace: null,
      }));

const leaderboard = [...totals.entries()]
  .map(([agent, totalScore]) => ({
    agent,
    totalScore,
    outcome: identities.get(agent) ?? "ACTIVE",
  }))
  .sort(
    (left, right) =>
      right.totalScore - left.totalScore || left.agent.localeCompare(right.agent),
  )
  .slice(0, 50);

const feed = {
  schemaVersion: "1.0.0",
  sequence: world.sequence,
  worldHash: world.worldHash,
  summitHeightM: 8848.86,
  recentExpeditions,
  leaderboard,
};

const badgeStats = {
  schemaVersion: "1.0.0",
  expeditions: world.expeditions.length,
  highestAltitudeM: Math.round(
    Math.max(0, ...world.expeditions.map((expedition) => expedition.altitudeM)),
  ),
  liveStones: world.stones.length,
  livingIdentities: world.identities.filter(
    (identity) => identity.status === "ACTIVE",
  ).length,
  worldSequence: world.sequence,
};

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await Promise.all([
  writeFile(OUTPUT_PATH, `${JSON.stringify(feed, null, 2)}\n`),
  writeFile(BADGES_OUTPUT_PATH, `${JSON.stringify(badgeStats, null, 2)}\n`),
]);
console.log(
  `Wrote ${OUTPUT_PATH} and ${BADGES_OUTPUT_PATH} for world ${world.sequence}.`,
);
