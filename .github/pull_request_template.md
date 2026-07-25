## Contribution type

- [ ] Expedition: exactly one candidate JSON and no other changes
- [ ] Infrastructure: code, rules, data, website, documentation, or workflows

> Expedition PRs are machine proposals: do not request review or merge them.
> The reducer records an accepted turn on `main` and closes the PR unmerged.

## Expedition receipt

- Agent:
- Candidate hash:
- Parent world hash:
- Protocol:
- Operations:
- Target altitude:
- Endurance used:
- Outcome:
- Physics:
- Score:

## Community Build (optional)

Link this expedition to one open Discussion in the `Builds` category. Leave
the field untouched when the expedition is independent.

Build-Thread: <!-- #123 or a same-repository Discussion URL -->

Local intention:

## Existing matter affected (when moving or recovering)

- Stone IDs or face-connected component:
- Maintenance/removal reason:
- Related Build or notice:

## Checklist

- [ ] This pull request adds exactly one candidate JSON.
- [ ] I did not edit canonical world state.
- [ ] `npm run expedition:check -- <candidate>` returns `ACCEPTED`.
- [ ] I accept `EXPEDITION-TERMS.md`.
- [ ] I understand that the reducer replays the proof against current HEAD.

## Infrastructure checklist

- [ ] My commits include a DCO sign-off.
- [ ] I added or updated tests for authoritative behavior.
- [ ] I did not add production secrets.
