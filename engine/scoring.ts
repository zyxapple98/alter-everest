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
  repeatPenaltyPoints: number;
  total: number;
}

export function calculateReward(
  candidate: CandidateCommit,
  world: CanonicalWorld,
  route: RouteVerdict,
): RewardBreakdown {
  const proof = candidate.proof;
  const baseAltitudeM = proof.route[0].altitudeM;
  const actionAltitudes = proof.actions.map((action) => {
    const actionIndex =
      action.destination.kind === "BASE"
        ? action.pickupIndex
        : action.releaseIndex;
    return proof.route[actionIndex].altitudeM;
  });
  const altitudeM = Math.max(...actionAltitudes);
  const effectiveGainM = Math.max(
    0,
    ...proof.actions.map((action) => {
      if (action.destination.kind === "BASE") return 0;
      const previousAltitudeM =
        action.source.kind === "BASE"
          ? baseAltitudeM
          : proof.route[action.pickupIndex].altitudeM;
      return proof.route[action.releaseIndex].altitudeM - previousAltitudeM;
    }),
  );
  const heightPoints = Math.round(effectiveGainM / 10);
  const survivalPoints = route.outcome === "ACTIVE" ? 120 : 0;
  const reservePoints = Math.round(route.enduranceRemaining * 0.6);
  const stewardshipPoints = Math.max(
    0,
    ...proof.actions.map((action) => {
      const operation = operationLabel(action);
      return operation === "RECOVER"
        ? 90
        : operation === "MOVE"
          ? 35
          : operation === "QUARRY"
            ? 25
            : 0;
    }),
  );
  const duplicatePenalty = world.expeditions.filter(
    (record) => record.agentId === candidate.agentId,
  ).length;
  const repeatPenaltyPoints = duplicatePenalty * 5;
  const total = Math.max(
    0,
    heightPoints +
      survivalPoints +
      reservePoints +
      stewardshipPoints -
      repeatPenaltyPoints,
  );
  return {
    altitudeM,
    heightPoints,
    survivalPoints,
    reservePoints,
    stewardshipPoints,
    repeatPenaltyPoints,
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
