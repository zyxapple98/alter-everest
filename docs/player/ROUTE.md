# Exact route and survival

This document owns exact movement, locomotion, Endurance and survival. Numeric
values come from `protocol/player-rules.json`.

## One-sortie lifecycle

Every identity starts inside the horizontal Everest Base Camp cylinder. The
route must leave Camp. Its first return starts the terminal Camp phase; it may
continue inside Camp but cannot leave again.

Returning produces `ACTIVE`. Ending elsewhere requires a legal safe terminal
and produces `DEAD`.

## Exact microtrace

The candidate contains one `ae-microtrace-v1` program. It losslessly expands
into exact integer stance cells on the 20 cm world grid.

Every movement enters one of the eight horizontally adjacent columns and has a
bounded integer vertical delta. The program also carries locomotion and
protection changes. `stepCount` is the number of decoded movements; stance
zero is the submitted start and always uses the codec initial state
`mode: "WALK", protected: false`.

The verifier checks every stance and the swept body between consecutive
stances against the temporary world that exists at that moment. A stance
needs legal terrain or stone support. Stones are checked against the full body
at every stance and swept edge. Natural outdoor terrain supplies the surface
contact represented by locomotion; full terrain-body clearance is activated
for excavated interiors when either edge endpoint is at or below that column's
native surface. Endpoint-only checks are insufficient in either model. The
machine-readable contact model is `route.clearanceModel` in
`protocol/player-rules.json`.

The candidate does not submit y/altitude/slope/surface claims. Those are
derived from canonical terrain and matter.

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

| Mode | Maximum slope | Maximum loaded slope | Speed | Protection |
| --- | ---: | ---: | ---: | --- |
| WALK | 35° | 32° | 0.78 m/s | no |
| SCRAMBLE | 55° | 48° | 0.34 m/s | no |
| CLIMB | 82° | 82° | 0.16 m/s | `protected: true` |
<!-- generated: route-locomotion:end -->

The destination movement mode governs one edge. `WALK` also has the public
maximum absolute step height. `CLIMB` requires protection on every encoded
climb movement.

## Clearance

The climber body has the public radius and height. Every micro-edge checks its
swept volume against stones. Excavated interiors also check the swept volume
against terrain; outdoor natural terrain supplies the selected locomotion
mode's surface contact.

Matter mutations are temporal. Removing a support can invalidate the stance
at the pickup step. A new placement can block the remaining route. If the
intention includes a usable bridge, stair or tunnel, the trace must cross it
after construction.

## Endurance

Capacity is 100 Endurance and one Endurance is 450 kJ. The deterministic
energy integral processes every exact edge and accounts for distance, grade,
locomotion, surface, altitude, time and the carried 21.6 kg matter piece.

`route:evaluate` returns exact distance and the independent route ledger.
Only `expedition:check` includes temporal matter changes and complete physics.

## Survival and terminal points

A terminal stance inside Camp preserves the identity. A terminal outside Camp
requires `safeStop: true`, walking-safe local slope, valid support and full
clearance.

`site:query` returns exact nearby stance observations as planning hints.
North Base Camp remains a site, not a respawn or extraction point. There is no
trip-type field; choose the final stance from the human's risk tolerance and
the verified Endurance budget.
