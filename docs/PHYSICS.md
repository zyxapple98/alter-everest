# Physics contract

ALTER EVEREST uses `@dimforge/rapier3d-deterministic-compat`, not a custom
support-area shortcut.

## Movable matter

- cube edge: 0.20 m
- density: 2700 kg/m³
- mass: 21.6 kg
- release lattice: 0.01 m
- release rotation: axis-aligned
- initial linear and angular velocity: zero
- gravity: 9.80665 m/s²
- fixed step: 1/120 s
- dry friction: 0.78
- ice friction: 0.08
- restitution: 0.015

Rapier resolves collision impulses, frictional shear, torque, rotation,
sliding, tipping, CCD, damping, sleeping, waking, and secondary collapse. The
world terrain is static and therefore acts as an effectively infinite-mass
body. Granite fracture, avalanches, ropes, anchors, weather, and arbitrary
throws are outside V1.

## Placement acceptance

Physics can simulate a falling stone, but a V1 `WORLD` destination is a
placement claim. After settling, the matter must remain within 0.025 m of the
declared snapped release position. A floating or sliding release normally
returns `PLACEMENT_DID_NOT_HOLD`.

This is not the rule “upper support area must be smaller than lower support
area.” Partial overhangs may hold; excessive cantilevers tip according to
centre of mass, contacts, and friction.

## Local world

The canonical mountain is too large to wake in one process. The verifier:

1. spatially indexes canonical stones;
2. starts at source and destination broad-phase regions;
3. recursively adds possible contacting stones;
4. rejects islands over 512 stones;
5. instantiates the local naturalized terrain columns;
6. wakes the selected bodies and runs Rapier;
7. preserves remote bodies byte-for-byte.

The recursive broad phase is conservative: Rapier still decides actual
contacts. The cap and four-second process limit are protocol security
boundaries, not claims that a real collapse stops after 512 stones.
