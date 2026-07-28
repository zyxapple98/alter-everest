# Exact route and survival

This document owns exact movement, locomotion, Endurance and survival. Numeric
values come from `protocol/player-rules.json`.

## One-sortie lifecycle

Every identity starts inside the 140 m Everest Base Camp radius and no more
than 2 m above or below the local natural surface. The route must leave Camp.
Its first return starts the terminal Camp phase; it may continue inside Camp
but cannot leave again.

Returning produces `ACTIVE`. Ending elsewhere requires explicit acceptance of
a legal one-way terminal and produces `DEAD`.

## Exact microtrace

The candidate contains one `ae-microtrace-v2` program. It losslessly expands
into exact integer stance cells on the 20 cm world grid.

Current candidate admission accepts only the current protocol and codec.
Previously accepted v1 proofs remain immutable historical artifacts and may be
decoded for replay displays; that read-only compatibility does not make a v1
route a valid new candidate.

Every movement enters one of the eight horizontally adjacent columns and has a
bounded integer vertical delta. `stepCount` is the number of decoded
movements; stance zero is the submitted start. The route contains no
agent-supplied locomotion or protection state.

The verifier checks every stance and the swept body between consecutive
stances against the temporary world that exists at that moment. A stance
needs legal terrain or stone support. Stones are checked against the full body
at every stance and swept edge. Natural outdoor terrain supplies the support
contact represented by the derived locomotion tier; full terrain-body
clearance is activated for excavated interiors when either edge endpoint is at
or below that column's native surface. Endpoint-only checks are insufficient
in either model. The machine-readable contact model is
`route.clearanceModel` in `protocol/player-rules.json`.

The candidate does not submit altitude, slope, surface or locomotion claims.
Those are derived from canonical terrain and matter.

Use:

```bash
npm run terrain:query -- --chunk <x:z> --compact --out work/chunk.json
npm run move:check -- --help
npm run route:encode -- work/exact-route.json --out work/route.json
npm run route:decode -- work/route.json --summary
```

`route:encode` losslessly compresses the exact stance trace chosen by the
agent.

## Locomotion

<!-- generated: route-locomotion:start -->

| Derived mode | Maximum step | Maximum effective support slope | Surface speed | 20 cm step speed |
| --- | ---: | ---: | ---: | ---: |
| WALK | 0.2 m | 35° | 0.78 m/s | 0.34 m/s |
| SCRAMBLE | 0.4 m | 55° | 0.34 m/s | — |
| CLIMB | 1.6 m | 82° | 0.16 m/s | — |
<!-- generated: route-locomotion:end -->

The verifier derives one mode per edge:

1. step tier depends only on absolute vertical change;
2. support tier uses the steeper actual support at the two endpoints;
3. snow, ice and carried matter add the public shared slope penalties;
4. the edge uses the harder of the step and support tiers.

A stone top is a horizontal ROCK tread. Natural support uses canonical terrain
slope and surface. Snow adds 5°, ice adds 10°, and carrying adds 3° to the
effective support slope. The centre-to-centre angle remains diagnostic only,
so an orthogonal and diagonal 40 cm step receive the same tier. A level
contour across a steep natural side slope still receives the steep support
tier.

WALK step edges use the public slower step speed. Harder derived tiers use
public locomotion energy multipliers; no protection boolean or route-history
state is submitted.

## Clearance

The climber body has the public radius and height. Every micro-edge checks its
swept volume against stones. Stable stone contact no higher than the public
WALK-step height is treated as lower-leg and foot contact instead of a
full-radius torso obstruction. Excavated interiors also check the swept volume
against terrain; outdoor natural terrain supplies the derived support profile.

Matter mutations are temporal. Removing a support can invalidate the stance
at the pickup step. A new placement can block the remaining route. If the
intention includes a usable bridge, stair or tunnel, the trace must cross it
after construction.

## Endurance

Capacity is 100 Endurance and one Endurance is 450 kJ. Every exact edge adds
non-negative horizontal, ascent and descent energy. The derived locomotion
tier, total mass, actual support surface and altitude multiply that local
cost. The carried matter piece adds 21.6 kg. Time uses the derived movement
speed. Nothing is charged merely because the route uses more 20 cm steps.

In public units, one edge uses:

```text
kJ = massKg × (0.004 × horizontalM + 0.028 × ascentM + 0.006 × descentM)
     × locomotion × surface × altitude
```

Locomotion multipliers are WALK 1.0, SCRAMBLE 1.3 and CLIMB 1.7. Surface
multipliers are ROCK 1.0, SNOW 1.25 and ICE 1.15. Altitude is 1.0 through
2,500 m, rises linearly, and reaches 1.85 at 9,000 m.

`route:evaluate` and `expedition:check` use the same temporal replay, including
matter changes and complete physics. The former is a read-only planning view.

## Survival and terminal points

A terminal stance inside Camp preserves the identity. A terminal outside Camp
requires `acceptOneWayDeath: true`, walk-safe actual support, valid support and
full clearance. Acceptance records the identity as `DEAD`; the field is
explicit consent to that one-way outcome, not a safety claim.

`site:query` returns exact nearby one-way-terminal observations as planning
hints. North Base Camp remains a site, not a respawn or extraction point.
There is no trip-type field; choose the final stance from the human's risk
tolerance and the verified Endurance budget.
