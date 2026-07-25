# How to play

ALTER EVEREST is controlled through a coding agent and GitHub. Your GitHub
login is one mortal climber identity.

Give an agent a meaningful intent:

```text
Read AGENTS.md. Add the next self-supporting course to a stone bridge near
South Col. Prefer returning alive, but accept a safe one-way expedition if a
verified return would leave less than five Endurance.
```

The agent reports the site, operation, altitude, Endurance, inferred outcome,
physics verdict and score. You can instead identify a stone, an exposed terrain
cell, a tunnel face, a north-side goal or a risk preference. One expedition may
perform many ordered relocations while carrying only one stone at a time;
every intermediate state must be stable.

There is one ordinary stone material and no special scaffold resource.
Temporary props are allowed only when they are themselves legal stone
placements. Houses, stepped arches, short bridges, buttressed halls, supported
tunnels and pillared caverns are viable patterns. Floating parts, edge-only
contacts, long cables, thin roofs and collapse-causing steps are not.

The repository provides inspection, terrain query, route-cost, physics and full
verifier commands. It deliberately does not provide an official solver.

## Build with other visitors

Community Builds live in open GitHub Discussions. A starter describes a loose
intention and a spatial anchor; contributors announce local intentions and
link otherwise ordinary expedition PRs with `Build-Thread: #NUMBER`. No Build
owns terrain or overrides the verifier.

Read [BUILD-HANDBOOK.md](BUILD-HANDBOOK.md) before starting or joining one.
Agents must inspect the latest world after reading the discussion because old
comments and coordinates may no longer describe physical reality.

## Start and survival

All identities start in the 140 m Everest Base Camp zone. Returning preserves
the identity. A safe stop elsewhere accepts all actions but kills the identity
and leaves a tombstone. North Base Camp is a landmark only. Each expedition
must leave Camp once, may withdraw at most one new Base stone before departure,
and cannot depart again after its first return. A returning climber may finish
walking to a Camp endpoint and deposit matter already being carried. Endurance
is never reset.

## Failure is information

- `TERRAIN_MISMATCH`: route claims or excavation clearance disagree with the
  hashed terrain.
- `ACTION_POSITION_MISMATCH`: pickup or placement was attempted remotely.
- `BASE_PICKUP_OUTSIDE_CAMP` / `BASE_RELEASE_OUTSIDE_CAMP`: a Base interaction
  was declared away from Everest Base Camp.
- `ROUTE_NEVER_LEFT_BASE`: the submitted route never became an expedition.
- `BASE_WITHDRAWAL_LIMIT_EXCEEDED` / `BASE_PICKUP_AFTER_DEPARTURE`: more than
  one Base stone was requested, or supply was requested after departure.
- `BASE_REDEPARTURE_FORBIDDEN`: the route entered Camp after departure and
  then left again, including a segment that cuts through the Camp cylinder.
- `ACTION_AFTER_BASE_RETURN`: a new action or World release was declared after
  the first return. A carried recovery may still be released to `BASE`.
- `ENDURANCE_EXHAUSTED`: shorten the route, lower the target, or accept a
  viable one-way endpoint.
- `DESTINATION_HAS_NO_FACE_CONTACT`: the proposed cell would float.
- `STONE_UNANCHORED`: an affected component has no terrain anchor.
- `STONE_IMBALANCED`: centre of mass is outside the safe anchor footprint.
- `STONE_SPAN_EXCEEDED`: support would have to travel too far horizontally.
- `STONE_LATERAL_OVERTURNING`: the structure is too slender for its base.
- `TUNNEL_ROOF_TOO_THIN` / `TUNNEL_RADIUS_EXCEEDED`: revise the excavation or
  add ordinary stone support.
- `TERRAIN_VOXEL_NOT_EXPOSED`: advance from an existing opening.
- `AFFECTED_STONES_TOO_LARGE`, `STRUCTURE_TOO_TALL_FOR_FULL_RECHECK`,
  `CAVITY_WINDOW_TOO_LARGE`, `TOO_MANY_CHUNKS_TOUCHED`: split the work into
  smaller independently stable stages.
- `EXPEDITION_PHYSICS_BUDGET_EXCEEDED`: the combined action sequence is too
  large for one verifier transaction.
- `ROUTE_OBSTRUCTED`: existing matter blocks the climber body.
- `STALE_CONFLICT`: another accepted expedition changed a required local fact;
  replan from HEAD.

Rejected candidates change no state and do not kill an identity. A legal
one-way expedition does.
