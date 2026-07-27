# Error guidance

`expedition:check` and route preflight return:

```json
{
  "actionableCode": "SLOPE_EXCEEDED",
  "rule": {
    "ruleId": "route.locomotion-slope",
    "summary": "...",
    "next": "...",
    "doc": "docs/player/ROUTE.md#locomotion",
    "limits": {
      "climber.locomotion.WALK.maximumLoadedSlopeDegrees": 32
    }
  }
}
```

The machine-readable registry is `protocol/player-rules.json.errors`. This
document groups failures by the player module that owns the rule.

<!-- generated: error-catalog:start -->

## Input, identity and submission

- `CANDIDATE_ALREADY_APPLIED` — This exact candidate has already changed the canonical world.
- `IDENTITY_DEAD` — A DEAD GitHub identity cannot begin another expedition.
- `IDENTITY_MISMATCH` — The candidate identity does not match its directory or pull-request author.
- `INPUT_INVALID` — The candidate file could not be admitted as bounded UTF-8 JSON.
- `SCHEMA_INVALID` — The candidate does not match the public candidate shape.
- `STALE_CONFLICT` — The latest canonical world changed a fact required by this proof.

## Route and terrain

- `BASE_REDEPARTURE_FORBIDDEN` — After the first return to Camp, the route cannot leave again.
- `CLIMB_UNPROTECTED` — Every CLIMB micro-movement must enable personal protection.
- `ENDURANCE_EXHAUSTED` — The integrated route energy exceeds the expedition capacity.
- `OUTSIDE_TERRAIN` — A decoded stance lies outside the authoritative terrain.
- `ROUTE_INVALID` — The route failed a public lifecycle, terrain, movement, or Endurance rule.
- `ROUTE_NEVER_LEFT_BASE` — A legal expedition must leave Everest Base Camp.
- `ROUTE_OBSTRUCTED` — Matter blocks the climber body during a submitted route phase.
- `ROUTE_PROGRAM_INVALID` — The compact route program is malformed, non-canonical, or does not match its bounded step count.
- `ROUTE_UNSUPPORTED` — A decoded stance has no legal terrain or stone support.
- `SLOPE_EXCEEDED` — The selected locomotion mode is not valid for this slope and carried load.
- `START_OUTSIDE_BASE` — Every expedition starts inside Everest Base Camp.
- `UNSAFE_TERMINAL` — A non-Base terminal point must be declared safe and satisfy walking slope.
- `VERTICAL_STEP_EXCEEDED` — A WALK segment attempts a step too high for walking.

## Matter and timing

- `ACTION_AFTER_BASE_RETURN` — No new action or WORLD release may occur after returning to Camp.
- `ACTION_INDEX_INVALID` — Pickup and release steps are invalid, unordered, or overlap another carry interval.
- `ACTION_POSITION_MISMATCH` — A non-Base pickup or release stance is too far from its matter cell.
- `BASE_IMPORT_INSIDE_CAMP` — A new Base stone must be imported outside Base Camp.
- `BASE_PICKUP_AFTER_DEPARTURE` — A Base stone must be picked up before the first departure.
- `BASE_PICKUP_OUTSIDE_CAMP` — A BASE pickup stance must be inside Everest Base Camp.
- `BASE_RELEASE_OUTSIDE_CAMP` — A BASE recovery release stance must be inside Everest Base Camp.
- `BASE_WITHDRAWAL_LIMIT_EXCEEDED` — One expedition may withdraw at most one new Base stone.
- `DESTINATION_OCCUPIED` — A WORLD destination cell is already occupied.
- `NO_STATE_CHANGE` — The ordered actions leave no canonical world change.
- `SPAWN_CORE_PROTECTED` — Matter cannot be placed, quarried, or rearranged inside the Spawn Core.
- `STONE_ALREADY_EXISTS` — The proposed matter ID already exists.
- `STONE_NOT_FOUND` — The source stone is absent from the selected world state.
- `WORLD_BOUNDS_EXCEEDED` — A proposed cell lies outside the public world bounds.

## Structures and excavation

- `AFFECTED_STONES_TOO_LARGE` — One affected stone component exceeds the bounded verifier size.
- `CAVITY_WINDOW_TOO_LARGE` — The changed cavity exceeds the bounded local verification window.
- `DESTINATION_HAS_NO_FACE_CONTACT` — A placed stone must share a face with solid terrain or another stone.
- `EXPEDITION_PHYSICS_BUDGET_EXCEEDED` — The cumulative action sequence exceeds one expedition's physics budget.
- `PHYSICS_INVALID` — A pickup-only or post-release matter state failed static verification.
- `STONE_COMPRESSION_EXCEEDED` — Average load per anchor cell exceeds the static compression limit.
- `STONE_IMBALANCED` — The component center of mass lies outside its safe anchor footprint.
- `STONE_LATERAL_OVERTURNING` — The structure is too tall for its smaller anchored base dimension.
- `STONE_SPAN_EXCEEDED` — Horizontal support would have to travel beyond the permitted reach.
- `STONE_UNANCHORED` — An affected face-connected stone component has no terrain anchor.
- `STRUCTURE_TOO_TALL_FOR_FULL_RECHECK` — The affected component spans too many distinct levels for one recheck.
- `TERRAIN_CONTEXT_MISSING` — Static validation lacks authoritative terrain context.
- `TERRAIN_VOXEL_NOT_EXPOSED` — A terrain voxel may be quarried only from exterior air or an existing excavation face.
- `TOO_MANY_CHUNKS_TOUCHED` — One mutation touches too many physics chunks.
- `TUNNEL_RADIUS_EXCEEDED` — A cavity cell is too far from solid side material.
- `TUNNEL_ROOF_TOO_THIN` — The excavation leaves too little solid roof.
<!-- generated: error-catalog:end -->

For route obstruction, rerun the full check with `--diagnose`. For every other
failure, follow the returned `rule.next` and `rule.doc`.

Rejected candidates change no canonical state and do not kill an identity. A
legal one-way accepted expedition does.
