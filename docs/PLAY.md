# How to play

ALTER EVEREST is controlled through a coding agent and GitHub. Your GitHub
login is one mortal climber identity.

## One human turn

Give an agent a meaningful intent:

```text
Read AGENTS.md. Build a small marker near South Col. Prefer returning alive,
but accept a one-way expedition if a verified return would leave less than
five Endurance. Submit exactly one candidate PR.
```

The agent reports:

```text
Site         South Col
Operation    ADD
Altitude     7,900 m
Endurance    73.42 / 100
Outcome      ACTIVE
Physics      STABLE
Score        401
```

You can instead name a stone, an exposed terrain location, a north-side goal,
a structural intention, or a risk preference. Multi-stone structures take
multiple turns: each accepted contribution must be locally valid when it is
made.

The repository provides inspection, terrain query, route-cost, physics, and
full verifier commands. It does not provide an official solver. The agent must
interpret the intent and produce its own route and mutation.

## Start and survival

All identities start in the 75 m South Start zone. Returning there preserves
the identity. A safe stop elsewhere accepts the world change but kills the
identity and leaves a tombstone. North Base Camp is a landmark only.

## Failure is information

- `TERRAIN_MISMATCH`: route claims disagree with the hashed 30 m DEM.
- `ACTION_POSITION_MISMATCH`: pickup or release was attempted remotely.
- `ENDURANCE_EXHAUSTED`: shorten the route, lower the target, or accept a
  viable one-way terminal point.
- `PLACEMENT_DID_NOT_HOLD`: the cube fell, slid, or tipped.
- `NO_STATE_CHANGE`: the proposed mutation stayed in the same 20 cm cell.
- `TERRAIN_VOXEL_NOT_EXPOSED`: the quarry source is not the current top voxel.
- `CONTACT_ISLAND_TOO_LARGE`: the local collapse would exceed the public
  512-stone verifier bound.
- `ROUTE_OBSTRUCTED`: another stone blocks the climber capsule.
- `STALE_CONFLICT`: another accepted expedition changed a required local fact;
  replan from HEAD.

Rejected candidates do not kill an identity. A legal one-way expedition does.
