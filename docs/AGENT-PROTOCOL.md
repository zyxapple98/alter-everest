# Agent expedition protocol

Protocol version: `0.6.0`

## The human plays; the agent plans

A human supplies intent, not coordinates. The agent chooses the target, route,
action indices, destination cell and terminal point. The protocol contains no
trip-type field and the repository contains no official route or construction
solver.

Every identity begins in the 140 m Everest Base Camp zone and every expedition
must depart from it. Returning to that zone is the only survival condition. A
legal safe stop elsewhere accepts the actions, marks the identity `DEAD`, and
creates a tombstone. North Base Camp is a site, not an extraction point.

## Ordered matter actions

Every candidate contains an ordered `actions` array. Each action relocates one
piece of matter and binds both interactions to the shared route:

```json
{
  "actions": [
    {
      "kind": "RELOCATE",
      "matterId": "stone-example",
      "source": { "kind": "BASE" },
      "destination": {
        "kind": "WORLD",
        "cell": { "x": 400, "y": 22, "z": -101 }
      },
      "pickupIndex": 0,
      "releaseIndex": 93
    }
  ]
}
```

Cells are signed integer coordinates on the canonical 20 cm lattice. Sources
are `BASE`, `STONE`, and `TERRAIN`; destinations are `WORLD` and `BASE`. These
combinations represent import, move, quarry-and-relocate, and recovery.

Every action requires `pickupIndex < releaseIndex`. Actions appear in timeline
order and the next pickup may occur only at or after the previous release.
Equal boundary indices mean “release, then pick up” at the same route sample.
The climber is therefore always either `EMPTY` or carrying exactly one declared
`matterId`. The route must end empty-handed.

The following are rejected:

- `BASE -> BASE`;
- moving matter into its current cell;
- importing a Base stone inside the 140 m Base Camp zone;
- placement, quarry, or pickup inside the 20 m Spawn Core;
- an occupied destination;
- a placement without shared-face contact;
- a mutation that destabilizes affected stone or cavity structure;
- an operation that leaves all world tile hashes unchanged.

A `BASE` pickup or release must occur inside the 140 m Base Camp zone. One
expedition may contain at most one `BASE` source action, and its pickup must
happen before the first departure.

The route follows a one-sortie lifecycle:

```text
IN_BASE_PRE_DEPARTURE -> OUTSIDE -> RETURNED
```

The first return starts the terminal Camp phase. The climber may continue
walking inside Camp and may release matter already being carried to `BASE`,
but cannot start another action, release matter to `WORLD`, or leave Camp
again. A route that never leaves Camp is invalid. A segment that geometrically
cuts through Camp counts as re-entry even if both endpoints are outside.
Camp and the Spawn Core are horizontal cylinders measured in the XZ plane, so
changing altitude cannot bypass their boundaries. Endurance is never reset.

Protocol 0.6 still treats `BASE` as an external source and sink across
expeditions. The one-withdrawal limit controls each expedition; whether the
long-term supply becomes quota-bound or drawn from a persistent depot is a
separate world policy. The recommended depot design is documented in
[BASE-MATTER-DESIGN.md](BASE-MATTER-DESIGN.md).

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

Every action has a `pickupIndex` and `releaseIndex`. A non-Base interaction
sample must be within 1.25 m of the target cell centre; a Base interaction
sample must be inside Camp. A climber standing on a stone adds a transient
service load to that component; excavated passages must have usable body
clearance.

## Voxel static physics V2.1

The validator applies actions in order to a temporary world and checks the
affected face-connected components after each pickup and release:

- terrain anchorage;
- bounded horizontal support reach;
- centre of mass inside the anchor footprint;
- height-to-base slenderness;
- compression including transient climber load;
- tunnel roof thickness and local cavity radius.

Moves and quarry-and-relocate actions pass once with the source removed during
carrying and again in the destination state. Later actions may use structures
created by earlier actions. Every intermediate frame must be independently
stable; if any action or route phase fails, none of the actions are committed.

The exact rules and numerical limits are in [PHYSICS.md](PHYSICS.md) and
`engine/constants.ts`. There is no fall, settle, or collapse phase: an
operation that would cause collapse is unsupported and rejected.

Each mutation is bounded to 10,000 stone cells, 250 levels, 8 physics chunks
and a 64³ cavity window. An expedition is additionally bounded to 512 actions,
100,000 cumulative evaluated stone cells and 1,048,576 cumulative cavity cells,
within a four-second/256 MiB verifier process.

## Concurrency and authority

CI evaluates the candidate against its named hashes. The serialized reducer
then re-admits the exact blob and replays it against HEAD. Unrelated changes may
still pass. Changed route clearance, exposure, support, destination occupancy
or local static physics returns `STALE_CONFLICT`.

Only the reducer writes canonical state. Candidate PRs contain one JSON file
and cannot edit engine, workflow, world, data or infrastructure files.
