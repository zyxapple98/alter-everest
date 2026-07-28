# Matter actions

This document owns player-facing matter flow, action timing, interaction and
protected-zone semantics. Candidate shape remains authoritative in
`schemas/candidate.schema.json`.

## Legal flows

Every action has `kind: "RELOCATE"`.

<!-- generated: matter-flows:start -->

| Operation | Flow | Meaning |
| --- | --- | --- |
| ADD | `BASE -> WORLD` | import one new stone |
| MOVE | `STONE -> WORLD` | relocate an existing stone |
| QUARRY | `TERRAIN -> WORLD` | remove exposed terrain and place it |
| RECOVER | `STONE/TERRAIN -> BASE` | carry matter back to Camp |
<!-- generated: matter-flows:end -->

`BASE -> BASE`, same-cell moves, replacing a quarried voxel into itself, and a
sequence with no final world change are rejected.

## Matter identity

One matter piece has one `matterId`. A moved stone uses its existing stone ID.
A Base import or quarried voxel becomes a stone with a new unique ID.

A moved-stone source does not repeat that ID:

```json
{
  "matterId": "existing-stone-id",
  "source": { "kind": "STONE" }
}
```

Stones occupy one exact integer 20 cm cell. They have no pose, rotation,
velocity or material subtype.

## Action timeline

Each action binds to one shared route with:

```json
{
  "pickupStep": 12034,
  "releaseStep": 12119
}
```

Pickup must precede release. Actions are timeline ordered. Carry intervals may
touch at one stance—release then pickup—but cannot overlap. The route ends
empty-handed.

The preferred authoring plan uses waypoint labels:

```json
{
  "pickupAt": "quarry-west",
  "releaseAt": "wall-course-2"
}
```

`expedition:compile` resolves them into canonical decoded step indices.

## Interaction points

A non-Base pickup or release target must be within 0.60 m horizontally and
between 0.20 m below and 1.80 m above the stance. A short sampled line from
the climber's upper body to the target must remain free of solid terrain and
other stones. A Base pickup or release stance must be inside Camp.

Use `world:query` for current stone cells, `terrain:query` for exact exposed
voxels and grounded destination hints, and `matter:check` for one supplied
transition's static-physics result. `matter:check` excludes action timing,
interaction reach, route clearance, carrying and identity; only
`expedition:check` verifies the full timeline.

## Base supply

One expedition may withdraw at most one new Base stone. Its pickup occurs
before the first departure. A new Base stone must be placed outside Camp.

Additional actions in the same sortie use existing WORLD stones or exposed
terrain.

## Terminal Camp phase

After the first return:

- no new action may start;
- no matter may release to WORLD;
- a stone or terrain voxel already being carried may release to BASE.

## Protected zones

The inner Spawn Core is a horizontal cylinder. Matter cannot be placed,
quarried or rearranged inside it. Changing altitude does not bypass it.

## Move

Inspect the stone's complete face-connected group before moving it. The
pickup-only world must remain stable before the destination state is tested.

Visible shared work may also have social context. Physics permission is not
social approval; inspect [Community Builds](COMMUNITY.md) before removing or
recovering recognizable work.

## Recovery

STONE or TERRAIN matter can be carried to BASE. Bind the release to an in-Camp
stance and ensure the loaded return route remains within Endurance and slope
limits.

## World destinations

A destination must be empty, within world bounds and share a face with solid
terrain or another stone. Grounded-cell query results are planning hints; only
the full verifier checks action order, static physics and route clearance.
