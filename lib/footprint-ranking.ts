export const FOOTPRINT_RANKING_LIMIT = 100;

export const FOOTPRINT_SORT_KEYS = [
  "acceptedExpeditions",
  "totalDistanceMillimeters",
  "activeAlterations",
] as const;

export type FootprintSortKey = (typeof FOOTPRINT_SORT_KEYS)[number];

export interface FootprintRankingEntry {
  agent: string;
  acceptedExpeditions: number;
  totalDistanceMillimeters: number;
  activeAlterations: number;
}

function compareAgent(
  left: FootprintRankingEntry,
  right: FootprintRankingEntry,
) {
  const leftAgent = left.agent.toLowerCase();
  const rightAgent = right.agent.toLowerCase();
  if (leftAgent < rightAgent) return -1;
  if (leftAgent > rightAgent) return 1;
  if (left.agent < right.agent) return -1;
  if (left.agent > right.agent) return 1;
  return 0;
}

export function rankFootprints<T extends FootprintRankingEntry>(
  entries: readonly T[],
  sortKey: FootprintSortKey,
  limit = FOOTPRINT_RANKING_LIMIT,
) {
  const boundedLimit = Math.max(0, Math.floor(limit));
  return [...entries]
    .sort((left, right) => {
      const metricDifference = right[sortKey] - left[sortKey];
      return metricDifference || compareAgent(left, right);
    })
    .slice(0, boundedLimit);
}

/**
 * The client needs the real top entries for all three views without receiving
 * an unbounded identity history. The union is capped at 300 unique identities.
 */
export function selectFootprintRankingCandidates<
  T extends FootprintRankingEntry,
>(
  entries: readonly T[],
  limit = FOOTPRINT_RANKING_LIMIT,
) {
  const selected = new Map<string, T>();
  FOOTPRINT_SORT_KEYS.forEach((sortKey) => {
    rankFootprints(entries, sortKey, limit).forEach((entry) => {
      selected.set(entry.agent.toLowerCase(), entry);
    });
  });
  return [...selected.values()].sort(compareAgent);
}
