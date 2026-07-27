# Security policy

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could modify the canonical
world, bypass expedition validation, expose a credential, or execute code in a
privileged workflow.

Use the repository's private GitHub security advisory form. Include:

- the affected commit and protocol version;
- a minimal reproduction;
- the expected and observed trust boundary;
- whether a secret, canonical write, or verifier identity may be affected.

Do not test against the production world or other contributors' identities.

## Supported version

Only the protocol release described by `protocol/release.json` on the protected
default branch is supported. Canonical event records are append-only.

## Public threat model

The complete authority model and launch assumptions are documented in
[`docs/SECURITY-MODEL.md`](docs/SECURITY-MODEL.md).
