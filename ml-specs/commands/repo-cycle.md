---
description: How long specs actually take, from the timestamps the evidence records already carry — read-only, and never keyed to a person
argument-hint: (no args) for the report · `--json` for the payload
model: haiku
---

Mode: **$ARGUMENTS**

Show the user **where time goes** in this repo's spec loop. Read-only. Writes nothing, gates
nothing.

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-cycle.mjs $ARGUMENTS
```

## Report the excluded count beside the numbers, every time

This is the one thing not to soften. The report measures only specs that carry evidence records,
and every average is over those. Specs with no record are excluded and counted separately — they
predate evidence recording, or were never gated. Quoting a median without saying how many specs it
left out settles an argument dishonestly, and draft `0020` exists because somebody said this loop
is slow.

If most specs are excluded, say that first. A median over 13 of 61 specs is a different claim from
a median over 61.

## What the numbers mean, and do not

- **Time in a status** is when somebody got round to running the next command, not when the work
  finished. Whole days, because an hour-level number implies a precision this data does not have.
- **Review rounds** come from each spec's `Revisions` table — the real cost of getting a contract
  agreed, and usually the more interesting number.
- **Out-of-order records** mean a re-record or a clock, not a spec that finished before it started.
  Say so if the report flags any.

## Never

Do not break any of this down by person, and do not offer to. Every evidence record carries a
signer, so it is one field away — and a cycle-time report keyed to people stops being honest the
week people notice. That is a permanent non-goal, not a missing feature.

Next: `/ml-specs:repo-status` for the board as it stands, or `/ml-specs:repo-doctor` if a number looks wrong.
