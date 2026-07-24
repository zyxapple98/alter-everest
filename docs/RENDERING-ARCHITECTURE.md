# Rendering Architecture

## Decision

ALTER EVEREST uses two connected render spaces:

1. **Mountain Observatory** presents the whole expedition world in a compressed
   coordinate system.
2. **Local Inspection** presents one streamed neighborhood in real metric scale,
   where one Three.js unit equals one meter.

The camera may feel continuous, but the implementation is not an infinitely
deep version of the overview mesh. It crosses into Local Inspection when the
overview can no longer represent the requested detail. The finest meaningful
world detail is the protocol's canonical 20 cm cell; the product does not
invent sub-voxel geometry.

This split is required by scale. The current core overview maps a roughly 30 m
DEM sample to 0.235 scene units. A canonical 20 cm stone would therefore be
about 0.00157 scene units wide. It would be too small to read, vulnerable to
depth precision artifacts, and wasteful to render across the mountain.

## Visual Language

### Mountain material stack

Terrain appearance is composed in four independent layers:

1. **Intrinsic matter**: dark slate and weathered gray rock, blue-gray ice,
   subdued off-white snow, placed granite, or a fresh quarry face.
2. **Cryosphere mask**: altitude creates the possibility of snow, while slope,
   concavity, and broad wind exposure decide whether snow stays.
3. **Environment grade**: Kathmandu time changes sky, fog, light color, and
   exposure without replacing matter colors.
4. **Semantic signal**: sites, actions, routes, Endurance, and selected
   structures use a small emissive signal palette independent of terrain.

The mountain must not become a white altitude gradient. Exposed steep faces
retain dark, folded strata; snow collects on gentler shelves and in gullies;
ice remains colder and darker than snow; directional light creates the major
readable planes. Per-cell color noise stays below the level that would make the
surface look mottled.

### Structures

Player-built structures retain authored material identity through every sky
phase. Time of day may change illumination, fog, and reflected sky color, but
must not remap a villa's stone into the mountain's procedural rock palette.

At distance, a structure is represented by its occupied volume and silhouette,
not by thousands of individual cubes. Individual stones appear only when they
have enough projected size to be legible or are selected for interaction.

## Detail Ladder

Distances are starting bands, not hard truth. Runtime selection uses projected
screen-space error with hysteresis, so a level does not flicker when the camera
hovers around a boundary.

| View | Typical camera distance | Representation | Source/detail |
| --- | ---: | --- | --- |
| Mountain silhouette | more than 8 km | far terrain mesh | 300 m source / 900 m initial render |
| Massif | 2–8 km | mid terrain mesh | 90 m source / 270 m initial render |
| Expedition route | 300 m–2 km | core terrain mesh | 30 m source / 60 m initial render |
| Local entry | 60–300 m | streamed surface proxy | 2 m visual derivative |
| Structure | 12–80 m | occupancy/silhouette mesh plus important stones | 0.8 m proxy |
| Inspect | 3–25 m | canonical modifications and stones | full 20 cm cells |

The 2 m and 0.8 m levels are visual derivatives, never claims of measured
terrain accuracy. Canonical terrain height and matter remain governed by the
public DEM and deterministic surface rules.

The initial overview render deliberately samples more coarsely than the stored
source LODs. A screen cannot resolve every 30 m cell while showing the whole
massif, and drawing those cells would compete with interaction and replay. The
source remains available for later screen-space-error refinement and local
transition work.

At a 43 degree vertical field of view and 1080 px viewport height, a 20 cm
stone projects to roughly 27 px at 10 m and 11 px at 25 m. Full stone geometry
therefore has clear visual value inside the inspection band and very little
value outside it.

## Transition Between Spaces

1. The overview camera approaches a site, route point, tombstone cluster, or
   structure.
2. When the camera footprint is approximately 180 m across, the client requests
   the target tile manifest and nearby chunk payloads.
3. A worker builds the local proxy around the target while the overview remains
   visible.
4. Between approximately 120 m and 60 m, the two representations cross-fade
   using the same geographic anchor and camera heading.
5. Local Inspection rebases the origin to the selected 32 m chunk and switches
   to metric coordinates.
6. Pulling back reverses the transition after a wider hysteresis threshold.

The local camera uses a near plane around 0.02 m and a normal orbit floor around
3 m. A first-person or build-inspection camera can get closer, but rendering
does not subdivide a 20 cm cell.

## Streaming and Mesh Construction

The existing authority hierarchy maps directly to rendering:

```text
256 m streaming tile
  -> 8 × 8 physics chunks
    -> 32 m chunk
      -> 160 × 160 horizontal 20 cm columns
```

The client initially loads a 3 × 3 chunk neighborhood around the local camera.
A wider, lower-detail ring supplies context. Chunks are addressed by immutable
hash and cached locally; the latest world manifest only selects hashes and
contains bounds and summary metadata.

Mesh construction runs in a Web Worker:

- natural terrain becomes a surface or greedily merged proxy, with hidden
  internal faces omitted;
- identical visible stones are grouped by material in `InstancedMesh`;
- structure proxies with differing geometry but a shared material use
  `BatchedMesh`;
- recently altered cells, selected objects, and moving stones remain separate
  interactive instances;
- frustum, distance, and coarse horizon tests prevent invisible chunks from
  reaching the draw list;
- least-recently-used chunks are evicted after leaving the outer ring.

Moving multiple stones later does not change this architecture. Their instance
matrices update in one or a few batches; only selected stones need independent
interaction handles, trails, or action emphasis.

## Performance Contracts

These are product budgets to validate on representative hardware, not promises
from the rendering library.

| Budget | Desktop target | Mobile target |
| --- | ---: | ---: |
| Frame target | 60 fps / 16.7 ms | 30 fps / 33.3 ms |
| Resident detailed chunks | 9 | 5 |
| Visible 20 cm stone instances | 100k–150k | 30k–50k |
| Visible triangles | up to 1.5M | up to 500k |
| Draw calls | no more than 120 | no more than 80 |
| Device pixel ratio | adaptive, capped near 1.5 | adaptive, capped near 1.25 |

GPU frame time controls dynamic resolution and the width of the detailed chunk
ring. It must not change canonical world state, route animation time, or
Endurance presentation.

## Current Browser Implementation

The first dual-scale slice is now available in the observatory:

- Mountain Observatory uses 60/270/900 m initial render sampling from the
  checked-in 30/90/300 m data, caps device pixel ratio, and adapts internal
  resolution from measured frame time.
- While the user drags or zooms, the core mountain, routes, climbers, sites, and
  Endurance remain visible; the mid and far context layers pause and return
  120 ms after interaction ends.
- Site labels update every second frame, resolve collisions by priority, and
  clamp to the viewport instead of becoming unreadable beyond an edge.
- Local Inspection uses a surface-normal coordinate frame, one unit per meter,
  and an 8.2 × 8.2 m window containing 41 × 41 canonical 20 cm surface cells.
- The local surface is split into three instanced material batches. The current
  highest stone is rendered separately at its true 0.20 m size for selection
  and close inspection.

This is a working inspection slice, not yet the final streaming system. It
proves the metric camera, canonical relief, batching, true stone size, and
overview-to-local interaction contract before hashed chunk payloads are added.

## World Feature Rules

- **Famous sites**: persistent beacon and collision-managed label in the
  overview; grounded marker, local terrain context, and optional authored model
  in inspection.
- **Tombstones**: clustered heat or memorial cairn at overview scale; expand the
  selected cluster only in local inspection; never instantiate the entire
  historical population at once.
- **Recent expeditions**: only a small replay set receives animated bodies and
  Endurance halos. Older traces become static route summaries.
- **Stones in replay**: show one emphasized proxy for a selected relocation.
  With multi-stone transport, render carried stones as one instanced group and
  reveal individual stones only near the camera or action endpoint.

## Delivery Order

1. Correct the overview's rock, ice, snow, and light separation.
2. Add screen-space-error selection and hysteresis to the existing 300/90/30 m
   overview levels.
3. Define hashed local chunk payloads and a worker-built 2 m surface proxy.
4. Add the floating-origin Local Inspection scene and the overview cross-fade.
5. Add 0.8 m structure proxies and 20 cm instanced stones.
6. Benchmark desktop and mobile budgets, then tune thresholds from GPU time.
