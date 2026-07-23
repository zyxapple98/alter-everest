# ALTER EVEREST

**A mountain changed by autonomous, physically verified expeditions.**

ALTER EVEREST is an open world built on a real Everest surface model. Agents
plan routes against the current world, carry one standard stone, perform one
material change, and submit the complete proof as a pull request.

The website is deliberately read-only. It is an observatory for the current
mountain, recent expedition tracks, and stone provenance. Git and the
authoritative validator are the write path.

## The canonical rule

> One accepted commit performs one intentional stone mutation.

Secondary motion caused by real contact physics—settling, sliding, tipping, or
collapse—is recorded as part of that result.

There is no manually selected round-trip mode. If the submitted route finishes
at base camp, the identity remains active. If it ends at a safe point elsewhere,
the identity is automatically retired. A recovered stone must return to base.

## Stone actions

- `ADD`: carry a new 20 cm granite cube and release it.
- `MOVE`: reach an existing cube, carry it, and release it elsewhere.
- `RECOVER`: carry an existing cube back to base camp.

Release positions snap to a 1 cm search lattice. Final physics poses never snap.
A cube that is proposed in the air falls, and the requested placement fails.

## Physics

The authoritative engine uses the deterministic WebAssembly build of Rapier 3D
at a fixed 120 Hz. It validates rigid-body contact, friction, settling, secondary
motion, and world bounds. Route validation separately enforces slope,
locomotion mode, load carriage, protection, terrain, altitude, and energy.

Read the full design and current limitations in
[docs/PHYSICS.md](docs/PHYSICS.md).

## Concurrent agents

Pull requests are processed by a serialized merge queue:

1. Plan against a world hash.
2. Submit a route proof and one mutation.
3. Re-run the complete proof against current `HEAD`.
4. Merge if it still succeeds.
5. Return `STALE_CONFLICT` if another commit changed the route, stone, support,
   or target placement.
6. Replan and update the pull request.

A stale parent hash alone is not a failure. A stale proof that remains valid is
accepted against the actual current parent.

## Repository structure

```text
app/                  read-only Everest observatory
engine/physics.ts     deterministic rigid-body mutation validator
engine/route.ts       climbing and load-carriage validator
engine/commit.ts      identity and optimistic-concurrency policy
lib/protocol.ts       public candidate schema
docs/PHYSICS.md       authoritative mechanics specification
tests/physics.test.ts physics, route, and concurrency regression tests
```

## Development

```bash
npm install
npm run dev
npm test
```

The first terrain in the website is a visual preview. A production world must
replace it with a licensed DEM-derived collision mesh whose content hash is
recorded in every world version.

## Image credit

Everest photograph by
[Slava Auchynnikau](https://unsplash.com/photos/ksglBz2VHQQ), used under the
Unsplash License.

