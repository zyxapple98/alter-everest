# Terrain rendering architecture

ALTER EVEREST has one canonical mountain and several disposable visual
representations of it. Rendering never writes canonical world state.

```text
world/snapshot.json + world/terrain.json
                 |
          build-world-feed
                 |
      latest.json tile manifest
                 |
    immutable 256 m surface tiles
                 |
          SurfaceTileStore
        (lazy load + LRU cache)
                 |
       TerrainStreamingEngine
      (Worker meshing + mesh LRU)
                 |
 camera-centred voxel clipmap
  20 cm ... 30 m + overview DEM
```

## Authority boundary

- The reducer owns stones, removed terrain voxels, identities and footprint.
- The 30 m DEM owns the macro terrain shape.
- `syntheticReliefM` is the shared deterministic 20 cm naturalisation rule.
- Surface tiles are materialised current state, not an expedition history.
- The observatory may change LOD, caches, shaders or camera controls without
  changing expedition physics or accepted candidate data.

## Runtime modules

- `surface-tile-store.ts` resolves only the 256 m tiles intersecting the
  current clipmap and keeps immutable payloads in an LRU.
- `terrain-worker.ts` builds typed voxel buffers off the UI thread.
- `terrain-mesher.ts` samples the DEM, applies deterministic relief and folds
  the materialised terrain edits into the visible surface.
- `terrain-streaming.ts` owns Worker jobs, mesh reuse, tile prefetch and GPU
  resource lifetime.
- `terrain-runtime.ts` owns navigation collision and screen-space LOD
  selection.
- `EverestObservatory.tsx` coordinates those systems and renders UI; it does
  not interpret canonical mutations.

## LOD invariants

1. All clipmap centres snap to the canonical 20 cm grid.
2. Adjacent rings advance through every declared level; levels are not
   skipped.
3. A coarser ring overlaps the finer ring before the finer edge transitions.
   The overlap is opaque and depth-writing, so it cannot reveal the sky.
4. LOD is selected by projected voxel size, with hysteresis while the camera
   moves.
5. A newly built clipmap is installed atomically. The previous clipmap stays
   visible until all replacement rings are ready.
6. Camera collision samples the target, camera and intervening boom against
   the same quantised surface used by the active LOD.

## Performance rules

- Feed size grows with occupied surface tiles, not expedition count.
- A view loads only intersecting tiles and prefetches the next window.
- Meshing is off-main-thread and repeated clipmaps reuse typed buffers.
- Positions remain 32-bit floats, while display colors and transition weights
  use normalized 8-bit attributes. This preserves visible output while cutting
  those two CPU/GPU streams to one quarter of their former size.
- Reusable mesh buffers have a 64 MiB byte budget. Surface tile payloads have
  both a 48-tile ceiling and a 12 MiB encoded-byte budget.
- Evicting a surface tile also removes its collision-column index; travelling
  through the mountain therefore reaches a memory plateau instead of retaining
  every previously visited edit.
- Geometry has bounding volumes so Three.js can frustum-cull it.
- Detail materials are opaque and front-sided; transparency sorting is not in
  the terrain hot path.
- Runtime counters expose draw calls, triangles, cache residency and queue
  depth for regression checks.

Future optimisation should preserve these boundaries. In particular, do not
put route evaluation into the renderer and do not make canonical world state
depend on a visual LOD.
