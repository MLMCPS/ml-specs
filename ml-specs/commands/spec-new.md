---
description: Scaffold the next spec — the number taken across every branch, the header filled, the body left for you to write
argument-hint: <slug, e.g. token-validator> · `--rigor light|standard|deep` · `--title "…"`
model: haiku
---

New spec: **$ARGUMENTS**

Scaffold a spec file. Do NOT write its contents — this creates the file and the header; the
sections are for the human, or for `/ml-specs:spec` if they want one drafted.

Run this once:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-new.mjs $ARGUMENTS
```

## Then say three things, and only these

**Where the number came from.** It is taken across **every branch this machine can see**, not just
the working tree — two people speccing in parallel otherwise both take the next one and collide at
merge. If the output carries a warning, relay it verbatim: a number derived without fetching a
remote can still collide, and a reader handed `0042` with no caveat has no way to know.

**That the rigor needs a reason.** `specs/TEMPLATE.md` requires one line in §1 saying why, and it
is sized by **uncertainty and blast radius, not diff size** — a five-line authorization change
outranks a five-hundred-line CRUD screen. An unstated `light` is indistinguishable at review from a
correct one, which is the whole reason the line is required.

**The next command.** `/ml-specs:spec-review <file>` once there is something to review.

## What not to do

Do not fill the body. The template's prompts are the point of having a template, and pre-filling
them with plausible text is how a spec gets written by autocomplete rather than by thinking.

Do not pick a number yourself if the script refuses. A refusal is a successful run — it means the
slug is unusable or that number is taken.

Next: `/ml-specs:spec` to draft the contents, or `/ml-specs:spec-review` when there is something to read.
