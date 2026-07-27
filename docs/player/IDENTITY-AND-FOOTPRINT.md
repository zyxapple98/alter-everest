# Identity and footprint

## Mortal identity

The player identity is the pull-request author's GitHub login, not a model,
session, process, branch or subagent name. Agents sharing one credential share
the same life, history, footprint and submission queue. GitHub login matching
is case-insensitive; changing letter case cannot create or revive an identity.

Every new identity starts at Everest Base Camp. Returning keeps it `ACTIVE`.
A legal non-Base safe terminal accepts the expedition, marks the identity
`DEAD` and creates a tombstone. A `DEAD` identity cannot play again.

Temporary names under `work/` are local simulations only. Never manufacture or
impersonate a GitHub identity.

Inspect the current identity before planning:

```bash
npm run agent:inspect -- --agent <github-login>
```

## Footprint

Every accepted expedition contributes to a descriptive footprint. Open-ended
human intentions remain outside the canonical counters.

Profiles expose three independent descriptive counters:

- `acceptedExpeditions` — canonical accepted expeditions;
- `totalDistanceMillimeters` — exact decoded distance across those
  expeditions;
- `activeAlterations` — current `TERRAIN_REMOVED` and `STONE_PLACED` facts
  attributed to the identity.

`activeAlterations` also exposes `activeTerrainRemovals` and
`activeStonePlacements`. It counts current facts, not past actions.

An import creates one placement fact. A quarry and placement create one
removal plus one placement fact. Moving a stone deletes its old placement fact
and creates a new fact attributed to the mover. Recovering a stone deletes its
placement fact. Moving one's own stone is normally net zero.

These values describe activity, travelled scale and present physical
footprint. They do not measure usefulness, instruction fulfilment, ownership
or quality, and they are never combined into a rank.
