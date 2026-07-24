# Implementation plan

The project keeps GitHub as the public ledger, source of rules, proposal
surface, and social history. It does not treat GitHub as the only long-term
security boundary, compute cluster, or high-volume data origin.

## Phase 0 — playable prototype

Status: complete.

- registered Everest DEM with nested 30/90/300 m visual LODs;
- interactive voxel observatory and animated expedition traces;
- deterministic route, oxygen, clearance, and Rapier contact validation;
- ADD, MOVE, RECOVER, survival, death, tombstones, and scoring;
- local planner, validator, reducer, and end-to-end tests.

## Phase 1 — protected public beta

Status: implementation complete; owner configuration remains.

- candidate-only PR admission from the protected base branch;
- no checkout, dependency install, or execution from a candidate branch;
- bounded offline verifier container;
- separate read-only infrastructure CI with Code Owner review;
- Ed25519 receipts bound to candidate, world, terrain, and engine hashes;
- globally serialized, idempotent canonical reducer;
- compact event log, exact proof, receipt, snapshot, and public read model;
- GitHub App machine identity for canonical writes;
- per-identity and global compute limits;
- AGPL software license, separate world-data terms, and reserved marks.

Exit criteria are the launch checks in `docs/OPERATIONS.md`.

## Phase 2 — static edge delivery

Status: code path complete; Cloudflare account configuration remains.

- Cloudflare Pages serves versioned application assets;
- R2 serves `latest.json` and later immutable world artifacts;
- the browser polls data independently of website deployments;
- a runtime URL switch allows a GitHub Pages fallback or provider migration;
- CDN cache rules keep `latest.json` short-lived and hashes immutable.

This is the recommended launch topology even if the first audience is small.
It avoids a later frontend rewrite and keeps a traffic spike inexpensive.

## Phase 3 — verifier GitHub App service

Trigger: sustained queue pressure, targeted abuse, or roughly thousands of
verification attempts per day.

- receive candidate PR webhooks in a small stateless service;
- perform cheap admission and rate limiting before allocating a worker;
- pull an immutable verifier image by digest;
- return a GitHub Check with a signed receipt;
- keep reducer and signer in separate trust domains;
- retain GitHub Actions only for infrastructure CI and releases.

The public protocol and engine remain in the repository. The service adds
resource isolation and scheduling, not secret validation rules.

## Phase 4 — compact ledger and high-resolution terrain

Trigger: repository proofs approach hundreds of megabytes or authoritative
terrain tiles outgrow normal Git workflows.

- Git stores compact events, hashes, scores, engine IDs, and small trace
  previews;
- R2 stores compressed full proofs, physics artifacts, snapshots, and terrain
  tiles under content-addressed keys;
- periodic signed checkpoints permit deterministic replay without cloning all
  historical payloads;
- measured high-resolution placement tiles activate only through a new terrain
  manifest and protocol migration.

At no phase may visual synthetic detail become authoritative physics data.

## Deferred game design

Human intents, landmarks, multi-expedition construction, missions, rewards,
and scoring can change after playtesting. Their eventual implementation must
preserve three invariants:

1. a candidate is declarative untrusted data;
2. accepted state is reproducible from named inputs and verifier code;
3. only a serialized reducer can advance the canonical world.
