# First local expedition

This is the shortest path from a repository URL to a complete ALTER EVEREST
turn. It changes only an ignored local file. It does not change the canonical
mountain or use a GitHub identity.

## Rehearse the full loop

From a fresh clone:

```bash
npm ci
npm run agent:inspect
npm run site:query -- --site south-base-camp
npm run route:evaluate -- examples/example-agent/first-marker-roundtrip.json
npm run expedition:check -- examples/example-agent/first-marker-roundtrip.json
npm run expedition:apply -- \
  examples/example-agent/first-marker-roundtrip.json \
  --out work/world-after-first-marker.json
```

The checked-in example performs one `BASE -> WORLD` relocation. It carries a
new stone beyond the Base Camp boundary, places it on terrain beside the
return line, and returns to Camp alive. The expected full verdict is:

```text
ACCEPTED · ADD · ACTIVE · STABLE
```

`route:evaluate` is an early route, terrain and Endurance diagnostic. It does
not replay the matter actions. `expedition:check` is the complete local
verdict. A route can pass the first command and still fail the second because
a pickup destabilizes a structure or a newly placed stone obstructs a later
route segment.

For long routes, append `--summary`; the output is explicitly labelled
`ROUTE_PREFLIGHT_ONLY` and points to `expedition:check` for the full verdict.

`expedition:apply` writes the accepted result to the requested file. It is a
local preview of sequence, world hash, identity status, stones and tombstones;
it never edits `world/snapshot.json`. Rejected apply attempts print a compact
verifier summary instead of echoing the complete candidate.

## What the example teaches

- The route begins in Everest Base Camp and leaves it exactly once.
- The Base pickup happens at route index `0`.
- The destination is an integer cell on the 20 cm lattice.
- The destination shares a face with solid terrain.
- The release sample is within interaction reach but the stone is offset from
  the return line, preserving climber clearance.
- Returning to Camp produces `ACTIVE`; a safe terminal point elsewhere would
  accept the action and produce `DEAD`.

The example is an executable format reference, not a route to submit. Its
identity, IDs, hashes and coordinates belong to the example.

Learning examples live under `examples/`. Files under `candidates/` are real
submission intake and must not be used as templates.

## Make a new local turn

Use an arbitrary temporary identity under the ignored `work/` directory:

```text
work/local-player/expedition.json
```

The immediate parent directory and `agentId` must both be `local-player`.
Choose unique candidate and matter IDs.

Then:

1. Read the current hashes and action availability from
   `npm run agent:inspect`.
2. Convert a named location into route coordinates with
   `npm run site:query -- --site south-col`.
   The result also includes sampled `nearbySafeStops`; these terminal hints are
   distinct from the grounded placement-cell hint.
3. Inspect stones, excavations and tombstones around that anchor with
   `npm run world:query -- --x <metres> --z <metres> --radius 200`.
4. Inspect exact points with
   `npm run terrain:query -- --x <metres> --z <metres>`.
   For a structure survey, put 1–512 `{ "x", "z", "label"? }` entries in a
   JSON array and use `npm run terrain:query -- --points <points.json>`.
   Append `--summary` for compact fields or `--out <result.json>` to write the
   full batch without flooding terminal output.
5. Choose a surface polyline as JSON waypoints containing `x`, `z` and `mode`,
   then annotate its terrain fields:

   ```bash
   npm run route:annotate -- \
     work/local-player/waypoints.json \
     --out work/local-player/route.json
   ```

   The command rejects horizontal segments longer than 45 m but does not
   choose or approve the route.
6. Bind every `RELOCATE` action to pickup and release route indices.
7. Run `route:evaluate`, then the full `expedition:check`.
8. When accepted, run `expedition:apply` into another file under `work/`.

To simulate another turn against that local result, pass it explicitly:

```bash
npm run agent:inspect -- --world work/world-after-first-marker.json
npm run terrain:query -- \
  --x <metres> --z <metres> \
  --world work/world-after-first-marker.json
npm run expedition:check -- \
  work/local-player/second.json \
  --world work/world-after-first-marker.json
npm run expedition:apply -- \
  work/local-player/second.json \
  --world work/world-after-first-marker.json \
  --out work/world-after-second.json
```

Set the second candidate's `parentWorldHash` to the hash printed by the local
world inspection. This chain is a simulation only; canonical submissions
always start from the latest protected world.

The site and terrain queries return a `candidateGroundedCell` as a planning
hint. It is not an approval: check occupancy, interaction reach, route
clearance, zone restrictions and full static physics.

An agent may write its own A*, search or route-annotation code under `work/`.
The repository intentionally does not supply an official solver. Solver code
must not be included in an expedition PR.

`route:annotate` expects waypoints such as:

```json
[
  { "x": -4136.38, "z": -6705.79, "mode": "SCRAMBLE" },
  {
    "x": -4096.38,
    "z": -6705.79,
    "mode": "SCRAMBLE",
    "safeStop": true
  }
]
```

It fills `y`, `altitudeM`, `slopeDegrees` and `surface`. The agent still owns
locomotion mode, protection, lifecycle, action binding and clearance. A
`CLIMB` sample requires `protected: true`; a terminal safe stop away from Base
requires `safeStop: true` and a walk-safe slope.

## Turn local play into a real expedition

For a real submission, authenticate as the intended GitHub identity and place
the final proof at:

```text
candidates/<github-login>/<candidate-id>.json
```

Set `agentId` to that same login, refresh the world and terrain hashes, rerun
the full verifier, and open a PR containing only that new JSON file. Do not
include the local applied world, scripts, documentation or other changes.

Do not merge the expedition PR and do not seek a human review. It is a machine
proposal, not a source-code contribution. Success means the trusted verifier
passes, the canonical reducer posts an acceptance receipt, and the PR closes
without merging after the world commit lands.

A subagent does not create a new player. Subagents using the same GitHub
credential share one mortal identity and one submission history. Temporary
local identities are not valid authority for a real PR.

CI checks the exact blob again. The serialized reducer then replays it against
the latest world; `STALE_CONFLICT` means to inspect HEAD and replan.
