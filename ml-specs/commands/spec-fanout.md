---
description: One spec, N repos, N pull requests — find who else a contract change breaks, then open a branch and PR in each, all carrying the same key
argument-hint: `<spec-id> <contract...>` — e.g. `0031 payment.captured "POST /payments/{id}/capture"` · add `--dry-run` to read the requests first
model: sonnet
---

Fan a spec out across the services it actually touches: **$ARGUMENTS**

A change spanning four services is four pull requests that a reviewer correlates
by hand and hopes they got right. Every branch here is the same derived name, so
the four are provably one change — and the impact query finds the service one hop
out that nobody remembered.

## 1. Plan before you open anything

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-fanout.mjs <spec-id> <contract...> --plan
```

That reads `docs/ESTATE.md` and prints the targets with a reason each: named on
the spec, consumes a changed contract, or one hop further out. It opens nothing.

**Stop and show the user this plan.** Two things are worth their attention before
anything is created:

- **A repo they did not expect.** That is the query doing its job, and it is also
  the most common moment to discover the estate index is stale. If a name looks
  wrong, run `/ml-specs:repo-estate` before fanning out — a stale graph reports confidently
  that nothing else breaks, which is worse than no graph.
- **A repo missing that they did expect.** Same cause, opposite symptom.

## 2. Dry run

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-fanout.mjs <spec-id> <contract...> --dry-run
```

Prints the exact branch-creation and pull-request calls that would be sent, and
sends none of them. This is what you hand to whoever owns the organisation when
asking for a token.

## 3. Open them

Drop `--dry-run` once the user has agreed to the plan. Credentials come from the
environment (`ADO_ORG`/`ADO_PROJECT`/`ADO_PAT`, or `GITHUB_OWNER`/`GITHUB_TOKEN`
with `SDD_SCM_TOOL=github`) — never from a file in the repo.

## What can go wrong, and what to say

- **`spec … is Draft; no branch is cut before the approval gate`** — correct
  behaviour, not a bug. The contract is still being negotiated. Point at
  `/ml-specs:spec-advance`.
- **Some repos opened, some failed.** Expected and reported, never thrown: a
  permissions error on the fourth repo must not hide that three succeeded. Report
  which failed and why. Re-running is safe for the ones that worked only if their
  branches do not already exist — say so rather than guessing.
- **`branches diverged — not one change`** — the fan-out lost its shared name.
  That defeats the whole point; stop and investigate rather than merging.

## Close

Tell the user the branch name, how many pull requests are open, and that each
body carries the acceptance criteria as a reviewer checklist. If any repo failed,
lead with that.
