import assert from "node:assert/strict";
import test from "node:test";
import {
  FOOTPRINT_RANKING_LIMIT,
  rankFootprints,
  selectFootprintRankingCandidates,
  type FootprintRankingEntry,
} from "../lib/footprint-ranking";

const entries: FootprintRankingEntry[] = [
  {
    agent: "distance",
    acceptedExpeditions: 2,
    totalDistanceMillimeters: 9_000_000,
    activeAlterations: 1,
  },
  {
    agent: "alterer",
    acceptedExpeditions: 3,
    totalDistanceMillimeters: 2_000_000,
    activeAlterations: 12,
  },
  {
    agent: "expeditioner",
    acceptedExpeditions: 8,
    totalDistanceMillimeters: 1_000_000,
    activeAlterations: 2,
  },
];

test("footprints rank independently by all three public metrics", () => {
  assert.equal(
    rankFootprints(entries, "acceptedExpeditions")[0]?.agent,
    "expeditioner",
  );
  assert.equal(
    rankFootprints(entries, "totalDistanceMillimeters")[0]?.agent,
    "distance",
  );
  assert.equal(
    rankFootprints(entries, "activeAlterations")[0]?.agent,
    "alterer",
  );
});

test("footprint rankings cap at 100 with deterministic ties", () => {
  const tied = Array.from({ length: 120 }, (_, index) => ({
    agent: `agent-${String(119 - index).padStart(3, "0")}`,
    acceptedExpeditions: 1,
    totalDistanceMillimeters: 1_000,
    activeAlterations: 0,
  }));
  const ranked = rankFootprints(tied, "acceptedExpeditions");

  assert.equal(ranked.length, FOOTPRINT_RANKING_LIMIT);
  assert.equal(ranked[0]?.agent, "agent-000");
  assert.equal(ranked.at(-1)?.agent, "agent-099");
});

test("the feed candidate set contains the true top 100 for every metric", () => {
  const metricGroup = (
    prefix: string,
    metric: keyof Pick<
      FootprintRankingEntry,
      | "acceptedExpeditions"
      | "totalDistanceMillimeters"
      | "activeAlterations"
    >,
  ) =>
    Array.from({ length: FOOTPRINT_RANKING_LIMIT }, (_, index) => ({
      agent: `${prefix}-${String(index).padStart(3, "0")}`,
      acceptedExpeditions: 0,
      totalDistanceMillimeters: 0,
      activeAlterations: 0,
      [metric]: FOOTPRINT_RANKING_LIMIT - index,
    }));
  const candidates = selectFootprintRankingCandidates([
    ...metricGroup("expedition", "acceptedExpeditions"),
    ...metricGroup("distance", "totalDistanceMillimeters"),
    ...metricGroup("alteration", "activeAlterations"),
    {
      agent: "unranked",
      acceptedExpeditions: 0,
      totalDistanceMillimeters: 0,
      activeAlterations: 0,
    },
  ]);

  assert.equal(candidates.length, FOOTPRINT_RANKING_LIMIT * 3);
  assert.equal(candidates.some((entry) => entry.agent === "unranked"), false);
  assert.equal(
    rankFootprints(candidates, "acceptedExpeditions")[0]?.agent,
    "expedition-000",
  );
  assert.equal(
    rankFootprints(candidates, "totalDistanceMillimeters")[0]?.agent,
    "distance-000",
  );
  assert.equal(
    rankFootprints(candidates, "activeAlterations")[0]?.agent,
    "alteration-000",
  );
});
