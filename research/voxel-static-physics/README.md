# Voxel static physics visual archive

The V2.1 research rules are now the production
`VOXEL_STATIC_V2_1` contract. The authoritative implementation and limits live
in:

- `engine/physics.ts`
- `engine/constants.ts`
- `engine/surface.ts`
- `protocol/player-rules.json`
- `docs/player/PHYSICS.md`
- `tests/physics.test.ts`

This directory intentionally retains only the presentation assets requested for
future documentation. They depict ordinary stone construction; there is no
special scaffold material.

## What can stand?

<p align="center">
  <a href="outputs/structural-units-supported-vs-unsupported.png">
    <img src="outputs/structural-units-supported-vs-unsupported.png" width="100%" alt="Supported and unsupported structural units under ALTER EVEREST stone physics">
  </a>
</p>

## Build it one stable step at a time

Every intermediate world must stand on its own. There is no temporary scaffold
material and no final frame that repairs an invalid earlier step.

### Mountain hall

<p align="center">
  <a href="outputs/mountain-hall-construction.gif">
    <img src="outputs/mountain-hall-construction.gif" width="720" alt="A mountain hall built through fourteen stable construction stages">
  </a>
</p>

### Masonry bridge

<p align="center">
  <a href="outputs/bridge-construction.gif">
    <img src="outputs/bridge-construction.gif" width="720" alt="A masonry bridge built through eleven stable construction stages">
  </a>
</p>

### Corbelled arch

<p align="center">
  <a href="outputs/arch-construction.gif">
    <img src="outputs/arch-construction.gif" width="720" alt="A corbelled arch built through nine stable construction stages">
  </a>
</p>

The images are explanatory examples, not engineering certification. Production
acceptance always comes from the current verifier.
