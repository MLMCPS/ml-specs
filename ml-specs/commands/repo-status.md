---
description: Dashboard of the specs under specs/ — lifecycle status, acceptance-criteria progress, and branch — read-only, summarizes rather than dumping
argument-hint: (no args) for the default view · `all` for every row · a status (e.g. `Draft`) to filter
model: haiku
---

Give the user a read-only view of **what's in flight**. Do NOT edit anything.

Filter/mode: **$ARGUMENTS**

## Get the data cheaply

If this repo has the toolkit's MCP server wired up, call **`spec_list`** — it parses every spec
locally and returns structured data, which is far cheaper than reading the files into context.
Otherwise read `specs/NNNN-*.md` headers yourself (ignore `README.md`, `TEMPLATE.md`, `AGENTS.md`;
`specs/archive/` is a count, not rows).

Per spec: number & slug, Status, acceptance criteria checked/total, and Branch — the header's
**Branch** row if present, else a best-effort match against `git branch --all` shown with `?` to
mark it a guess.

## Choose the view by size — this matters

A mature repo can hold **hundreds** of specs. Rendering every row is unreadable and expensive, and
it buries the handful of things that actually need a decision.

- **≤ 25 specs, or the user asked for `all`** → the full table, sorted by number:

  | Spec | Status | AC | Branch |
  |------|--------|----|--------|
  | 0001-add-coupon-expiry | Implemented | 4/4 | feat/0001-coupon-expiry |

- **More than that** → **summarize, don't dump.** Lead with counts by status and overall
  acceptance-criteria completion, then table **only the specs that need attention** (below).
  Say how many rows you're not showing and how to see them (`/ml-specs:repo-status all`, or
  `/ml-specs:repo-status Draft` to filter).

## Needs attention

This is the actual output — the rest is context. Table only these:

- `Implemented` with unchecked criteria, or a §6 test named that doesn't exist on disk.
- `Draft`/`Approved` with no branch (nothing started), or a branch with `Draft` status (work
  started before the contract was agreed).
- `Verified` whose branch is already merged → should be `/ml-specs:spec-advance … Archived`.
- **A Status that isn't one of `Draft`/`Approved`/`Implemented`/`Verified`/`Archived`** — free-text
  prose in that field means `/ml-specs:spec-advance` and `spec_list` can't read it. Report the count; if it's
  more than a few, point at `scripts/fix-specs.mjs`, which normalizes them in one pass and preserves
  the prose.
- **Duplicate spec numbers** — two files sharing an id is a merge hazard. Same script repairs it.

## Close

End with the single most useful next action for whatever is most in-flight — `/ml-specs:spec-review` a draft,
`/ml-specs:spec-advance` an approved-in-conversation one, `/ml-specs:spec-build` an `Approved` one, `/ml-specs:spec-verify` an
`Implemented` one, `/ml-specs:pr` a `Verified` one, `/ml-specs:spec-advance … Archived` a merged one. One line, not a
menu.

Read-only. Every status *write* goes through `/ml-specs:spec-advance`, never this command.
