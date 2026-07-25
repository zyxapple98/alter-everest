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
cell, a tunnel face, a north-side goal or a risk preference. Multi-cell
structures take multiple expeditions; every intermediate state must be stable.

There is one ordinary stone material and no special scaffold resource.
Temporary props are allowed only when they are themselves legal stone
placements. Houses, stepped arches, short bridges, buttressed halls, supported
tunnels and pillared caverns are viable patterns. Floating parts, edge-only
contacts, long cables, thin roofs and collapse-causing steps are not.

The repository provides inspection, terrain query, route-cost, physics and full
verifier commands. It deliberately does not provide an official solver.

## Start and survival

All identities start in the 140 m Everest Base Camp zone. Returning preserves
the identity. A safe stop elsewhere accepts the mutation but kills the identity
and leaves a tombstone. North Base Camp is a landmark only.

## Failure is information

- `TERRAIN_MISMATCH`: route claims or excavation clearance disagree with the
  hashed terrain.
- `ACTION_POSITION_MISMATCH`: pickup or placement was attempted remotely.
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
- `ROUTE_OBSTRUCTED`: existing matter blocks the climber body.
- `STALE_CONFLICT`: another accepted expedition changed a required local fact;
  replan from HEAD.

Rejected candidates change no state and do not kill an identity. A legal
one-way expedition does.
