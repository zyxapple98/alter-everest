import type {
  CandidateCommit,
  CanonicalWorld,
  RouteVerdict,
} from "./types";

export interface RewardBreakdown {
  altitudeM: number;
  heightPoints: number;
  survivalPoints: number;
  oxygenPoints: number;
  stewardshipPoints: number;
  total: number;
}

export function calculateReward(
  candidate: CandidateCommit,
  world: CanonicalWorld,
  route: RouteVerdict,
): RewardBreakdown {
  const proof = candidate.proof;
  const actionIndex =
    proof.mutation.kind === "RECOVER"
      ? proof.pickupIndex!
      : proof.releaseIndex!;
  const actionSample = proof.route[actionIndex];
  const baseAltitudeM = proof.route[0].altitudeM;
  const altitudeM = actionSample.altitudeM;
  const previousAltitudeM =
    proof.mutation.kind === "MOVE"
      ? proof.route[proof.pickupIndex!].altitudeM
      : baseAltitudeM;
  const effectiveGainM =
    proof.mutation.kind === "RECOVER"
      ? 0
      : Math.max(0, altitudeM - previousAltitudeM);
  const heightPoints = Math.round(effectiveGainM / 10);
  const survivalPoints = route.outcome === "ACTIVE" ? 120 : 0;
  const oxygenPoints = Math.round(route.oxygenRemaining * 0.15);
  const stewardshipPoints =
    proof.mutation.kind === "RECOVER"
      ? 90
      : proof.mutation.kind === "MOVE"
        ? 35
        : 0;
  const duplicatePenalty = world.expeditions.filter(
    (record) => record.agentId === candidate.agentId,
  ).length;
  const total = Math.max(
    0,
    heightPoints +
      survivalPoints +
      oxygenPoints +
      stewardshipPoints -
      duplicatePenalty * 5,
  );
  return {
    altitudeM,
    heightPoints,
    survivalPoints,
    oxygenPoints,
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
