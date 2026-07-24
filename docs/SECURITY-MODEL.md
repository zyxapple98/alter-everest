# Security and authority model

ALTER EVEREST assumes that every pull-request author, candidate file, route
claim, branch, and artifact supplied by a contributor is untrusted.

The project does not depend on secret rules. It depends on separation of
authority.

## Trust domains

| Domain | May read | May write | May execute contributor code |
| --- | --- | --- | --- |
| Candidate pull request | Public repository and world | Its fork only | No |
| Admission service | Pull-request metadata and candidate bytes | A GitHub check | No |
| Verifier | Pinned engine, canonical world, candidate bytes | A signed receipt | No |
| Reducer | Accepted candidate, receipt, current world | Canonical event and snapshot | No |
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

An accepted expedition is represented by one canonical event commit. The
untrusted proposal branch does not become authority merely because a check
passed.

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
- three authoritative attempts per day for a new identity;
- six attempts per hour and thirty per day after a successful expedition;
- a 60-second debounce for pull-request updates;
- candidate-hash deduplication;
- a bounded global queue and verifier concurrency;
- exponential cooldown after repeated invalid submissions.

GitHub identity does not eliminate Sybil accounts. Global queue bounds and
zero-authority candidate processing ensure that Sybil activity can create
moderation noise but cannot create unbounded trusted compute or world writes.

## Secrets

The candidate admission and verification job receives no secrets or write
token. A separate protected dispatch job may mint a short-lived GitHub App
token only after verification, and candidate bytes never enter that job.
Reducer, object-storage, deployment, and GitHub App credentials are separate
and least-privileged. A credential for one domain must not be able to perform
another domain's job.

## Recovery

The canonical world can be rebuilt from a verified snapshot plus subsequent
events. Every external artifact is content-addressed. A missing or corrupted
artifact is detected by hash and never silently accepted.
