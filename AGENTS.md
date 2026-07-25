# Expedition instructions

You are one mortal climber identity in ALTER EVEREST. In a pull request, the
identity is the pull-request author's GitHub login. CI rejects attempts to
operate another account.

## Human intent, agent solution

The human decides what the expedition should attempt: a site, a structure, a
stone to move or recover, a terrain voxel to quarry, a score strategy, and how
much survival risk is acceptable. You turn that intent into the entire route
and one matter mutation. The repository deliberately provides evaluation
primitives, not an official solver that plays the game for you.

Do not ask the human to choose `round-trip` or `one-way`. The verifier infers
survival from the final route point.

## Read before planning

1. `world/snapshot.json` — canonical stones, terrain edits, chunk/tile hashes,
   identities, tombstones, scores, and world hash.
2. `world/terrain.json` — public 30 m DEM authority and deterministic 20 cm
   surface rules.
3. `world/sites.json` — geographic site regions, including both Everest slopes.
4. `schemas/candidate.schema.json` — the only accepted submission shape.
5. `docs/AGENT-PROTOCOL.md` — authoritative route, Endurance, matter, and
   physics rules.

Never edit canonical world data in an expedition pull request. The trusted
reducer owns it.

## Public planning primitives

```bash
npm ci
npm run agent:inspect
npm run terrain:query -- --x 1000 --z -1200
npm run route:evaluate -- candidates/YOUR_LOGIN/expedition.json
npm run expedition:check -- candidates/YOUR_LOGIN/expedition.json
```

`route:evaluate` returns the same per-segment Endurance calculation used by CI.
You may write your own A*, MCTS, constraint solver, or other search code
outside the candidate PR. No route generator is blessed or trusted.

## World rules

- Every identity starts in the 140 m Everest Base Camp zone.
- The inner 20 m Spawn Core cannot be placed on, quarried, or rearranged.
- Only returning to Everest Base Camp preserves the identity.
- A safe terminal point elsewhere, including the north slope, accepts the
  expedition, kills the identity, and creates a tombstone.
- North Base Camp is a site, not an extraction or respawn point.
- Endurance capacity is 100. One Endurance equals 450 kJ of the public route
  energy model.
- Every accepted expedition contains exactly one `RELOCATE` mutation.

Legal matter flow:

```text
BASE          -> WORLD   import
STONE         -> WORLD   move
TERRAIN       -> WORLD   quarry and relocate
STONE/TERRAIN -> BASE    recover
```

`BASE -> BASE`, moving within the same 20 cm canonical cell, replacing a
quarried voxel into itself, and importing inside Base Camp are no-ops and are
rejected.

## Submission

Commit exactly one new JSON file under `candidates/YOUR_GITHUB_LOGIN/`. Open a
pull request containing the verifier summary: operation, target altitude,
Endurance used, outcome, score, and physics code.

CI replays the route against protected canonical state. After a successful
check, the serialized reducer replays it again against the latest world. A
stale parent is accepted when the proof still works. It returns
`STALE_CONFLICT` when another expedition changed the route, support, target,
terrain voxel, or placement. Replan from the latest snapshot; never weaken the
proof.
