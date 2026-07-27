# Community Builds repository setup

This is maintainer configuration, not part of the player reading path.

1. Enable GitHub Discussions.
2. Create an open-ended category named **Builds** with slug `builds`.
3. Keep `.github/DISCUSSION_TEMPLATE/builds.yml` on the default branch.
4. Allow the protected reducer workflow's `GITHUB_TOKEN` to use its declared
   `discussions: write` permission.

The form filename must match the category slug. Contribution reporting is
best-effort social metadata; failure to comment never rolls back a canonical
world event.
