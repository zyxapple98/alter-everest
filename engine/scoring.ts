import type {
  CandidateCommit,
  CanonicalWorld,
  RouteVerdict,
} from "./types";
import { operationLabel } from "./mutation";

export interface RewardBreakdown {
  altitudeM: number;
  heightPoints: number;
  survivalPoints: number;
  reservePoints: number;
  stewardshipPoints: number;
  total: number;
}

export function calculateReward(
  candidate: CandidateCommit,
  world: CanonicalWorld,
  route: RouteVerdict,
): RewardBreakdown {
  const proof = candidate.proof;
  const operation = operationLabel(proof.mutation);
  const actionIndex =
    proof.mutation.destination.kind === "BASE"
      ? proof.pickupIndex!
      : proof.releaseIndex!;
  const actionSample = proof.route[actionIndex];
  const baseAltitudeM = proof.route[0].altitudeM;
  const altitudeM = actionSample.altitudeM;
  const previousAltitudeM =
    proof.mutation.source.kind !== "BASE" &&
    proof.mutation.destination.kind === "WORLD"
      ? proof.route[proof.pickupIndex!].altitudeM
      : baseAltitudeM;
  const effectiveGainM =
    proof.mutation.destination.kind === "BASE"
      ? 0
      : Math.max(0, altitudeM - previousAltitudeM);
  const heightPoints = Math.round(effectiveGainM / 10);
  const survivalPoints = route.outcome === "ACTIVE" ? 120 : 0;
  const reservePoints = Math.round(route.enduranceRemaining * 0.6);
  const stewardshipPoints =
    operation === "RECOVER"
      ? 90
      : operation === "MOVE"
        ? 35
        : operation === "QUARRY"
          ? 25
        : 0;
  const duplicatePenalty = world.expeditions.filter(
    (record) => record.agentId === candidate.agentId,
  ).length;
  const total = Math.max(
    0,
    heightPoints +
      survivalPoints +
      reservePoints +
      stewardshipPoints -
      duplicatePenalty * 5,
  );
  return {
    altitudeM,
    heightPoints,
    survivalPoints,
    reservePoints,
    stewardshipPoints,
    total,
  };
}

export function buildLeaderboard(world: CanonicalWorld) {
  const totals = new Map<
    string,
    { agentId: string; score: number; summits: number; survived: number }
  >();
  for (const record of world.expeditions) {
    const entry = totals.get(record.agentId) ?? {
      agentId: record.agentId,
      score: 0,
      summits: 0,
      survived: 0,
    };
    entry.score += record.score;
    if (record.altitudeM >= 8_700) entry.summits += 1;
    if (record.outcome === "ACTIVE") entry.survived += 1;
    totals.set(record.agentId, entry);
  }
  return [...totals.values()].sort(
    (a, b) => b.score - a.score || a.agentId.localeCompare(b.agentId),
  );
}
