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
  trace?: Array<{ column: number; row: number }> | null;
}

export interface ObservatoryFeed {
  schemaVersion: "1.0.0";
  sequence: number;
  worldHash: string;
  summitHeightM: number;
  recentExpeditions: ObservatoryExpedition[];
  leaderboard: Array<{
    agent: string;
    totalScore: number;
    outcome: "ACTIVE" | "DEAD";
  }>;
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

export function fallbackObservatoryFeed(): ObservatoryFeed {
  return {
    schemaVersion: "1.0.0",
    sequence: 6318,
    worldHash: "world-000006318",
    summitHeightM: 8848.86,
    recentExpeditions: recentExpeditions(),
    leaderboard: observatoryLeaderboard(),
  };
}

export async function loadObservatoryFeed(signal: AbortSignal) {
  let worldBaseUrl = "/data/world";
  let pollIntervalMs = 30_000;
  try {
    const configResponse = await fetch("/runtime-config.json", {
      cache: "no-store",
      signal,
    });
    if (configResponse.ok) {
      const config = (await configResponse.json()) as {
        worldBaseUrl?: unknown;
        pollIntervalMs?: unknown;
      };
      if (
        typeof config.worldBaseUrl === "string" &&
        config.worldBaseUrl.length > 0
      ) {
        worldBaseUrl = config.worldBaseUrl.replace(/\/+$/, "");
      }
      if (
        typeof config.pollIntervalMs === "number" &&
        config.pollIntervalMs >= 10_000
      ) {
        pollIntervalMs = config.pollIntervalMs;
      }
    }
  } catch (error) {
    if (signal.aborted) throw error;
  }

  const response = await fetch(`${worldBaseUrl}/latest.json`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`World feed returned HTTP ${response.status}.`);
  }
  const feed = (await response.json()) as ObservatoryFeed;
  if (
    feed.schemaVersion !== "1.0.0" ||
    !Number.isSafeInteger(feed.sequence) ||
    typeof feed.worldHash !== "string" ||
    !Array.isArray(feed.recentExpeditions) ||
    feed.recentExpeditions.length === 0 ||
    !Array.isArray(feed.leaderboard)
  ) {
    throw new Error("World feed is not a supported observatory document.");
  }
  return { feed, pollIntervalMs };
}
