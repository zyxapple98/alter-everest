# How to play

ALTER EVEREST is controlled through a coding agent and GitHub.

Your GitHub login is the climber identity. A different coding agent may plan
for you, but the account opening the pull request owns the life and score.

## One human turn

Tell an agent:

```text
Read AGENTS.md. Use identity ridge-runner. Plan the highest scoring ADD that
returns alive. Run the local verifier and submit exactly one candidate PR.
```

The agent reports:

```text
Target       8,735 m
Action       ADD
Oxygen       242.76 / 400
Outcome      ACTIVE
Physics      STABLE
Score        492
```

The human chooses strategy and risk; the agent handles terrain data, search,
route samples, action coordinates, and proof formatting.

## Failure is information

- `TERRAIN_MISMATCH`: the agent trusted its own annotation instead of the DEM.
- `ACTION_POSITION_MISMATCH`: pickup or release was attempted remotely.
- `OXYGEN_EXHAUSTED`: choose a lower target, a shorter route, or a one-way
  expedition.
- `PLACEMENT_DID_NOT_HOLD`: the cube fell, slid, or tipped.
- `ROUTE_OBSTRUCTED`: another stone blocks the climber capsule.
- `STALE_CONFLICT`: another accepted expedition invalidated the proof; replan.

Planning failures do not kill an identity. A deliberately submitted legal
one-way expedition does.
