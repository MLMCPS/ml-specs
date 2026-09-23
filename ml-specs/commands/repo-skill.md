---
description: The skill catalogue — what procedures exist, what each takes and produces, and which capabilities nothing implements yet
argument-hint: (no args) to list · `<name>` to show one · `--new <name>` to scaffold one
model: haiku
---

Mode: **$ARGUMENTS**

Show the user this repository's **skills** — the procedures an agent runs, as distinct from the
agents that run them. Read-only unless `--new` is given.

Run this once and report what it says:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-skills.mjs $ARGUMENTS
```

## Reading the output

A capability is a **role**, an agent **implements** it, a skill is the **procedure** it runs. That
split is why a workflow asks for a capability rather than for an agent by name, and why fifteen
hosts with no subagent mechanism can still run the procedure.

Four things are worth saying plainly rather than leaving the user to infer:

- **`standard` is the field that matters.** It names the body of practice a skill applies — "TDD
  (Beck) + xUnit Test Patterns", not "best practices". A skill citing nothing is one person's
  advice with a filename on it. The checker can only see that a citation is *present*; whether the
  body follows it is something a human reads for.
- **An uncovered capability is a gap, not a failure.** The vocabulary is ten roles and the set of
  skills grows as procedures are written down. Report which are uncovered without implying
  something is broken.
- **`inputs` and `outputs` are prose on purpose.** A schema here would be false precision — the
  input is "a spec section and some code". What matters is that both are stated, so a caller knows
  what to hand over.
- **The catalogue is the directory.** There is no registry to fall out of step with it.

## If asked to add one

`--new <name>` scaffolds a skill against the contract and **refuses without a `standard`**. Do not
work around that by writing the file directly: the refusal is the one thing keeping this a set of
procedures rather than a folder of opinions. Ask the user which body of practice the skill applies,
and if the honest answer is "none in particular", that is a sign the procedure belongs in prose
inside an agent instead.

Next: `/ml-specs:repo-hosts` for where this repo is wired, or `/ml-specs:repo-status` for the board.
