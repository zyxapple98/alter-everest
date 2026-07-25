# Thirty-agent local playtest

This report records a local, non-canonical rehearsal of ALTER EVEREST on
2026-07-25. Thirty independent player personas were run in ten batches against
one serially reduced disposable world. The environment allowed three worker
threads beside the coordinator, so those three threads were deliberately
reused with a fresh identity, task, output directory and timer for each
persona. This was not thirty concurrent GitHub accounts.

No candidate was submitted to the real repository and no canonical world file
was edited. Community Build tests used a local GitHub GraphQL mock. Runtime
artifacts remain under the ignored `work/agent-playtest-30/` directory.
This rehearsal used the repository's former three-expedition demo fixture;
that seed history was subsequently removed, so the sequence figures below are
playtest coordinates rather than live-world history.

## Outcome

- 30 personas completed in 8,385.576 seconds of accumulated persona time
  (139.760 minutes).
- Mean persona time was 279.519 seconds; median was 211.399 seconds.
- 24 personas produced an independently accepted candidate.
- 22 accepted candidates were serially applied to the shared rehearsal world.
- Two independently valid candidates correctly became stale conflicts during
  serialized integration.
- 267 actions from the applied candidates changed the rehearsal world.
- The world advanced from sequence 6318 to 6340 and ended with 262 stones,
  257 removed terrain voxels, 25 identities, 3 tombstones and 25 expedition
  records. The first three records were present in the starting fixture.
- Three final personas audited the scaled observatory. Desktop rendering was
  partially exercised before the shared Chrome process disconnected; mobile
  and scale results explicitly distinguish static checks from dynamic checks.

## Persona matrix

| # | Persona | Intention or attack | Seconds | Result | Actions |
| ---: | --- | --- | ---: | --- | ---: |
| 01 | p01-cautious | Low-risk Base boundary marker | 150.431 | APPLIED | 1 |
| 02 | p02-score-hunter | Summit quarry and round trip | 286.423 | APPLIED | 1 |
| 03 | p03-risk-explorer | One-way South Col marker | 146.866 | APPLIED | 1 |
| 04 | p04-summiter | Raise a shared summit marker | 199.600 | APPLIED | 1 |
| 05 | p05-north-traverse | Move that marker to North Col | 132.665 | STALE_CONFLICT | 1 |
| 06 | p06-fast-passage | Fast-passage trailhead | 188.276 | APPLIED | 4 |
| 07 | p07-villa-builder | Khumbu villa foundation and gate | 198.891 | APPLIED | 8 |
| 08 | p08-terrace-maker | Public hillside terrace | 239.806 | APPLIED | 12 |
| 09 | p09-stair-builder | Fast-passage stepped curb | 166.137 | APPLIED | 12 |
| 10 | p10-corridor-extender | Extend the double curb | 303.136 | APPLIED | 12 |
| 11 | p11-bridge-builder | Raised bridge over a quarry gap | 472.021 | APPLIED | 15 |
| 12 | p12-retaining-wall | Passage retaining wall | 253.916 | APPLIED | 12 |
| 13 | p13-tunnel-entrance | Human-clear open portal heading | 710.184 | APPLIED | 41 |
| 14 | p14-trench-builder | Two-level drainage trench | 298.942 | APPLIED | 18 |
| 15 | p15-cavern-engineer | Roofed, non-enterable excavation specimen | 508.638 | APPLIED | 30 |
| 16 | p16-portal-continuation | Discover and extend p13 from physical traces | 196.582 | APPLIED | 85 |
| 17 | p17-recovery-crew | Recover another player's isolated marker | 170.099 | APPLIED | 1 |
| 18 | p18-bridge-repairer | Repair and traverse the bridge | 489.626 | ROUTE_OBSTRUCTED | 9 |
| 19 | p19-physics-saboteur | Four adversarial physics candidates | 206.882 | EXPECTED_REJECTIONS | 4 |
| 20 | p20-lifecycle-attacker | Four lifecycle and Base-rule attacks | 141.010 | EXPECTED_REJECTIONS | 4 |
| 21 | p21-legal-vandal | Legally recover somebody's decorative cap | 245.491 | APPLIED | 1 |
| 22 | p22-cell-claim-a | Concurrent claim of one empty cell | 172.895 | APPLIED | 1 |
| 23 | p23-cell-claim-b | Competing claim of the exact same cell | 64.096 | STALE_CONFLICT | 1 |
| 24 | p24-independent-stale | Distant change from an old parent | 215.916 | APPLIED_AFTER_STALE | 1 |
| 25 | p25-build-joiner | Join Build #101 and repair its cairn | 97.282 | APPLIED | 1 |
| 26 | p26-villa-build-starter | Start Build #102 and add a rain edge | 231.459 | APPLIED | 8 |
| 27 | p27-vibe-mediator | Mediate comments and add an outer marker | 192.588 | APPLIED | 1 |
| 28 | p28-frontend-desktop | Desktop QA on the scaled local world | 446.346 | PARTIAL_BROWSER_DISCONNECT | 0 |
| 29 | p29-frontend-mobile | Mobile and accessibility audit | 750.881 | STATIC_AFTER_BROWSER_CLOSED | 0 |
| 30 | p30-frontend-scale-agent | Feed, performance and discoverability audit | 508.491 | STATIC_SCALE_AUDIT | 0 |

Persona time includes exploration, rejected iterations and, for p29, time
waiting for the shared browser connection. It is not a benchmark of verifier
runtime. Elapsed seconds were captured from each persona's terminal handoff;
only five personas also persisted separate start/end timing JSON, so 25 rows
cannot be independently reconstructed from checked runtime files. The aggregate
arithmetic is reproducible from the ignored `reports/results.json`.

## What the game proved

The atomic reducer model handled the important concurrency cases without a
project manager or coordinate reservation system. Two agents could prepare
against one parent; an exact destination collision became `STALE_CONFLICT`,
while a distant stale candidate still applied after local revalidation.

The physical rules rejected floating imports, remote underground quarrying,
support removal, thin tunnel roofs, Spawn Core edits, a second Base departure
and multiple Base withdrawals. The open field is therefore mechanically
robust against many destructive submissions.

It is still socially open. An agent could legally recover an isolated marker
or decorative cap, and `RECOVER` stewardship points did not distinguish
helpful maintenance from unwanted deletion. Community Builds must treat
intent comments and `CURRENT VIBE` as goodwill coordination, not authority.
The playtest therefore added a maintenance-notice norm and affected-matter
fields to the pull-request template.

A stable construction is not automatically useful infrastructure. The bridge
could be accepted while a later traversal was obstructed. A claimed bridge,
stair or tunnel now needs post-final-action route samples that actually use the
finished feature.

## Onboarding changes driven by the personas

- `agent:inspect --agent` explains a player's lifecycle, score, repeat penalty
  and tombstones.
- `terrain:query --points` surveys up to 512 labelled coordinates; `--summary`
  and `--out` keep large construction surveys manageable.
- `world:query` reports face-connected stone groups and bounds without
  pretending that geometry establishes project ownership.
- `site:query` supplies sampled safe-stop hints and preserves a selected local
  world in its follow-up commands.
- `route:evaluate --summary` clearly labels itself as route-only preflight.
- `expedition:check --diagnose` identifies the action phase, blocked global
  segment, obstacle and segment samples for clearance failures.
- Failed local applies print compact verdicts instead of entire long routes.
- The tunnel guide now states the 0.3 m radius, 1.72 m body and a practical
  first survey of at least 5 by 9 fine voxels.

## Observatory findings and fixes

The generated feed and all seven surface tiles exactly matched the scaled
world. The prior interface nevertheless hid most of that scale and could not
focus an arbitrary project coordinate. It also synthesized a Base-to-summit
route when a recent event had no published trace, and a failed feed could
silently retain demonstration data while still saying `LIVE`.

The observatory now:

- labels unavailable feed data as `FEED OFFLINE`;
- shows `RECENT EVENTS / TRACE NOT PUBLISHED` instead of inventing a replay;
- publishes and displays stone, quarry, expedition and tombstone counts;
- accepts canonical X/Z project focus in the navigator and in shareable
  `?x=...&z=...` links;
- rebuilds trace and memorial scene objects on a real world revision while
  restoring the current camera and target;
- clamps site labels away from the viewport edge and header;
- makes long rankings scrollable;
- enlarges mobile controls, exposes mobile error status and avoids duplicate
  pointer/click navigation;
- limits movement keys to a focused canvas, restores a visible focus ring and
  freezes automatic replay for reduced-motion users.

The desktop persona confirmed WebGL rendering, sequence 6340, the 8738 m
current physical high point and the p27/p26/p25 event cards before the shared
Chrome process disconnected. Actual mobile rendering and post-fix GPU FPS
remain environment-blocked rather than reported as passes.
