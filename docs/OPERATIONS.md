# Production operations

This document turns the public repository into a protected beta. Complete the
owner-only steps in order. Do not enable automatic reduction before every
required secret and rule is present.

## 1. Create the public repository

Create the repository, keep `main` as the default branch, enable private
vulnerability reporting, and push the protected source only after the local
test suite passes.

Recommended repository name: `alter-everest`.

## 2. Create the reducer GitHub App

Create a private GitHub App owned by the same account or organization as the
repository. Install it only on this repository.

Repository permissions:

- Contents: read and write
- Pull requests: read and write
- Metadata: read

The App does not need Issues, Actions, Administration, Members, or Secrets
permissions. Disable webhook delivery; the current beta uses a trusted
workflow dispatch rather than an App server.

Store the App ID and generated private key as Actions secrets:

```text
REDUCER_APP_CLIENT_ID
REDUCER_APP_PRIVATE_KEY
```

The App token is minted only after the candidate has been replayed. It is used
to append canonical artifacts, comment on the proposal, and close the
candidate PR without merging its untrusted branch.

## 3. Create the verifier signing key

Run this once on a trusted owner machine:

```bash
npm run verifier:keys
```

Store `privateKeyPkcs8Base64` as the Actions secret:

```text
VERIFIER_PRIVATE_KEY_PKCS8_BASE64
```

Add the returned key ID and public SPKI value to
`protocol/verifier-keys.json`, review that change as infrastructure, and keep
the private value out of Git, logs, issues, and pull requests.

Key rotation adds a new public key before changing the secret. Old public keys
remain registered so historical receipts stay verifiable.

## 4. Protect `main`

Create an active branch ruleset for the default branch:

- block deletion and force pushes;
- require pull requests for human changes;
- require one approval;
- require Code Owner approval;
- dismiss stale approvals;
- require all conversations to be resolved;
- require `Read-only infra test`;
- allow only squash or rebase merges;
- grant bypass only to the reducer GitHub App and repository emergency owner.

Do not grant bypass to GitHub Actions generally. The reducer App is the only
machine identity allowed to append canonical commits.

After the App, secrets, and branch rules are verified, create this Actions
repository variable:

```text
REDUCER_ENABLED=true
```

Until that variable exists, candidate PRs are validated but never mutate the
world.

## 5. Candidate abuse controls

The beta workflow enforces:

- one globally running verifier and at most one pending run;
- cheap identity, path, size, replay, and duplicate admission before a verifier
  image is built;
- only the oldest open expedition PR per identity is admitted;
- at most six verifier starts per identity per hour;
- at most three per day before a first accepted expedition;
- at most thirty per day after a first accepted expedition;
- one added candidate file, 256 KiB, and 4,096 route samples;
- a four-second, 256 MiB, one-CPU, network-disabled Docker sandbox;
- a second replay against current canonical state in the serialized reducer.

GitHub identities are not proof of unique humans. If abuse becomes material,
disable `REDUCER_ENABLED` first; public verification can stay online while the
queue is moved behind a dedicated GitHub App service.

## 6. Cloudflare Pages and R2

Use one Pages project for the static observatory and one R2 bucket for the
small mutable read model and later immutable artifacts.

Suggested names:

```text
Pages project: alter-everest
R2 bucket: alter-everest-world
```

The current site fetches `/runtime-config.json`, then polls
`<worldBaseUrl>/latest.json`. Set `worldBaseUrl` to the public R2 custom domain
once the bucket exists. Configure R2 CORS to allow `GET` and `HEAD` from the
production site origin.

Add Actions secrets:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_PAGES_API_TOKEN
CLOUDFLARE_R2_API_TOKEN
```

The Pages token needs Pages edit permission. The R2 token needs object
read/write access only to the world bucket. Add repository variables:

```text
WORLD_BUCKET=alter-everest-world
R2_PUBLISH_ENABLED=true
CLOUDFLARE_PAGES_PROJECT=alter-everest
CLOUDFLARE_DEPLOY_ENABLED=true
SITE_ORIGIN=https://your-production-domain.example
WORLD_BASE_URL=https://world.your-production-domain.example
```

Every accepted expedition then updates `world/latest.json` without requiring a
site deployment. Historical proofs, traces, terrain tiles, and snapshots can
move to immutable content-addressed R2 keys without changing the browser API.

The reducer builds an exact publish manifest for the accepted candidate,
uploads immutable content-addressed objects first, and advances
`world/latest.json` last. If publishing fails after the Git commit, run
`Reconcile R2 world mirror`; it recreates the mirror from protected canonical
Git data. R2 is a disposable delivery mirror, never canonical authority.

Use a custom domain for production R2 traffic. Configure cache rules so
content-addressed keys are immutable and `world/latest.json` has a short edge
TTL. The `r2.dev` development hostname is not a production origin.

## 7. Launch and rollback

Before launch:

1. Run `npm test`.
2. Open an infra PR and verify that Code Owner review is required.
3. Open a valid candidate PR and confirm that it is closed, not merged.
4. Verify one new event, proof, receipt, snapshot sequence, and signed key ID.
5. Re-submit the same dispatch and confirm that reduction is idempotent.
6. Open a stale conflicting candidate and confirm `STALE_CONFLICT`.
7. Fetch the observatory in a clean browser and confirm the real latest trace.

Emergency stop:

1. Set `REDUCER_ENABLED=false`.
2. Revoke or uninstall the reducer App if canonical writes are suspect.
3. Rotate the verifier key if signatures are suspect.
4. Restore the last verified snapshot and replay subsequent signed events.

Never rewrite accepted event history to hide an incident. Append a corrective
event and publish an incident note.
