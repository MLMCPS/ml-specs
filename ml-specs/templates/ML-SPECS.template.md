---
name: ml-specs
description: The host-neutral spec-driven loop. Everything below is written to be true in any coding agent.
---

## What this is

Non-trivial changes start with a reviewable spec, not with code. A spec is a Markdown file under
`specs/`, numbered, with a Status that only the gate is allowed to change.

The point is not ceremony. It is that "done" should mean something a second person can check. A
status nobody verified is worth nothing, so every transition has evidence behind it and a command
that refuses the transition when the evidence is not there.

## The loop

| Step | What happens |
|---|---|
| 1. Specify | Write the spec. Problem, scope, the contract, acceptance criteria, a test plan. No code yet. |
| 2. Review | A human reads it and says yes. Anything that would change an interface, a data shape, an error code or a scope boundary is settled here, not later. |
| 3. Approve | The spec moves to `Approved`. Now the contract is fixed. |
| 4. Build | Implement strictly against the criteria, test-first. Anything not in the spec is out of scope — change the spec first, then the code. |
| 5. Verify | Judge the implementation against each criterion. Every user-facing one needs a test that would fail if the behaviour regressed. |
| 6. Ship | Open the pull request, merge it, archive the spec. |

Statuses run `Draft` → `Approved` → `Implemented` → `Verified` → `Archived`, in that order. Skipping
one is not allowed. Moving backwards is allowed and sometimes correct, but it has to say what
changed and why.

## The gates are a command

This is the part that makes the rest real. Run them and read the exit code.

```
gate <spec> [--to <Status>]
```

`0` means it may advance. `1` means something is genuinely wrong — a criterion unchecked, a test
file named in the plan that does not exist on disk, a placeholder nobody filled in. `2` means the
question could not be put at all, which is a different answer from a failure and is reported as
one.

Some gates a script cannot settle — whether a human really approved, whether the full suite really
ran green. Those report as needing judgement, and the honest thing is to judge them rather than
assume them.

```
evidence
```

Every transition leaves a record of what it read: the files, their checksums, the contract it was
measured against. This asks whether those records still describe the repository today. A spec can
show a clean `Verified` over a record that went stale a fortnight ago, and the status line alone
cannot tell you.

```
why <spec>
```

When something will not advance, this says which gate refused and what would satisfy it.

## Rules that hold everywhere

**Never report a gate as passed without running it.** The exit code is the evidence. A recollection
is not.

**Never invent a command result.** If a suite was not run, say it was not run and say why. Missing
evidence is never quietly upgraded into a pass.

**Never edit a spec's Status by hand.** One command writes it, and it writes it only when the
evidence is there. Editing the cell directly produces a claim with nothing behind it, which is the
exact failure this whole loop exists to prevent.

**A test that cannot fail is not a test.** When you add one, check it: break the thing it watches,
confirm that test and only that test goes red, then put it back. A criterion with a test that
passes either way is worse than a criterion with no test, because it reads as covered.

**Anything not in the approved spec is out of scope.** If you find a gap mid-build, stop and change
the spec. Widening the code quietly to match what you built is how the contract stops meaning
anything.

## Where things live

| Path | What |
|---|---|
| `specs/` | one Markdown file per change, numbered, never renumbered |
| `specs/archive/` | merged and done |
| `.ml-specs/evidence/` | one JSON record per transition — what the gate read, and when |
| `.ml-specs.json` | configuration, read key by key |
