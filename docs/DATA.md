# Terrain data ladder

ALTER EVEREST separates display detail from physical authority. A rendered
voxel may be stylized; a route or stone placement may only depend on registered
source data whose bytes and coordinate transform are content-hashed.

## Current layer

Copernicus GLO-30 is the checked-in global surface. It provides one arc-second
spacing, worldwide continuity, and documented WGS 84 / EGM2008 registration.
The observatory derives its 30 m, 90 m, and 300 m levels from those same bytes.

This is sufficient for the world silhouette, strategic route search, altitude,
and broad slope. It is not evidence of a 20 cm ledge. The local Rapier mesh is
therefore mechanically real but geometrically limited by a 30 m measurement.

## Next measured layer

[NASA NSIDC HMA_DEM8m_AT](https://nsidc.org/data/hma_dem8m_at/versions/1)
contains 8 m DEM strips generated from high-resolution along-track optical
imagery across High Mountain Asia. It is free with a NASA Earthdata Login and
has varying dates and footprints.

An import is eligible only after it:

1. covers the selected Everest physics region without unlabelled voids;
2. is transformed into the canonical horizontal and vertical datum;
3. is co-registered against stable bedrock, not snow or cloud artefacts;
4. records acquisition time, uncertainty, source granules, and licence;
5. produces immutable source, transform, mesh, and tile hashes;
6. passes seam, altitude, route, and physics regression tests.

At 8 m, route grades become materially better, but 20 cm stone contact is still
not measured.

## Placement layer

Decimetre contact needs an independently licensed survey: terrestrial or UAV
photogrammetry, LiDAR, or a surveyed game surface tied to control points. It
should exist only around mutable stone islands, never as a global grid.

```text
300 m  horizon silhouette
 90 m  regional continuity
 30 m  global route surface (current authority)
  8 m  high-mountain route refinement
0.2 m  sparse placement islands
```

The terrain interface already isolates this upgrade. A finer tile may replace a
coarser local collision island only when its hash becomes part of the canonical
world version. Procedural noise is allowed in the renderer and forbidden in the
physics oracle.
