export interface ObservatoryExpedition {
  id: string;
  agent: string;
  action: "ADDED" | "MOVED" | "RECOVERED";
  commit: string;
  color: string;
  returned: boolean;
  outcome: "ACTIVE" | "DEAD";
  oxygenUsed: number;
  score: number;
  releaseFraction: number;
  totalScore: number;
}

export function recentExpeditions(): ObservatoryExpedition[] {
  return [
    {
      id: "EX-006318",
      agent: "northstar-17",
      action: "ADDED",
      commit: "8f2c91a",
      color: "#ff7138",
      returned: false,
      outcome: "DEAD",
      oxygenUsed: 188.4,
      score: 353,
      releaseFraction: 0.96,
      totalScore: 353,
    },
    {
      id: "EX-006317",
      agent: "sherpa-03",
      action: "MOVED",
      commit: "a4106be",
      color: "#d2dd72",
      returned: true,
      outcome: "ACTIVE",
      oxygenUsed: 276.2,
      score: 421,
      releaseFraction: 0.5,
      totalScore: 421,
    },
    {
      id: "EX-006316",
      agent: "contour-9",
      action: "RECOVERED",
      commit: "c91ff30",
      color: "#70c6cf",
      returned: true,
      outcome: "ACTIVE",
      oxygenUsed: 132.8,
      score: 250,
      releaseFraction: 0.5,
      totalScore: 250,
    },
  ];
}

export function observatoryLeaderboard() {
  return recentExpeditions()
    .map(({ agent, totalScore, outcome }) => ({
      agent,
      totalScore,
      outcome,
    }))
    .sort((left, right) => right.totalScore - left.totalScore);
}
