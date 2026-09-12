---
description: Implement a feature strictly against an approved spec, test-first
argument-hint: <path to spec file, e.g. specs/0001-foo.md> — or several, to build in parallel
---

You are in the **IMPLEMENT** phase of spec-driven development.

Spec: **$ARGUMENTS**

The spec is the contract. Anything not in it is out of scope — if a gap surfaces, the spec gets
updated first, then the code. Never the other way round.

Steps:

1. **Read the spec in full**, plus `CLAUDE.md` and `docs/PATTERNS.md`, and detect the stack (any
   language) from the manifest/build file. Check its Status is `Approved` — if it's still `Draft`,
   say so and stop; building an unapproved contract is how rework happens.

   Note the difference between the two knowledge sources the agent will use: `docs/PATTERNS.md`
   **describes** how this repo happens to write code, and the architecture standards
   (`.mlskills.json` + the `ml-skills` server) **prescribe** how it must. When they disagree, the
   doc is the one that is out of date — the developer agent is told to flag the divergence rather
   than copy local style, and that flag is a finding for you to relay, not noise to suppress.

2. **Resolve gaps before delegating.** If something the implementation needs isn't in the spec,
   STOP and put it to the user with the AskUserQuestion tool as concrete options with a
   recommendation. Update the spec (with a **Revisions** row) before any code is written. Do this
   here, in the main thread — a subagent has no channel to the human, so an unresolved gap becomes
   a guess the moment you hand off.

3. **Present a short implementation plan** (plan mode) and get approval before any edits.

4. Use the **developer** agent to implement it — one agent per spec. Give it the spec path
   and the approved plan; its own instructions carry the discipline (test per acceptance criterion,
   a functional/E2E test for every user-facing or contract-level one, targeted tests during the
   loop, the full final-acceptance suite once at the end, real results only). Don't restate those
   rules — and don't implement inline instead, or the work silently loses the agent's guarantees.

   **Several specs at once?** Spawn one `developer` per spec, each in **its own git worktree**,
   and run them concurrently — that's the three-developers pattern in `specs/AGENTS.md`. Only do
   this for specs that don't touch the same files; sequence coupled ones instead, because paper
   conflicts are cheaper than merge conflicts.

5. **Relay what the agent returns, unsoftened** — the file list, the real test output, and anything
   it flagged as wrong in the spec. If it reports a failing suite, report the failure; never
   convert "it built" into "it works". If it surfaced a spec gap, go back to step 2.

6. **Advance the spec:** `/ml-specs:spec-advance <spec-file> Implemented` — that command re-checks each
   criterion's named test actually exists and records the branch, so the status is evidence-backed
   rather than self-declared.

7. **Then the VERIFY phase, in this order:**
   - `/ml-specs:spec-verify <spec-file>` — the `reviewer` agent judges the implementation against the
     spec's acceptance criteria and runs the final-acceptance suite. This is the gate for
     `Verified`; do not set that status yourself.
   - `/code-review` (and `/security-review` if auth/data exposure is involved) — these check the
     diff for bugs, a different question from "does it match the spec". Run both.
   - `/ml-specs:spec-advance <spec-file> Verified` once they're clean, then `/ml-specs:pr <spec-file>` for the PR text.

Keep the spec in the same branch/PR as the implementation, follow the repo's branch-naming and
commit conventions, and only commit/push when the human asks.

When you do commit, the message names the humans who own the change and nothing else — no
`Co-Authored-By:` line for an assistant, no "Generated with"/"Made with" line, no model or vendor
name, no tool badge or emoji. This applies to every commit on the branch: a squash merge aggregates
trailers from all of them, so one stray line resurfaces on the merge commit.
