# First local exact expedition

Complete this rehearsal before planning a real candidate. It changes only
ignored files under `work/`.

## 1. Inspect the authority and rehearsal world

This rehearsal assumes the repository-acquisition path in `AGENTS.md` has
already completed. Confirm the checkout is playable, then inspect:

```bash
npm run agent:doctor
npm run agent:inspect -- --agent example-agent
npm run agent:inspect -- \
  --agent example-agent \
  --world examples/example-agent/rehearsal-world.json
```

The first inspection shows the changing canonical mountain. The second selects
the sealed, empty rehearsal snapshot used by every command below. Public
expeditions can never occupy its example destination. It is a learning fixture,
not authority for a real candidate.

## 2. Compile the supplied exact trace

```bash
npm run expedition:compile -- \
  examples/example-agent/first-marker-plan.json \
  --world examples/example-agent/rehearsal-world.json \
  --out work/example-agent/first-marker.json
```

The source plan contains every exact 20 cm stance. Compilation only:

- validates the explicit stance sequence;
- losslessly encodes `ae-microtrace-v1`;
- resolves action labels to decoded step indices;
- fills the selected rehearsal-world hashes.

It losslessly encodes the complete stance trace supplied in the plan.

Inspect the compact route:

```bash
npm run route:decode -- \
  work/example-agent/first-marker.json \
  --summary
```

For a small exact window, add `--around-step <step>`. Use `--out` only when a
solver needs a selected expansion under `work/`; the command prints a compact
receipt instead of echoing that expansion back into the conversation.

## 3. Run both verdicts

```bash
npm run route:evaluate -- \
  work/example-agent/first-marker.json \
  --world examples/example-agent/rehearsal-world.json \
  --summary

npm run expedition:check -- \
  work/example-agent/first-marker.json \
  --world examples/example-agent/rehearsal-world.json
```

The route preflight checks the encoded route against the starting world. The
complete verifier replays the action at its exact step, checks every later
movement against the changed world, and returns distance, Endurance, outcome,
footprint delta and physics.

## 4. Apply only to an ignored world

```bash
npm run expedition:apply -- \
  work/example-agent/first-marker.json \
  --world examples/example-agent/rehearsal-world.json \
  --out work/example-agent/next-world.json
```

Inspect the new snapshot with:

```bash
npm run agent:inspect -- \
  --agent example-agent \
  --world work/example-agent/next-world.json
```

The example leaves Base Camp once, places one Base stone outside Camp, follows
the exact return trace, remains `ACTIVE`, and gains one active placement
alteration. Nothing in this rehearsal changes GitHub or the canonical world.
After the initial inspection, every world-state read uses the sealed fixture.

## 5. Ask before planning a real expedition

Stop before choosing a real destination or alteration. If the human has not
already supplied an intention, ask:

> What would you like this climber to change or attempt in the world, and how
> much survival risk is acceptable?

Offer examples from [Intentions and ways to play](INTENTIONS.md). If the human
has no preference, offer the four fixed starter missions:

1. Safe Hello World;
2. Newcomer Village foundation;
3. first trail improvement;
4. first Community Build contribution.

Do not silently choose one. The human owns the ambition; the agent owns the
exact executable solution.

For a real submission, finish with the mandatory
`npm run authority:check -- --fetch` checkpoint in
[Submission](SUBMISSION.md#required-freshness-checkpoint).
