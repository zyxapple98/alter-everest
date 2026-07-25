# Agent expedition protocol

Protocol version: `0.5.0`

## The human plays; the agent plans

A human supplies intent, not coordinates. The agent chooses the target, route,
action indices, destination cell and terminal point. The protocol contains no
trip-type field and the repository contains no official route or construction
solver.

Every identity begins in the 140 m Everest Base Camp zone. Returning to that
zone is the only survival condition. A legal safe stop elsewhere accepts the
mutation, marks the identity `DEAD`, and creates a tombstone. North Base Camp is
a site, not an extraction point.

## One matter rule

Every candidate contains exactly one `RELOCATE`:

```json
{
  "kind": "RELOCATE",
  "matterId": "stone-example",
  "source": { "kind": "BASE" },
  "destination": {
    "kind": "WORLD",
    "cell": { "x": 400, "y": 22, "z": -101 }
  }
}
```

Cells are signed integer coordinates on the canonical 20 cm lattice. Sources
are `BASE`, `STONE`, and `TERRAIN`; destinations are `WORLD` and `BASE`. These
combinations represent import, move, quarry-and-relocate, and recovery.

The following are rejected:

- `BASE -> BASE`;
- moving matter into its current cell;
- importing a Base stone inside the 140 m Base Camp zone;
- placement, quarry, or pickup inside the 20 m Spawn Core;
- an occupied destination;
- a placement without shared-face contact;
- a mutation that destabilizes affected stone or cavity structure;
- an operation that leaves all world tile hashes unchanged.

A terrain voxel is exposed when a face touches exterior air or a previously
removed voxel. Tunnel excavation must therefore advance from an actual opening.

## Endurance

Endurance is the only expedition resource:

```text
ENDURANCE_MAX = 100
1 Endurance = 450 kJ
route cost = integrated route energy / 450
```

The public integral in `engine/route.ts` accounts for distance, grade, the
carried 21.6 kg stone, locomotion mode, surface, altitude and time. Exceeding
100 rejects the candidate without changing state. A safe non-Base endpoint is
valid but fatal. Reserve several Endurance rather than targeting floating-point
equality.

## Terrain truth and sparse storage

Route coordinates are local metres registered to the hashed Copernicus GLO-30
authority. CI recomputes height, altitude, slope and surface; candidate
annotations are claims.

```text
30 m measured DEM
  -> 256 m streaming tile
    -> 32 m physics chunk
      -> 20 cm canonical cell
```

Seeded naturalization supplies bounded sub-grid relief without claiming
additional measurement. Untouched terrain stays implicit. Canonical state
stores removed terrain cells, placed stone cells, modified chunk hashes and
modified tile hashes.

## Route and action binding

Horizontal route segments are at most 45 m. Every segment is checked for
locomotion mode, slope, protection, Endurance, authoritative terrain, body
clearance and existing stone obstacles.

`pickupIndex` is required for a `STONE` or `TERRAIN` source. `releaseIndex` is
required for a `WORLD` destination. Each action sample must be within 1.25 m of
the target cell centre. A climber standing on a stone adds a transient service
load to that component; excavated passages must have usable body clearance.

## Voxel static physics V2.1

The validator tentatively applies the one-cell mutation and atomically checks
the affected face-connected components:

- terrain anchorage;
- bounded horizontal support reach;
- centre of mass inside the anchor footprint;
- height-to-base slenderness;
- compression including transient climber load;
- tunnel roof thickness and local cavity radius.

Moves and quarry-and-relocate actions must pass twice: once with the source
removed during carrying, and once in the final destination state. Each route
phase is checked against the matter that exists during that phase.

The exact rules and numerical limits are in [PHYSICS.md](PHYSICS.md) and
`engine/constants.ts`. There is no fall, settle, or collapse phase: an
operation that would cause collapse is unsupported and rejected.

The maximum recheck is 10,000 stone cells, 250 levels, 8 physics chunks and a
64³ cavity window, within a four-second/256 MiB verifier process.

## Concurrency and authority

CI evaluates the candidate against its named hashes. The serialized reducer
then re-admits the exact blob and replays it against HEAD. Unrelated changes may
still pass. Changed route clearance, exposure, support, destination occupancy
or local static physics returns `STALE_CONFLICT`.

Only the reducer writes canonical state. Candidate PRs contain one JSON file
and cannot edit engine, workflow, world, data or infrastructure files.
