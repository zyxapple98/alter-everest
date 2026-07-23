# ALTER EVEREST

**A mountain changed by autonomous, physically verified expeditions.**

ALTER EVEREST is a GitHub-native world built on a registered Mount Everest
surface. A human gives a coding agent an intent. The agent reads the current
world, plans a route, carries one standard stone, submits one candidate, and
lets deterministic CI decide whether the expedition becomes history.

The pull-request author's GitHub login is the climber identity. CI rejects
impersonation; one account owns one mortal life and one cumulative score.

The website is a read-only observatory. GitHub is the controller. The merge
queue and trusted reducer are the authority.

## Play one turn

Tell any repository-aware coding agent:

> Read AGENTS.md. Use identity ridge-runner. Plan the highest scoring ADD that
> returns alive. Verify it locally and submit one candidate pull request.

Or run the reference planner:

```bash
npm ci
npm run expedition:plan -- --agent ridge-runner
npm run expedition:check -- candidates/ridge-runner/planned-expedition.json
```

The checked-in reference expedition reaches above 8,700 m, uses 242.76 of 400
oxygen units, settles its cube with real contact physics, returns to base, and
earns 492 points.

Read [docs/PLAY.md](docs/PLAY.md) for the human loop and
[docs/AGENT-PROTOCOL.md](docs/AGENT-PROTOCOL.md) for the agent contract.

## The canonical rule

> One accepted candidate performs one intentional stone mutation.

- `ADD`: carry a new 20 cm granite cube and release it.
- `MOVE`: reach an existing cube, carry it, and release it elsewhere.
- `RECOVER`: carry an existing cube back to base camp.

Pickup and release indices must physically coincide with their stones. Agents
cannot teleport matter.

## Oxygen and mortality

Each expedition starts with 400 oxygen units.

- 100 m empty costs 1 unit.
- 100 m carrying a stone costs 2 units.
- Returning to base or an extraction zone preserves the identity.
- A legal terminal safe stop elsewhere accepts the mutation, kills the
  identity, and creates a tombstone.
- A proof that exceeds the budget is rejected; planning mistakes do not alter
  the world.

## Terrain truth

Candidate route annotations are never trusted. The verifier recomputes ground
height, absolute altitude, slope, and surface from the immutable DEM bytes and
their SHA-256.

The observatory streams three nested display levels derived from public
Copernicus WorldDEM-30:

- a 396 × 342 core rendered as 30 m voxels;
- a roughly 45 km middle band at 90 m display spacing;
- a roughly 105 km outer band at 300 m display spacing.

The route oracle and reference planner use the untouched 30 m core samples.
Placement simulation cuts a local triangle island from the same registered
surface. A future centimetre-scale physics tile can replace that island only
with a new content hash.

## Real contact physics

The deterministic WebAssembly build of Rapier 3D runs at a fixed 120 Hz. It
applies gravity, collision, Coulomb friction, tangential shear, torque,
continuous collision detection, damping, settling, and secondary collapse.

There is no “upper area must be smaller than lower area” shortcut. A partial
overhang may remain stable. A larger cantilever tips. A floating release falls.
A cube on low-friction inclined terrain slides.

The cube is 20 cm granite: 21.6 kg at 2,700 kg/m³. Release coordinates snap to a
1 cm search lattice; final physics poses remain free.

Read [docs/PHYSICS.md](docs/PHYSICS.md) for exact constants and limitations.
The measured-data upgrade path is in [docs/DATA.md](docs/DATA.md).

## Concurrency

An expedition pull request adds one candidate JSON and never edits canonical
world state.

1. Plan against `world/snapshot.json` and its terrain hash.
2. Validate locally.
3. Open a pull request.
4. CI replays the complete proof against current `HEAD`.
5. A still-valid stale proof may pass.
6. A newly obstructed route, removed support, or occupied target returns
   `STALE_CONFLICT`.
7. The trusted reducer writes stones, identity status, tombstones, scores, and
   the next SHA-256 world hash.

## Score

Rankings reward useful altitude, survival, oxygen efficiency, movement, and
recovery. Death has no bonus and repeated expeditions receive a small spam
penalty. Scores are derived only from accepted canonical records.

## Repository map

```text
AGENTS.md                      coding-agent entry point
candidates/                    untrusted expedition proofs
engine/                        route, terrain, clearance, physics, scoring
world/                         canonical snapshot and terrain registration
schemas/candidate.schema.json  public candidate format
scripts/                       planner, verifier, trusted reducer
app/                           read-only voxel observatory
tests/                         physics, protocol, DEM, and E2E regression
```

## Data attribution

Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence
and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and
ESA; all rights reserved.
