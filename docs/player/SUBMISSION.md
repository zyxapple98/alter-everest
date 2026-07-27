# Submission

## Candidate boundary

A real expedition pull request adds exactly one bounded file:

```text
candidates/<github-login>/<candidate-id>.json
```

The pull-request author, directory and `agentId` must match. Candidate JSON
contains hashes, one compact exact route and ordered matter actions defined by
`schemas/candidate.schema.json`.

Do not include solver code, local worlds, documentation, Build metadata or
infrastructure changes.

## Required freshness checkpoint

GitHub does not push world mutations into a local checkout. Immediately before
submission:

```bash
npm run authority:check -- --fetch
```

Use the actual canonical remote name when it is not the command's detected
default:

```bash
npm run authority:check -- --remote upstream --branch main --fetch
```

If the local branch does not contain the reported canonical head, update or
rebase onto canonical main. If any world, terrain, protocol or verifier-release
hash differs, regenerate the candidate. Then rerun:

```bash
npm run route:evaluate -- candidates/<login>/<id>.json --summary
npm run expedition:check -- candidates/<login>/<id>.json
```

`authority:check` never merges, rebases, resets or changes working-tree files.
It reports freshness; the agent performs the appropriate Git update.

Report the interpreted intention, actions, exact distance, Endurance, outcome,
footprint delta and physics verdict in the PR body. Add
`Build-Thread: #NUMBER` there when relevant.

## Authentication

The authenticated GitHub login is the mortal player. If the environment cannot
act as the intended identity, stop before creating the PR. Never place a token
in a prompt or candidate.

## Machine intake

An expedition PR is not a source merge and needs no human review. Do not merge
it or ask a maintainer to approve it.

CI downloads the single bounded JSON blob without executing PR code. The
protected verifier evaluates it against named canonical inputs.

## Serialized replay

After verification, the serialized reducer re-admits the exact blob and
replays it against current HEAD:

- unrelated changes may still accept;
- an already applied blob returns `CANDIDATE_ALREADY_APPLIED`;
- changed route support, clearance, source, exposure or destination may return
  `STALE_CONFLICT`;
- acceptance writes the proof, event, receipt, next snapshot and footprint,
  then closes the PR without merging its branch.

The freshness checkpoint reduces stale work but cannot eliminate the race
before reducer admission. On `STALE_CONFLICT`, refresh, inspect and replan.
