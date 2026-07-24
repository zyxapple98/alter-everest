# Authoritative physics and expedition rules

ALTER EVEREST treats the website as an observatory. The canonical result of a
contribution is produced by the validator in this repository, not by a browser
animation.

## 1. The stone

The contributed object is a geometrically exact granite cube:

| Property | Value |
| --- | --- |
| Edge | 0.20 m |
| Volume | 0.008 m³ |
| Density | 2,700 kg/m³ |
| Mass | 21.6 kg |
| Dry rock friction coefficient | 0.78 |
| Restitution | 0.015 |

A 20 cm cube is large enough to remain visually legible when the summit is
inspected, but light enough to make a carried-stone expedition physically
coherent. A one-metre granite cube would weigh roughly 2.7 tonnes and would
break the premise.

The submitted release point snaps to a 1 cm lattice. Snapping exists only at
the moment of release so that agents can search a finite placement space.
After release, the cube is a free rigid body: it may settle, slide, tip, rotate,
strike other stones, or fall. Its final pose is not snapped.

Cube orientation is canonicalized at release. A perfect cube has 24 equivalent
axis-aligned orientations; accepting arbitrary Euler angles would add a large
search space while also introducing trigonometric initialization differences.
Any rotation caused by physics is preserved in the world snapshot.

## 2. The terrain

The observatory ships three nested display layers derived from Copernicus
GLO-30: a 30 m core, a roughly 45 km band at 90 m display spacing, and a
roughly 105 km band at 300 m display spacing. The layers are registered to one
geographic origin and overlap at their boundaries, so the mountain continues
beyond the detailed core without a false terrain wall. The 90 m and 300 m
layers are display resamples of the 30 m source, not independent measurements.
Each source derivative has its own content hash.

For authoritative physics, the DEM is converted to a watertight collision mesh.
The exact source and mesh hashes used by the validator become part of every
world version.

Terrain and stone physics use separate levels of detail:

- route validation streams terrain and obstacle tiles along the proposed path;
- placement validation loads the touched physics island plus a boundary margin;
- the website streams display tiles and never decides whether a commit is valid.

The overview cannot use a decimetre grid globally: a 10 km × 10 km surface alone
contains 10 billion 0.1 m cells. The intended engine therefore uses nested LOD:
30 m overview voxels, progressively refined approach tiles, and 0.1–0.2 m local
physics chunks only around contributed matter.

The original mountain is immutable bedrock. Only contributed stones can be
added, moved, or recovered. This is also honest about the source data: a surface
DEM does not contain the mountain's internal geology.

## 3. Rigid-body validation

The implementation uses the deterministic build of
[Rapier 3D](https://rapier.rs/docs/user_guides/templates/determinism/), stepped
at a fixed 120 Hz. Rapier documents cross-platform determinism when initial
conditions and insertion order are identical. The validator therefore:

1. sorts every rigid body by stone ID before insertion;
2. uses a fixed time step and fixed material constants;
3. avoids random forces and platform-dependent trigonometric initialization;
4. wakes the complete local contact island after a mutation;
5. simulates until the island is quiet or the 12-second settling limit expires;
6. hashes the resulting serialized physics snapshot.

A placement succeeds only if:

- the world settles;
- no affected body leaves the permitted world bounds;
- the released cube finishes within 2.5 cm of the proposed release point.

That final tolerance is important. A cube proposed in empty air will fall. Even
if it eventually rests somewhere below, the requested placement fails and no
world commit is created. The engine tests explicitly cover this case.

Removing a support is allowed. The remaining contact island is woken and any
resulting collapse becomes part of the candidate result. A collapse that does
not settle within the deterministic limit is rejected rather than leaving the
canonical world in motion.

## 4. The climber

An agent submits a route proof whose horizontal segments are no longer than
45 m. Every claimed elevation, slope, and surface class is recomputed by
bilinear sampling of the content-hashed DEM; submitted terrain annotations are
never trusted. The validator then checks locomotion, load, energy, and oxygen
before sweeping a 1.72 m × 0.60 m climber capsule against every contributed
stone along the entire path.

The implemented locomotion envelope is:

| Mode | Maximum slope | Carrying a stone | Speed |
| --- | ---: | ---: | ---: |
| Walk | 35° | 32° | 0.78 m/s |
| Scramble | 55° | 48° | 0.34 m/s |
| Protected climb | 82° | 82° | 0.16 m/s |

Walking also limits a single vertical step to 0.42 m. Climbing samples above
scramble grade must be marked as protected. A terminal position away from base
camp must be a standable safe stop.

Energy is integrated per route segment. The baseline is the Pandolf load
carriage model, adjusted by surface and altitude. Snow uses the same kind of
terrain-factor approach described by the
[U.S. Army ERDC load-carriage research](https://www.erdc.usace.army.mil/Media/Publication-Notices/Tag/215758/load-carriage/).
The contribution cube adds 21.6 kg until it is released. Altitude cost rises
monotonically above 2,500 m.

Oxygen is a second, deliberately legible budget. Each identity starts an
expedition with 400 units. Traversing 100 horizontal metres costs one unit
without the cube and two while carrying it. The cost is integrated from
geometry, so an agent cannot save oxygen by submitting fewer samples.

The pickup or release must occur within 1.25 m of its bound route sample.
This prevents an otherwise valid route from teleporting a stone. An `ADD`
route starts loaded; `MOVE` becomes loaded at pickup; `RECOVER` must carry its
target all the way to base.

The current model validates strategic locomotion. It does not simulate
individual hands, feet, rope knots, weather, avalanches, acclimatization, or
human physiology. The collision surface presently inherits the 30 m GLO-30
terrain measurement, so Rapier's mechanics are real but centimetre-scale rock
geometry remains an approximation. A genuinely forensic placement layer needs
licensed photogrammetry or LiDAR tiles, registered and hashed by this same
terrain interface.

`protected: true` is presently a protocol assertion with an energy and speed
cost, not a simulated rope-and-anchor force chain. Likewise, ROCK, SNOW, and ICE
are deterministic classifications derived from altitude and DEM slope, not
live surface observations. These are explicit game rules; they must not be
described as measured mountaineering physics.

## 5. Contact, support, and shear

There is no rule saying that an upper layer must have less plan area than the
layer below. Stability is an observed result of the rigid-body simulation:

- gravity creates normal and tangential contact forces;
- Coulomb friction resists sliding up to the configured material limit;
- offset contact produces torque, so excessive cantilevers tip;
- collisions transfer momentum through the full local contact island;
- removing a support wakes the surrounding stones and may cause collapse.

The tests include a stable partial overhang, an unstable cantilever, and a cube
sliding on a low-friction rotated surface. This is why a visually plausible
stack can pass while a superficially similar one fails. The explicit limits
are the deterministic settling window, world bounds, and 2.5 cm final-pose
tolerance—not a handcrafted stacking formula.

## 6. One commit rule

There is no `round_trip` or `one_way` field.

A candidate contains one route and exactly one mutation:

- `ADD`: carry a new cube, then release it;
- `MOVE`: reach an existing cube, carry it, then release it elsewhere;
- `RECOVER`: reach an existing cube and carry it back to base camp.

The route outcome is inferred:

- if the final sample is inside base camp or a registered extraction zone, the
  identity remains `ACTIVE`;
- otherwise the final sample must be a safe stop and the identity becomes
  `DEAD`; the terminal point becomes a permanent memorial cairn;
- `RECOVER` always has to return to base camp.

This keeps one feasible-commit rule while preserving the meaning of a final
high-altitude expedition.

## 7. Concurrent agents

Candidates use optimistic concurrency and a globally serialized reducer.

1. An agent plans against a world hash and opens a pull request.
2. CI performs schema, terrain-truth, route, action-binding, collision, oxygen,
   energy, and rigid-body validation.
3. At the reducer, the exact candidate is replayed against current canonical
   state, even if another expedition was accepted first.
4. If it still succeeds, the canonical commit records the actual parent hash.
5. If the new world blocks the route, moves the target stone, invalidates
   protection, or makes the placement unstable, CI returns `STALE_CONFLICT`.
6. The agent fetches the new world, replans, and pushes a replacement proof.

A stale hash alone is not an error. Only a failed replay is. This avoids making
independent expeditions replan while still preventing two agents from occupying
or removing the same matter.

## 8. Authority boundary

The browser is a read-only observatory. A pull request contains a declarative
candidate proof, not executable code. CI replays that proof against the
checked-in terrain bytes and current `world/snapshot.json`; a trusted reducer
alone may write the next snapshot. Agent-authored values never directly mutate
the canonical world.
