# Structures and excavation

ALTER EVEREST uses deterministic `VOXEL_STATIC_V2_1`. This is a
reality-informed game abstraction for ordinary interlocked stone masonry, not
engineering certification or rigid-body simulation.

## Authority

The public rules and limits are in `protocol/player-rules.json`. The full
candidate verdict comes from `expedition:check`. A playing agent does not need
the verifier implementation.

## Stone contact

Only shared faces connect cells. Edge and corner contact do not support a
stone. There are no rotations, friction impulses, settling or collapse phases.
An invalid intermediate state rejects the whole expedition.

## Static structure rules

After each pickup and release, every affected face-connected component must
pass:

1. **Anchorage** — at least one stone is directly above solid terrain.
2. **Reach** — horizontal support distance is at most
   `min(8, 4 + floor(log2(vertical thickness)))` cells.
3. **Balance** — combined center of mass stays inside the terrain-anchor
   footprint with a 0.05-cell inward margin.
4. **Slenderness** — height is at most ten times the smaller anchor-footprint
   dimension.
5. **Compression** — average stone-equivalent weight per anchor cell is at
   most 4,096.

Route validation adds the climber and any carried stone as transient service
load. A support cannot be removed during carrying merely because a later
placement would repair the final snapshot.

Supported patterns include grounded walls, rooms with short lintels, stepped
or corbelled arches, short masonry bridges, buttressed halls and adequately
based towers. Floating pieces, long decks, cables, eccentric cantilevers and
needle towers are rejected.

See the [visual stone-physics gallery](../../research/voxel-static-physics/README.md)
for illustrated structural units and stable construction sequences.

## Excavation

A terrain voxel can be quarried only when a face touches exterior air or an
already removed voxel. Tunnel excavation advances from a real opening.

Every quarry action checks its changed cavity. Remote excavation of sealed
matter is invalid.

## Tunnels

A horizontal tunnel retains at least two solid roof cells. Every checked
cavity cell remains within three horizontal Manhattan cells of solid side
material.

Route clearance separately requires 0.30 m radius and 1.72 m height. At 20 cm
resolution, survey at least a 5-cell-wide by 9-cell-high opening, then verify
the actual approach, interior and every excavation phase.

Wide rooms need ordinary stone pillars or partitions. Vertical open shafts are
not treated as roofed tunnels.

## Proving infrastructure is usable

`ACCEPTED` proves only the action and route phases included in the candidate.
A stable bridge, stair or tunnel is not automatically traversable.

When usability is part of the intention, append exact micro-movements after
the final action that actually cross the finished feature.

## Bounded verification

<!-- generated: physics-bounds:start -->

- 10,000 affected stone cells;
- 250 distinct stone levels;
- 8 touched physics chunks;
- 262,144 cells in one local cavity window;
- 512 actions;
- 100,000 cumulative evaluated stone cells;
- 1,048,576 cumulative cavity cells.
<!-- generated: physics-bounds:end -->

Designs exceeding a bound must be partitioned into independently stable
construction stages.
