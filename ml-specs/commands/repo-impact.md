---
description: Find which other services a change breaks — detects modified published contracts and looks up their consumers in docs/ESTATE.md
argument-hint: <spec file> to check a spec's ripple, or (no args) to analyse the current branch diff
model: sonnet
---

Target: **$ARGUMENTS** (a spec file, or the current branch diff if empty).

You are answering one question: **who else breaks if this ships?** Read-only — report, don't fix.

This is the failure an estate actually dies of. A change that is correct inside its own repo and
still takes down a consumer is not caught by tests, `/code-review`, or `/ml-specs:spec-verify`, because every
one of those looks only at this repo.

## Step 0 — establish whether you can answer at all

Read `docs/ESTATE.md`. **If it's missing, or its contract index is mostly `_TBD_`, stop and say so
plainly**: you cannot distinguish "no consumers" from "no index". Recommend `/ml-specs:repo-estate`, and do
not produce a clean bill of health — a false "nothing affected" here is worse than no answer,
because it gets believed.

Note which rows are marked `(inferred)`: those were never confirmed against the peer's real code, so
any conclusion resting on them is a hypothesis, and must be labelled as one in your report.

If this repo has the toolkit's MCP server wired up, `estate_lookup` answers step 2 directly and
returns which rows are unconfirmed — use it rather than re-parsing the tables by hand.

## Step 1 — find the contracts this change touches

From the diff (`git diff "$(git merge-base HEAD @{u} 2>/dev/null || echo HEAD~1)"...HEAD`) or from
the spec's §4, identify changes to anything **someone else can observe**:

- **Published event / message payloads** — a field removed or renamed, a type narrowed, a new
  required field, a changed routing/topic name, changed ordering or idempotency assumptions.
- **API responses and requests** — a field removed or renamed, a type change, a new required
  request field, a changed status code, a changed error shape, a new auth requirement.
- **Shared data** — a table/collection another service reads, a column dropped or renamed, a
  changed constraint or index another service's queries depend on.
- **Published packages/types** — a shared library's exported signature.

Purely internal changes (private helpers, tests, this service's own storage that nobody else reads)
have no ripple. Say that and stop — most changes are this, and inventing ripple is its own failure.

## Step 2 — resolve the consumers

For each touched contract, find it in the `docs/ESTATE.md` contract index and list the services on
the other side. For each consumer, classify the change:

| Class | Meaning | What it forces |
|---|---|---|
| **Additive** | New optional field, new endpoint, new event type | Nothing — deploy in any order |
| **Compatible-with-sequence** | Consumer must handle both shapes first | A deploy order, and a spec that names it |
| **Breaking** | Consumer breaks the moment this ships | A migration path: dual-write/dual-read, version the contract, or coordinate a release |

Assume **something you don't control is already calling this**. In-flight messages and old clients
outlive a deploy; a change that is safe only if every consumer upgrades simultaneously is breaking.

## Step 3 — check the spec covers it (when given a spec)

The spec's **§7 Rollout & risks** must name each affected consumer and the deploy order, and §4.3 /
§4.4 must describe the contract on both sides. If it doesn't, that's the finding: the ripple was
designed but not written down, and the person deploying won't know.

## Report

- **Contracts touched** — each with `file:line` and its class (additive / sequenced / breaking).
- **Consumers affected** — service, what it consumes, and whether the estate row was confirmed or
  `(inferred)`.
- **Required deploy order** — as a numbered sequence that is safe at every intermediate step
  (usually: consumers accept both shapes → producer changes → old path removed later).
- **Unresolvable** — contracts you could not find a consumer for, and whether that means "nobody
  consumes it" or "the index doesn't know". Never merge those two.
- **Spec gaps** — what §7 needs to say and doesn't.

Next: put any breaking finding into the spec (§4 contracts, §7 rollout) via a **Revisions** row
before building, or — if the code is already written — treat it as a spec gap in `/ml-specs:spec-verify` and
resolve it with the user before `/ml-specs:pr`.
