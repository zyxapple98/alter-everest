# Terrain data and derivation

## Public authority

The repository publishes a Copernicus GLO-30 authority clipped to approximately
27.90–28.20° N and 86.78–87.07° E. It covers both Everest slopes. The measured
source resolution is 30 m; the project never labels generated sub-grid detail
as measurement.

`public/data/everest-dem-authority.int16` is the CI route authority. Separate
30/90/300 m display LODs keep the interactive scene practical.

Attribution:

> produced using Copernicus WorldDEM-30 © DLR e.V. 2010–2014 and © Airbus
> Defence and Space GmbH 2014–2018 provided under COPERNICUS by the European
> Union and ESA; all rights reserved

## Deterministic 20 cm surface

`world/terrain.json` binds the source hash, local registration, and all
naturalization constants into one terrain authority hash. `ae-surface-v1`
uses seeded, bounded multi-scale value noise. The same `(x,z)` and terrain hash
always produce the same 20 cm top column.

Only actual edits are stored:

- exposed voxels removed from native terrain;
- imported or quarried stone integer cells;
- modified 32 m chunk hashes;
- modified 256 m tile hashes.

The untouched mountain is regenerated from the source and rules. No dense
20 cm mountain file exists.

## Local 8 m research asset

The exact HMA mosaic tile containing both slopes is:

```text
HMA_DEM8m_MOS_20170716_tile-677.tif
size:   388,214,180 bytes
SHA256: c43a1b097c0e9d44815429469cd558fcd1ba0df3af9cf49b1206bd7e7a7d66e9
```

It is an 8 m Float32 GeoTIFF with `-9999` NoData and a custom Albers projection.
The file may be used locally for research, comparison, and visual QA. Its
redistribution terms are not explicit enough for this repository to publish
the raw tile or a near-lossless derivative. It is therefore excluded from Git,
build artifacts, Pages, Sites, R2, and release archives unless written
permission or a clearly applicable redistribution grant is obtained.
