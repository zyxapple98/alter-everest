# Exact expedition system

Status: implemented by protocol `0.7.0`.

This document defines the one current ALTER EVEREST gameplay architecture.
Player-facing instructions start at [`AGENTS.md`](../AGENTS.md); exact numeric
rules live in [`protocol/player-rules.json`](../protocol/player-rules.json).

## 1. Environment model

ALTER EVEREST is a shared, low-frequency environment with deterministic 20 cm
physical cells.

```text
human intention
  -> agent observes current authority
  -> agent searches locally
  -> agent submits one exact expedition
  -> verifier replays every transition
  -> serialized reducer commits all effects atomically
  -> canonical world advances once
```

The human chooses the intention and acceptable survival risk. After local
rehearsal, the agent asks for that intention when it has not already been
provided. The agent owns the route, action sequence and tradeoffs. The
environment owns physical truth and legality.

The globally committed action is one complete expedition. Local solvers may
reason in individual movements and matter transitions, but those transitions
are never committed independently.

## 2. Canonical authority

There is one authority chain:

| Input | Meaning |
| --- | --- |
| `world/snapshot.json` | Current matter, identities, footprints and world hash |
| `world/terrain.json` | Terrain registration and deterministic surface rules |
| `world/sites.json` | Named observation regions |
| `protocol/player-rules.json` | Public numeric gameplay rules |
| `schemas/candidate.schema.json` | Accepted candidate shape |
| verifier release hash | Exact engine implementation |

Examples, local plans, website views and Community Build discussions are
non-authoritative.

## 3. Candidate contract

A candidate is bounded JSON containing:

```text
protocol
id
parentWorldHash
terrainHash
agentId
proof
  route
    codec
    start
    stepCount
    program
    safeStop?
  actions[1..512]
```

The candidate is limited to 262,144 bytes. The decoded route is limited to
250,000 movements. It contains only declarative data.

The route codec is `ae-microtrace-v1`. It losslessly represents:

- the initial integer stance cell;
- each signed 20 cm cell delta;
- `WALK`, `SCRAMBLE` or `CLIMB`;
- whether personal protection is enabled.

The local authoring plan may attach labels to stance cells. The compiler
resolves those labels to exact step numbers and encodes the supplied trace. It
does not select cells or alter geometry.

## 4. Exact movement

For every decoded transition the verifier derives and checks:

- terrain or stone support beneath the stance;
- swept climber-body clearance;
- horizontal and vertical movement bounds;
- slope and selected locomotion mode;
- protection for climbing;
- carried load;
- elapsed time, energy and Endurance;
- Base Camp crossings and terminal safety.

Surface height, slope, material and altitude are verifier-derived facts. They
are not candidate claims.

This gives 20 cm collision and support semantics without storing a verbose
JSON sample for every step. The bytecode is the exact route, not a hint for a
server-side route builder.

## 5. Matter actions

Every action is a `RELOCATE`:

```text
BASE          -> WORLD   ADD
STONE         -> WORLD   MOVE
TERRAIN       -> WORLD   QUARRY
STONE/TERRAIN -> BASE    RECOVER
```

Each action names its matter, source, destination, `pickupStep` and
`releaseStep`. A climber carries at most one matter piece, so carry intervals
may touch but cannot overlap.

The verifier checks interaction reach at both endpoints and replays action
timing against the route:

```text
stance at step n
  -> release actions scheduled at n
  -> validate the resulting world
  -> pickup actions scheduled at n
  -> validate the pickup-only world
  -> verify movement n -> n+1 with the current load and world
```

All intermediate structures must satisfy the V2.1 voxel-static rules.
Excavation must advance from exposed air or an excavated face. The final
expedition commits only when every intermediate state is legal.

## 6. Survival

Each GitHub login is one mortal climber identity.

- Every expedition starts inside the 140 m Everest Base Camp zone.
- It leaves Camp exactly once.
- Its first return begins a terminal Camp phase.
- Returning preserves the identity.
- A legal safe terminal elsewhere accepts the expedition and kills the
  identity.

The verifier infers the outcome from the exact terminal stance. Outcome is not
a candidate option.

## 7. Planning surface

The repository exposes observation and evaluation primitives:

| Command | Purpose |
| --- | --- |
| `agent:inspect` | Identity, authority hashes, limits and next commands |
| `site:query` | Named geographic regions |
| `world:query` | Stones, edits and cells near a point |
| `terrain:query` | Exact terrain chunks or requested cells |
| `move:check` | One movement transition |
| `route:encode` / `route:decode` | Lossless route codec |
| `expedition:compile` | Label resolution and candidate packaging |
| `route:evaluate` | Route and Endurance replay |
| `expedition:check` | Complete route, actions and physics verdict |
| `expedition:apply` | Temporary local world application |
| `authority:check` | Canonical freshness check |

There is no prescribed solver. An agent may use graph search, constraint
solving, sampling, optimization, hand-authored traces or any combination.
Because all agents submit the same exact contract, stronger search can find
safer, shorter or more consequential legal expeditions without changing the
rules for weaker agents.

## 8. Feedback and complexity

Planning feedback is available at three costs:

1. observation queries inspect only relevant chunks or cells;
2. movement and route checks reject local geometry and Endurance failures;
3. the complete verifier replays temporal matter effects and static physics.

The final candidate is always judged by level 3. Lower-cost tools help a
solver search; they never complete a candidate on its behalf.

Route verification streams through decoded movements in linear time and keeps
only bounded state. Physics work is bounded by touched chunks, affected
stones, vertical levels and cavity cells. These limits keep both ordinary
interactive planning and long-running optimization practical.

## 9. Footprint

Accepted expeditions update independent descriptive facts:

- `acceptedExpeditions`;
- `totalDistanceMillimeters`;
- `activeTerrainRemovals`;
- `activeStonePlacements`;
- `activeAlterations`, the sum of the two active alteration counts.

An alteration belongs to the identity that caused the fact currently present
in the world. Moving or recovering matter removes the previous placement fact;
a new placement is attributed to the mover. These counters describe activity
and current physical effect.

## 10. GitHub transport and freshness

GitHub supplies identity, candidate admission, protected verification,
serialization, notifications and an auditable ledger.

Before submission, the agent runs:

```bash
npm run authority:check -- --fetch
npm run expedition:check -- work/candidate.json --diagnose
```

The reducer then replays the candidate against the latest canonical world. A
candidate based on an earlier hash may still apply when every required fact is
unchanged. A conflicting terrain cell, stone, route clearance or support fact
returns `STALE_CONFLICT` and requires replanning.

## 11. System invariants

1. The candidate is the agent's complete executable solution.
2. Every submitted movement is exact on the 20 cm grid.
3. Every matter effect occurs at an explicit route step.
4. The verifier derives physical facts and never improves the solution.
5. Intermediate and final worlds must all be legal.
6. Verification is deterministic from named public authority.
7. The reducer commits the entire expedition or nothing.
8. Only the serialized reducer advances canonical world state.
