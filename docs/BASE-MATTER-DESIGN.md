# Base Camp matter policy

## Recommendation

Treat `BASE` as an off-map depot, not as a magical creator and trash can.
Separate two concerns:

- the action protocol describes where and when matter crosses the Base Camp
  boundary;
- a versioned world policy decides whether that matter comes from stored stock
  or from a new standard-stone allowance.

Protocol 0.6 implements the first part through explicit Base pickup and release
indices. It intentionally retains the legacy external source/sink policy until
a canonical depot state is activated. In the current policy, Base remains
unlimited across expeditions, but a single expedition may withdraw at most one
new Base stone before departure. Returning to Camp cannot be used to withdraw
again or begin another sortie.

## Proposed depot rules

1. `STONE/TERRAIN -> BASE` stores the exact `matterId` and its provenance.
   Recovery never destroys an object.
2. `BASE -> WORLD` first looks for that exact stored `matterId` and withdraws
   it when present.
3. A previously unseen `matterId` is a standard Base-supply issuance. It
   consumes the acting identity's renewable or seasonal allowance.
4. Stones in the world are public matter. Depot storage is also public; the
   supply allowance is per identity so one identity cannot exhaust a single
   global counter for everyone.
5. Quarrying remains the unlimited-in-principle physical source, constrained by
   terrain exposure, structure safety, route reach and Endurance.

A future canonical state can represent this without changing the 0.6 action
shape:

```json
{
  "baseDepot": {
    "policyVersion": "base-depot-v1",
    "stored": [
      {
        "matterId": "stone-17",
        "origin": {
          "kind": "TERRAIN",
          "voxel": { "x": 1, "y": 2, "z": 3 }
        }
      }
    ],
    "allowances": [
      { "agentId": "example-agent", "remaining": 16 }
    ]
  }
}
```

The exact initial and renewal allowance is a balance parameter, not a candidate
schema constant.

## Why use the hybrid policy

An unlimited external source makes large structures approachable, but removes
the meaning of quarrying and recovery, encourages world-state spam, and makes
matter provenance fictional. A completely closed world has strong conservation
but creates a bootstrap chore and can strand new identities without usable
material.

A bounded standard supply plus persistent recovered stock preserves both:

- every returned stone remains part of the public history;
- new identities can start building;
- local quarrying and logistics retain value;
- supply balance can change by policy version without redesigning actions.

## Activation and migration

The depot should be introduced as a separate world-schema migration:

1. add `baseDepot` to canonical hashing and receipts;
2. classify existing world stones by their original accepted event;
3. mark earlier `BASE -> WORLD` stones as `LEGACY_BASE_SUPPLY`;
4. do not invent recoverable stock for legacy recoveries whose exact state was
   intentionally discarded;
5. seed allowances explicitly in the migration event;
6. activate depot enforcement only after the migrated snapshot and verifier
   share the same world-policy version.

This keeps the current action migration deterministic while leaving the supply
decision reversible until its economy has been playtested.
