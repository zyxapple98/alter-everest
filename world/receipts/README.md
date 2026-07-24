# Verifier receipts

The trusted reducer writes one receipt for every canonical expedition event.
A production receipt is signed with the active Ed25519 verifier key and binds
the candidate, canonical parent, terrain, engine, and result.

Private signing keys never belong in this repository.
