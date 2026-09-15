# The SDD agent team

Spec-driven development as a team of subagents, mapped to the loop:

| Agent | Phase | Command | Tools | Job |
|-------|-------|---------|-------|-----|
| `analyst` | ANALYZE | `/ml-specs:spec-explore` | read-only + Bash | Ticket or half-formed idea → a reviewable note under `specs/`: what exists, what it touches, two or three approaches with their trade-offs and one recommended, and the blocking contract questions. Compares rather than commits — no spec, no code, and it **reports** those questions rather than asking them. |
| `spec-author` | SPECIFY | `/ml-specs:spec` | read + Write | Ticket → reviewable spec under `specs/`. No code. Stops and returns blocking contract questions rather than guessing them. |
| `spec-reviewer` | SPECIFY | `/ml-specs:spec-review` | read-only + Bash | Adversarially checks the **draft spec** before a human reads it — contracts, testable criteria, ripple. Fresh context, so it sees what the author can't. |
| `developer` | IMPLEMENT | `/ml-specs:spec-build` | read + Edit/Write + Bash | Builds ONE approved spec, test-first. |
| `reviewer` | VERIFY | `/ml-specs:spec-verify` | read-only + Bash | Adversarially checks the impl against the spec's acceptance criteria; runs the final-acceptance suite. |
| `pr-author` | VERIFY | `/ml-specs:pr` | read-only + Bash | Completed spec + diff → PR title/body with the criteria as a checklist. |

The two reviewers are deliberately separate: `spec-reviewer` reviews the **paper** (before code
exists, where a fix is a sentence), `reviewer` reviews the **code** against that paper.

Definitions live in `.claude/agents/`. Invoke one by asking for it ("use the developer
agent to build specs/0001-…"), or let Claude pick by description.

## "Three developers working" = parallel implement, isolated

The team had three developers building features concurrently. To mirror that, run **three
`developer` agents in parallel — one spec each — and give each its own git worktree**
so their edits never collide:

```
   ┌─ spec-author  →  specs/0001-a.md ─┐
   ├─ spec-author  →  specs/0002-b.md ─┤   (human reviews/approves the specs)
   └─ spec-author  →  specs/0003-c.md ─┘
                  │  approved
                  ▼
   ┌─ developer  (worktree A)  builds 0001 ─┐
   ├─ developer  (worktree B)  builds 0002 ─┤   run concurrently
   └─ developer  (worktree C)  builds 0003 ─┘
                  │  each returns diff + test results
                  ▼
   ┌─ reviewer  verifies 0001 ─┐
   ├─ reviewer  verifies 0002 ─┤   verify per spec
   └─ reviewer  verifies 0003 ─┘
                  │
                  ▼   human merges the approved branches
```

### Why worktree isolation matters
Three agents editing the same checkout would clobber each other. Each `developer` runs
in its own git worktree (a separate working copy on its own branch), so the three streams
are independent and merge cleanly — exactly like three developers on three branches.

**Important:** parallelize across *independent* specs. If two specs touch the same files
(e.g. both edit `CouponService`), sequence them instead — paper conflicts are cheaper than
merge conflicts.

## How to kick it off
- One ticket: `/ml-specs:spec DLA-1234 …` → review → `/ml-specs:spec-advance … Approved` → `/ml-specs:spec-build specs/NNNN-….md`
  → `/ml-specs:spec-verify` → `/ml-specs:pr`.
- A batch (the 3-developer pattern): ask Claude to "spec these 3 tickets, then build them in
  parallel with isolated worktrees, then review each against its spec." Claude orchestrates
  the fan-out. For larger batches this is worth running as a structured multi-agent workflow.
