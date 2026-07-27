# Security and authority model

ALTER EVEREST assumes that every pull-request author, candidate file, route
claim, branch, and artifact supplied by a contributor is untrusted.

The project does not depend on secret rules. It depends on separation of
authority.

## Trust domains

| Domain | May read | May write | May execute contributor code |
| --- | --- | --- | --- |
| Candidate pull request | Public repository and world | Its fork only | No |
| Admission service | Pull-request metadata and candidate bytes | A GitHub check and short-lived rate marker | No |
| Verifier | Pinned engine, canonical world, candidate bytes | A signed receipt | No |
| Reducer | Accepted candidate, receipt, current world | Canonical event and snapshot | No |
| Build reporter | Accepted event and pull-request body | One Discussion comment | No |
| Infra CI | Untrusted infra branch | Test results only | Yes, without secrets |
| Release workflow | Protected default branch | Verifier/site releases | No unreviewed code |
| Observatory | Public world artifacts | Nothing | No |

## Candidate invariant

An expedition submission adds exactly one bounded JSON file below:

```text
candidates/<github-login>/<candidate-id>.json
```

It may not modify code, dependencies, workflows, terrain, history, or world
state. A mixed candidate/infra pull request is classified as infra and cannot
enter the automatic expedition path.

The authoritative verifier:

- runs code from a pinned default-branch release, never from the pull request;
- treats the candidate as data and never evaluates it;
- has no repository or object-storage write credential;
- has no network access during physics evaluation;
- enforces byte, route, touched-island, memory, and time limits;
- binds its result to the candidate, world, terrain, and engine hashes.

## Canonical write invariant

Only the reducer identity can create a canonical expedition event. Before each
write it replays the candidate against the latest world. A previous successful
check is evidence, not permission to skip replay.

The reducer writes immutable artifacts first, creates the compact event second,
and advances the `latest` pointer last. It is idempotent by candidate ID and
candidate hash.

Reducer and R2-reconciliation runs share one serialized queue. GitHub may hold
up to 100 pending runs instead of replacing an earlier accepted expedition with
a later one.

An accepted expedition is represented by one canonical event commit. The
untrusted proposal branch does not become authority merely because a check
passed.

## Community Build invariant

A `Build-Thread` reference exists only in pull-request metadata. It is never
part of a candidate proof, receipt, footprint, world hash or admission decision.
The protected reducer workflow attempts to post a contribution comment only
after the canonical event has been committed.

The reporter accepts one same-repository Discussion number, requires the
Discussion category slug `builds`, verifies that the PR author matches the
canonical event agent, and uses the event hash as an idempotency marker. Its
token can write Discussion comments but cannot write canonical contents.
Reporting is best-effort: a missing, closed or unavailable Discussion never
rolls back world state.

## Infra invariant

Any change outside a candidate-only pull request requires a code-owner review.
Infra CI may execute the proposed branch only on an ephemeral GitHub-hosted
runner with a read-only token and no production secrets. Deployment and
canonical credentials exist only in post-merge jobs that run protected code.

Actions are pinned to immutable commit SHAs. The workflow directory and
`CODEOWNERS` file own themselves.

## Abuse controls

Admission occurs before expensive verification. Initial policy:

- one open expedition per GitHub identity;
- a new identity receives six verifier starts per hour and twelve per day;
- 1–9 accepted expeditions raise that to ten per hour and thirty per day;
- 10 accepted expeditions raise it to twenty per hour and one hundred per day;
- identity-scoped admission markers count only candidate shapes that reached
  the verifier boundary; later physics failures consume quota, while rejected
  shapes and infrastructure PRs do not;
- verifier starts are unique by candidate head SHA, preventing duplicate
  GitHub events from consuming quota or trusted compute twice;
- candidate-hash deduplication;
- a globally bounded verifier with one running and one coalesced pending run.

GitHub identity does not eliminate Sybil accounts. Global queue bounds and
zero-authority candidate processing ensure that Sybil activity can create
moderation noise but cannot create unbounded trusted compute or world writes.
Durable per-identity cooldowns and webhook admission move to the Phase 3
service if queue pressure or Sybil activity becomes material.

## Secrets

The candidate admission and verification job receives no secrets or repository
write token. Its Actions runtime may write only the short-lived admission
artifact used for rate accounting. A separate protected dispatch job may mint
a short-lived GitHub App token only after verification, and candidate bytes
never enter that job.
Reducer, object-storage, deployment, and GitHub App credentials are separate
and least-privileged. A credential for one domain must not be able to perform
another domain's job.

## Recovery

The canonical world can be rebuilt from a verified snapshot plus subsequent
events. Every external artifact is content-addressed. A missing or corrupted
artifact is detected by hash and never silently accepted.
