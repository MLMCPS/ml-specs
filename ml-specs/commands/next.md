---
description: The one thing to do next, or the command you did not know to type — read-only and advisory, it prints a command and never runs one
argument-hint: (no args) for the board · a spec path for one spec · `--route "<what you want to do>"`
model: haiku
---

Mode: **$ARGUMENTS**

Answer the question the user actually came with — *which command do I run* — in one line, with the
reason it is the answer. Read-only. This prints a command; it never runs one.

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-next.mjs $ARGUMENTS
```

## Relay the reason, not just the command

Every answer carries the artifact it came from — a Status cell, or an evidence record. Pass that
through. "Run `/ml-specs:spec-verify`" is a suggestion the user either trusts or does not; "run
`/ml-specs:spec-verify`, because that spec's Status cell reads `Implemented`" is one they can
argue with, and a confident wrong suggestion with no derivation is worse than none.

If the verb reports a runner-up or a tie, say so. Six specs equally ready is a fact about the board
the user should hear, not something to quietly pick from.

## Do not run what it names

This is navigation, and navigation is never consent — the same rule the six loop commands follow
for their closing options. Offer the command it found as the next step; let the user take it.

The one exception to silence: if the answer is `/ml-specs:repo-doctor`, something on the board is
unreadable — a Status cell holding a value that is not a lifecycle status, or an evidence record
that no longer stands. Lead with that rather than with the suggestion.

## What it is not

It does not decide **who may** advance the loop, and it does not gate anything. It reads the board
and a table. If the user wants to know why a spec *cannot* move, that is the other question —
`spec-why.mjs` answers it, and `/ml-specs:spec-advance` is the thing that refuses.

Next: run whatever it named, or `/ml-specs:repo-status` for the whole board.
