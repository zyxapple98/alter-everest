# Agent expedition protocol

Protocol version: `0.4.0`

## The human plays; the agent plans

A human supplies intent, not coordinates. Useful commands include:

> Build a marker near South Col and preserve this identity.

> Quarry one exposed summit voxel, carry it to the north slope, and accept
> death if a return exceeds 95 Endurance.

> Move this stone so a climber can pass underneath it. Treat this as one
> contribution to a multi-expedition structure.

The agent chooses the target, route, action indices, release pose, and terminal
point. The protocol contains no trip-type field and the official repository
contains no answer-generating planner.

## Domain, base, and sites

The authoritative route DEM covers approximately 27.90–28.20° N and
86.78–87.07° E: South Start, the south route, summit, North Col, north route,
and the Rongbuk/North Base region are in one physical domain. More distant
terrain is visual LOD.

Every route starts inside the 75 m South Start zone. Returning to that zone is
the only V1 survival condition. A legal safe stop anywhere else is a successful
one-way expedition: the mutation remains, the identity becomes `DEAD`, and a
tombstone is created. North Base Camp is not an extraction zone.

Sites are geographic regions, not protected voxels. `Everest Summit` is a
fixed historical anchor. `Current Highest Point` is derived from the live
naturalized terrain, excavations, and placed stones; the two can diverge.

## One matter rule

Every candidate contains one `RELOCATE`:

```json
{
  "kind": "RELOCATE",
  "matterId": "stone-example",
  "source": { "kind": "BASE" },
  "destination": {
    "kind": "WORLD",
    "releasePose": {
      "translation": { "x": 80.1, "y": 4.3, "z": -20.1 },
      "rotation": { "x": 0, "y": 0, "z": 0, "w": 1 }
    }
  }
}
```

Sources are `BASE`, `STONE`, and `TERRAIN`. Destinations are `WORLD` and
`BASE`. This represents import, move, quarry-and-relocate, and recovery without
separate privileged action paths.

The following are rejected:

- `BASE -> BASE`;
- an existing stone whose release remains in the same 20 cm canonical cell;
- an excavated voxel placed back into its source cell;
- a new Base stone released anywhere in the 75 m Base Camp Zone;
- any placement, quarry, or stone pickup inside the 20 m Spawn Core;
- an operation that leaves all world tile hashes unchanged.

Only the currently exposed top voxel of a 20 cm terrain column may be quarried.
This V1 rule permits real surface excavation while avoiding an unbounded cave,
fracture, and overburden simulation.

## Endurance

Endurance is the only expedition resource:

```text
ENDURANCE_MAX = 100
1 Endurance = 450 kJ
route cost = integrated route energy / 450
```

The energy integral is public code in `engine/route.ts`. Each segment accounts
for distance, ascent/descent grade, carried 21.6 kg stone, locomotion mode,
surface class, altitude multiplier, and travel time. `route:evaluate` exposes
the same per-segment breakdown and remaining reserve used by CI. A candidate
does not declare its own cost.

Exceeding 100 is invalid and changes no state. Ending safely away from South
Start within the budget is valid and fatal. Agents should normally reserve
3–5 Endurance rather than target floating-point equality at 100.

## Terrain truth and storage

Route coordinates are local metres registered to a public Copernicus GLO-30
authority. CI recomputes height, absolute altitude, slope, and surface from the
hashed bytes. Candidate annotations are claims, not authority.

The public hierarchy is:

```text
30 m measured DEM
  -> 256 m streaming tile
    -> 32 m physics chunk
      -> 20 cm voxel
```

The measured DEM is never presented as 20 cm measurement. A fixed,
versioned, seeded naturalization function generates bounded sub-grid relief.
Unmodified columns are implicit. Canonical state stores only removed terrain
voxels, dynamic stone poses, modified chunk hashes, and modified tile hashes.

A 32 m chunk is 160 × 160 horizontal voxel columns. A 256 m tile is 8 × 8
chunks. Sparse storage prevents the impossible dense representation of the
whole mountain and allows unrelated stale candidates to be replayed rather
than rejected merely because the global sequence changed.

## Route binding

Horizontal proof segments are at most 45 m. Each segment is checked for mode,
slope, protection, Endurance, terrain truth, and swept-capsule clearance.

`pickupIndex` is required for `STONE` and `TERRAIN` sources.
`releaseIndex` is required for a `WORLD` destination. Both route samples must
be within 1.25 m of their physical target. The candidate never chooses an
outcome flag.

## Rigid-body physics

Each movable stone is a 20 cm, 21.6 kg granite cube. Release translation snaps
to 1 cm; release orientation is axis-aligned and initial velocity is zero.
After release the cube is free to fall, slide, tip, rotate, collide, transfer
impulse, and settle.

The deterministic Rapier solver applies gravity, rigid contact, Coulomb
friction and tangential shear, torque, restitution, damping, CCD, and a fixed
120 Hz time step. A floating `PLACE` therefore falls, but V1 rejects it because
the final cube must remain within 2.5 cm of the declared release pose.

`DROP` and `THROW` are not V1 actions. `DROP` needs swept loading of impact
regions; `THROW` additionally needs a safe policy for arbitrary initial
momentum.

The verifier builds a conservative local contact island with a spatial hash,
recursively expands through possible cube contacts, wakes the island, and lets
Rapier determine actual contacts. Remote sleeping stones are preserved
verbatim. A public 512-stone island cap and four-second verifier limit bound
adversarial cost. Rapier is the mature rigid-body solver; contact-island
selection is project infrastructure and remains deliberately conservative.

## Concurrency

CI first evaluates a candidate against its named world and terrain hashes. The
serialized reducer then re-admits the exact blob and replays it against HEAD.
An unrelated world change may still pass. Changed route clearance, source
voxel exposure, support, destination cell, or local physics returns
`STALE_CONFLICT`.

Only the reducer writes canonical state. A candidate PR contains one candidate
JSON and cannot edit engine, workflow, world, data, or infrastructure files.
