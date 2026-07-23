# Agent expedition protocol

Protocol version: `0.3.0`

## Human command surface

A human gives a coding agent one short intent:

> Read AGENTS.md. Plan one ADD expedition for `agent-id`, prioritize score, and
> return alive. Verify it locally and open a pull request.

The optional choices are:

- action: `ADD`, `MOVE`, or `RECOVER`;
- strategy: maximum score, maximum altitude, stewardship, or one-way;
- target stone for `MOVE` or `RECOVER`.

The identity is not a free-form choice in a pull request: it must equal the
pull-request author's GitHub login. One account is one mortal climber identity.
This does not eliminate Sybil accounts, but it makes ownership objective and
prevents one contributor from killing another identity.

The agent reads canonical state and terrain, plans, runs the verifier, and
returns a candidate JSON plus a compact receipt. The human does not draw a path
or manipulate coordinates.

## Oxygen

Every expedition begins with 400 oxygen units.

- each 100 m travelled without a stone costs 1 unit;
- each 100 m travelled while carrying a stone costs 2 units;
- oxygen is integrated by distance, so changing route sample density cannot
  change the bill;
- a proof that exceeds 400 units is rejected before execution.

Returning to base camp or reaching a registered extraction zone preserves the
identity. A legal route that ends at another safe location is a one-way
expedition: the mutation is accepted, the identity becomes `DEAD`, and the
terminal position becomes a tombstone.

## Terrain truth

Route coordinates are local metres registered to the immutable DEM hash. CI
recomputes ground height, absolute altitude, slope, and surface classification
from the checked-in elevation bytes. Candidate annotations are claims, not
authority. A mismatch is `TERRAIN_MISMATCH`; leaving the registered terrain is
`OUTSIDE_TERRAIN`.

The current global route surface is Copernicus GLO-30. Placement physics uses a
local triangle island cut from that same registered surface. A future
centimetre-scale tile can replace that island without changing the protocol,
but it must have its own content hash.

## Route and action binding

Horizontal route samples may be at most 45 m apart. Every segment is checked
for locomotion grade, protection, oxygen, energy, and swept capsule clearance.

The route point at `pickupIndex` must be within 1.25 m of the canonical stone.
The route point at `releaseIndex` must be within 1.25 m of the requested release
pose. This prevents remote pickup or placement.

## Stone physics

The stone is a 20 cm, 21.6 kg granite cube. The release position snaps to a
1 cm search lattice; the final pose does not snap.

The deterministic Rapier simulation applies:

- standard gravity;
- rigid-body contact and collision;
- Coulomb friction and tangential shear;
- torque and tipping from off-centre support;
- restitution, damping, and secondary collapse;
- continuous collision detection;
- a fixed 120 Hz time step.

There is no support-area shortcut. A partial overhang can survive when its
centre of mass and frictional contacts are stable. A larger overhang tips. A
floating release falls. A low-friction slope produces sliding shear. The model
does not yet simulate granite fracture, snow failure, weather, rope knots,
hands, feet, hypoxia, or mortality beyond the deterministic route budget.
Protected-climb flags and surface classes remain declared game rules rather
than simulated anchors or live snow observations.

## Concurrency

Candidates name a parent world hash and terrain hash. The merge queue never
accepts a proof merely because it passed on the author's branch. It replays the
complete candidate against current `HEAD`.

- still valid: accepted and attributed to the actual parent;
- obstructed or unsupported after another merge: `STALE_CONFLICT`;
- malformed or physically invalid: rejected without changing the world.

Agents submit candidates, not database edits. After acceptance, the trusted
reducer writes stones, identity status, tombstones, expedition record, score,
and the next SHA-256 world hash.

Repository branch protection must require the expedition workflow and disallow
direct pushes to canonical state. The workflow checks that an expedition PR
adds exactly one safe-path candidate file and no engine, data, workflow, or
world-state edits.

## Score

Score rewards the mountain's purpose rather than pull-request volume:

- 1 point per 10 m of useful altitude gain;
- 120 points for returning alive;
- up to 60 points for unused oxygen;
- 35 stewardship points for a useful move;
- 90 stewardship points for recovery;
- a small repeat-expedition penalty discourages spam.

Death has no bonus. Rankings aggregate accepted expedition records only.
