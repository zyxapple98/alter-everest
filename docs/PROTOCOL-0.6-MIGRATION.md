# Protocol 0.6 action-sequence migration

Protocol 0.6 changes the candidate proof from one expedition-level mutation to
an ordered sequence of route-bound actions.

## Candidate shape

Protocol 0.5:

```json
{
  "proof": {
    "route": [],
    "mutation": {
      "kind": "RELOCATE",
      "matterId": "stone-1",
      "source": { "kind": "BASE" },
      "destination": {
        "kind": "WORLD",
        "cell": { "x": 1, "y": 2, "z": 3 }
      }
    },
    "releaseIndex": 42
  }
}
```

Protocol 0.6:

```json
{
  "proof": {
    "route": [],
    "actions": [
      {
        "kind": "RELOCATE",
        "matterId": "stone-1",
        "source": { "kind": "BASE" },
        "destination": {
          "kind": "WORLD",
          "cell": { "x": 1, "y": 2, "z": 3 }
        },
        "pickupIndex": 0,
        "releaseIndex": 42
      }
    ]
  }
}
```

Both indices are required for every source and destination. A Base source is
picked up at a route sample inside Everest Base Camp. A Base destination is
released at a route sample inside Camp. There may be at most one Base source
action in an expedition, and it must be picked up before departure.

## Expedition lifecycle

An expedition must leave Base Camp and has exactly one sortie:

```text
IN_BASE_PRE_DEPARTURE -> OUTSIDE -> RETURNED
```

After the first return, the route may continue inside Camp only. No new pickup
or World release is allowed, but matter picked up outside may still be released
to Base. Re-departure is rejected. The verifier checks the full horizontal
route segment against the Camp cylinder, so endpoints cannot hide a crossing;
Camp and Spawn Core membership also ignores altitude.

## Deterministic execution

Actions are already in timeline order. For each action the verifier:

1. validates the route up to the pickup against the current temporary world;
2. removes the source and validates the pickup-only static world;
3. validates the loaded route phase against that world;
4. places or stores the matter and validates the post-release world;
5. continues from that world into the next action.

Carry intervals may meet at one route sample but may not overlap. This proves
the capacity-one inventory rule without trusting a candidate-supplied load
flag. Every intermediate structure is independently stable. The final reducer
write remains one atomic transaction.

## Bounds and scoring

The schema permits at most 512 actions. The verifier additionally bounds
cumulative evaluated stone and cavity cells so a long action list cannot
multiply the per-mutation physics budget without limit.

The public protocol manifest caps Base withdrawals at one per expedition.
This prevents a multi-action route from treating repeated Camp visits as an
unbounded inventory while preserving unlimited Base supply across separate
expeditions.

Survival, Endurance reserve and duplicate penalties remain expedition-level.
Altitude uses the highest scoring action. Height and stewardship rewards use
the best qualifying action rather than summing the sequence, preventing
repeated local moves from multiplying the legacy score.

## Ledger compatibility

Canonical snapshots and old expedition records remain readable. New records
use `action: "MULTI"` when an expedition contains more than one action and also
store the ordered operation summary. Event artifacts use event version 1.1.0;
receipts use version 1.2.0 and bind the action count, operation list and matter
IDs in addition to the candidate hash.

Protocol 0.5 candidate blobs are historical artifacts, not valid new
submissions after 0.6 activation. Feed generation retains a legacy proof reader
so existing event traces do not need to be rewritten.
