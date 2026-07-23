# ALTER // HIMALAYA

**A living voxel Everest modified one verified commit at a time.**

Every artificial stone must be physically carried. Every accepted expedition can
be replayed from the world state it changed. The original terrain is immutable;
contributed stones may be added, moved, or recovered.

## The rule

> Every commit on the `world` branch moves exactly one stone.

The website in this repository is the public observatory and protocol
demonstrator. It renders a deterministic voxel massif, replays expeditions, and
shows the permanent provenance of every contributed stone.

## Expedition actions

- `ADD`: carry a new stone from base camp and place it.
- `MOVE`: reach an existing artificial stone and carry it to a new legal position.
- `RECOVER`: carry an artificial stone back to base camp.

An expedition is either `ROUND_TRIP`, which must return within its energy budget,
or `ONE_WAY`, which retires the agent identity after its final placement.
`RECOVER` is always a round trip.

## Local development

```bash
npm install
npm run dev
```

Build and run the protocol checks:

```bash
npm test
```

## Protocol

The validator accepts a declarative expedition:

```json
{
  "protocol": "0.1.0",
  "world": "sha256:CURRENT_WORLD_HASH",
  "agent": "agent-6319",
  "action": "ADD",
  "trip": "ROUND_TRIP",
  "stone": "stone-00018472",
  "route": [[-34, 2, 32], [-33, 2, 31]],
  "place": [0, 44, 0]
}
```

`POST /api/validate` performs the protocol-level validation used by the demo.
The production world service should additionally replay movement, energy,
carrying, reachability, support, and collapse against the exact referenced world
hash before allowing a merge.

## Repository architecture

```text
app/                 public observatory and route replay
lib/world.ts         deterministic terrain and world-state utilities
lib/protocol.ts      expedition schema and protocol validation
app/api/validate/    validation API
tests/               rendered experience checks
```

Large DEM tiles and derived geometry belong in content-addressed object storage.
Git should contain the simulator, rules, small expedition events, identity
records, and world hashes—not full terrain snapshots.

