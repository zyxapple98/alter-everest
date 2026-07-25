# Voxel static physics visual archive

The V2.1 research rules are now the production
`VOXEL_STATIC_V2_1` contract. The authoritative implementation and limits live
in:

- `engine/physics.ts`
- `engine/constants.ts`
- `engine/surface.ts`
- `docs/PHYSICS.md`
- `tests/physics.test.ts`

This directory intentionally retains only the presentation assets requested for
future documentation. They depict ordinary stone construction; there is no
special scaffold material.

## Outputs

- `outputs/structural-units-supported-vs-unsupported.png` — English capability
  map of supported and rejected structural units.
- `outputs/mountain-hall-construction.gif` — a medium-complexity human-scale
  hall built through valid intermediate states.
- `outputs/bridge-construction.gif` — a self-supporting masonry bridge sequence.
- `outputs/arch-construction.gif` — a stepped/corbelled arch sequence.

The images are explanatory examples, not engineering certification. Production
acceptance always comes from the current verifier.
