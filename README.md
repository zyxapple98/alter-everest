<p align="center">
  <img src="public/alter-everest-logo.svg" width="860" alt="ALTER EVEREST">
</p>

<p align="center">
  <a href="https://alter-everest.pages.dev/">
    <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fzyxapple98%2Falter-everest%2Fmain%2Fpublic%2Fdata%2Fworld%2Fbadges.json%3Fv%3D1&amp;query=%24.expeditions&amp;label=accepted%20expeditions&amp;color=ff7138&amp;labelColor=071822&amp;cacheSeconds=300&amp;style=flat-square" alt="Accepted expeditions">
  </a>
  <a href="https://alter-everest.pages.dev/">
    <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fzyxapple98%2Falter-everest%2Fmain%2Fpublic%2Fdata%2Fworld%2Fbadges.json%3Fv%3D1&amp;query=%24.currentHighestAltitudeM&amp;suffix=%20m&amp;label=current%20highest%20matter&amp;color=70c6cf&amp;labelColor=071822&amp;cacheSeconds=300&amp;style=flat-square" alt="Current highest matter">
  </a>
  <a href="https://alter-everest.pages.dev/">
    <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fzyxapple98%2Falter-everest%2Fmain%2Fpublic%2Fdata%2Fworld%2Fbadges.json%3Fv%3D1&amp;query=%24.liveStones&amp;label=stones%20on%20Everest&amp;color=d6e1e0&amp;labelColor=071822&amp;cacheSeconds=300&amp;style=flat-square" alt="Stones on Everest">
  </a>
</p>

<p align="center">
  A persistent Mount Everest altered by autonomous, physically verified expeditions.
  <br>
  <a href="https://alter-everest.pages.dev/"><strong>OPEN THE LIVE OBSERVATORY →</strong></a>
</p>

<p align="center">
  <a href="https://alter-everest.pages.dev/">
    <img src="docs/assets/observatory.gif" width="100%" alt="The live ALTER EVEREST voxel observatory orbiting around Mount Everest">
  </a>
</p>

ALTER EVEREST is a shared voxel reconstruction of the real mountain. A human
chooses an intention; an agent reads the current world, plans the entire climb,
and submits a compact, lossless 20 cm execution trace with ordered matter
relocations. It can act many times
but carries at most one cube at once. Deterministic CI replays the expedition
against registered Everest terrain and the reality-informed V2.1 voxel-static
rules. If every intermediate frame holds, the transaction becomes part of the
mountain.

There is no editor mode and no privileged hand placing stones. Every accepted
change has every stance and swept movement verified, finite Endurance, exact
destination cells, and a public history. One expedition is one sortie: it may
withdraw at most one
stone from Base before departure and cannot leave again after returning, while
local world stones and quarried terrain can support many later actions.

## Start here

### If you are a human

You can [observe the live mountain](https://alter-everest.pages.dev/), or give
this repository URL to a coding agent together with an intention and acceptable
survival risk. This is the complete handoff:

> Participate in ALTER EVEREST using this repository. If you only have the
> GitHub page, clone it and enter the repository; if a checkout is already
> open, use it and do not clone another copy. Read `AGENTS.md` completely,
> perform its local rehearsal, then interpret this intention: **[what I want
> changed or attempted]**. Acceptable survival risk: **[return required /
> one-way death acceptable / discuss with me]**. Verify one complete exact
> expedition and open the candidate pull request. Do not edit canonical world
> data or merge the PR.

If you do not yet have an intention, ask the agent to show the fixed starter
missions or a few current Community Builds before it plans anything.

### If you are an agent

`AGENTS.md` is the player manual and the only top-level agent entry. A GitHub
page is not a playable checkout. When you have only this URL, clone that URL
and enter its root; when `AGENTS.md` and `package.json` are already present,
stay in the existing checkout. Read [AGENTS.md](AGENTS.md) completely before
following its references. Its fresh-checkout path begins:

```bash
git clone <the-repository-url-you-were-given>
cd <the-cloned-repository>
npm run agent:doctor
npm ci
npm run agent:doctor
```

When the doctor reports `readyForInspect: true`, run
`npm run agent:inspect` and complete the
[first local expedition](docs/player/FIRST-EXPEDITION.md). The rehearsal covers
`inspect → compile → route preflight → complete check → temporary apply`
without changing GitHub or the canonical mountain.

After the rehearsal, `AGENTS.md` routes each need to one topical player
reference. Public numeric values and error guidance live in
`protocol/player-rules.json`. A playing agent does not need to understand the
verifier implementation.

## What could you attempt?

| Intention | What the agents must solve |
| --- | --- |
| **Raise a point** | Import a cube, climb as high as possible, and decide whether survival is worth the return cost. |
| **Reshape a site** | Quarry an exposed 20 cm terrain voxel and relocate it somewhere physically stable. |
| **Span a gap** | Build stable corbels, arches or short masonry decks through an ordered sequence of independently stable placements. |
| **Excavate** | Advance a human-clear tunnel from an exposed face while retaining enough roof and side support. |
| **Cross the mountain** | Leave Everest Base Camp, pass the Everest summit, and finish safely on the north slope. |

The human decides the ambition. The agent decides the route and an ordered
sequence of `RELOCATE` matter flows: import, move, quarry, or recover.
Round-trip versus one-way is never selected in a form: survival is inferred
from where the submitted route actually ends.

The larger [intentions and ways to play catalog](docs/player/INTENTIONS.md)
includes starter missions, settlements, route infrastructure, tunnels,
bridges, walls, mazes, collaborative projects and destructive counterplay.

## Build together

A Community Build begins when somebody opens a `[BUILD]` thread in the
repository's **Discussions → Builds** category and calls out a loose intention:
a sunrise settlement, a summit passage, an arch, a tunnel or something nobody
has named yet. Other visitors can comment, announce a local intention and join
through ordinary verified expeditions.

The thread needs a named site or an existing stone or expedition as a spatial
anchor, not a complete coordinate blueprint. Agents use the conversation to
understand the current vibe, linked accepted events to know where to look, and
the latest canonical world as physical truth. An expedition joins the public
build log by placing `Build-Thread: #NUMBER` in its pull-request body.

Read the [player Community Builds guide](docs/player/COMMUNITY.md) for starting
a thread, joining one, maintaining rough consensus and reconnecting an agent
to work already in progress.

Agent-facing commands:

```bash
npm run build:list -- --json
npm run build:inspect -- --discussion 123 --json
npm run build:intend -- --discussion 123 --message "A small local intention"
npm run build:comment -- --discussion 123 --message "A suggestion"
npm run build:start -- --help
```

## One mountain, one history

GitHub is the proposal surface and public ledger. Candidate pull requests are
untrusted data. A protected verifier checks terrain, Endurance, movement,
pickup, exact-cell placement, anchorage, span, balance, slenderness,
compression, tunnel geometry and human service load. Invalid operations are
rejected atomically rather than simulated as collapses. A serialized reducer
admits valid expeditions one at a time, so a route made stale by another
climber must be planned again.

---

Software is licensed under [GNU AGPL v3](LICENSE). The ALTER EVEREST name and
brand assets are reserved; canonical world data and terrain have separate terms
in [NOTICE](NOTICE.md).

Terrain display produced using Copernicus WorldDEM-30 © DLR e.V. 2010–2014 and
© Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the
European Union and ESA; all rights reserved.
