# Physics contract

ALTER EVEREST uses the deterministic `VOXEL_STATIC_V2_1` ruleset. It is a
reality-informed game abstraction for ordinary interlocked stone masonry, not
a rigid-body simulation and not engineering certification.

## Matter and coordinates

- canonical cell edge: 0.20 m
- stone material: ordinary `STONE`
- nominal stone mass: 21.6 kg
- position: one exact integer `{x,y,z}` cell
- contact: shared faces only
- action sequence: atomic accept or reject

There are no release poses, rotations, velocities, friction impulses, falling
bodies, or special scaffold material. A temporary prop is simply another
ordinary stone and must remain legal when placed. A mutation that would create
a floating piece or destabilize an affected component is rejected; the
verifier does not animate a collapse into canonical state.

## Static structural checks

After applying each proposed mutation in memory, the verifier finds every
face-connected stone component touched by the source or destination and checks:

1. **Anchorage.** Every component needs at least one stone directly above solid
   terrain.
2. **Reach.** Horizontal support distance is at most
   `min(8, 4 + floor(log2(vertical thickness)))` cells. Vertical transfer has
   zero horizontal cost. This permits short lintels, corbels, arches and
   masonry bridge decks, but rejects indefinite slabs and cables.
3. **Balance.** The combined centre of mass of stones and active service load
   must lie inside the convex terrain-anchor footprint with a 0.05-cell
   (1 cm) inward margin.
4. **Slenderness.** Component height may not exceed ten times the smaller
   terrain-anchor footprint dimension.
5. **Compression.** Average stone-equivalent weight per anchor cell may not
   exceed 4,096. Route validation applies the climber, and a carried stone when
   applicable, as a transient service load.

For every move or quarry-and-relocate action, the pickup-only state is checked
before the destination state. A support cannot be removed during the journey
merely because a later action would make the final snapshot stable again.
Route support and obstacles switch through each declared pickup and release
world. All intermediate worlds must pass; the expedition still commits as one
transaction.

The model represents compression plus limited local tension, shear and bending
inside interlocked masonry. It deliberately has no long-range tensile member,
rope, cable, arbitrary diagonal beam, hinge, mortar cure state, fracture,
avalanche, soil plasticity or weather.

## Excavation and tunnels

A terrain voxel may be quarried only when one of its six faces touches exterior
air or an already removed terrain voxel. This supports step-by-step tunnel
advance from a real opening while preventing remote excavation of sealed
matter.

For the local changed cavity:

- a horizontal roof must retain at least two solid cells (0.40 m);
- every checked cavity cell must be within three horizontal Manhattan cells
  (0.60 m) of solid side material;
- route validation separately requires a human-height, human-width clear
  passage before a tunnel is traversable.

Wide rooms therefore need stone pillars or partitions. Vertical open shafts do
not pretend to be roofed tunnels.

## Bounded verification

The public hard limits are:

- 10,000 affected stone cells;
- 250 distinct stone levels;
- 8 touched 32 m physics chunks;
- a 64³-cell local cavity window;
- 512 ordered actions per expedition;
- 100,000 cumulative evaluated stone cells per expedition;
- 1,048,576 cumulative cavity cells per expedition;
- 4 seconds and 256 MiB for the verifier process.

Only components adjacent to the mutation and cavity cells near the excavation
are rechecked. Unrelated canonical matter is preserved byte-for-byte. These
limits are protocol security boundaries: a design exceeding one must be
partitioned into independently stable construction stages.

`npm run physics:benchmark -- --stones 10000` exercises the public worst-size
stone component. The production migration measured about 70 ms on the
development host against a 4,000 ms process budget; hardware-dependent timing
is reported by the command rather than treated as a consensus constant.

## Capability summary

Supported examples include grounded walls, rooms with short lintels, stepped
arches, corbelled arches, short masonry bridges, buttressed halls, towers with
adequate bases, tunnels with adequate cover, and caverns divided by pillars.

Rejected examples include floating stones, edge-only contact, long unsupported
decks, eccentric cantilevers, needle towers, thin tunnel roofs, oversized
unpillared caverns, sealed remote excavation, suspended cables and any
operation that would require a collapse simulation.
