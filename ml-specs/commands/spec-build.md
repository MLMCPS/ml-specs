---
description: Implement a feature strictly against an approved spec, test-first
argument-hint: <path to spec file, e.g. specs/0001-foo.md> — or several, to build in parallel
---

You are in the **IMPLEMENT** phase of spec-driven development.

Spec: **$ARGUMENTS**

The spec is the contract. Anything not in it is out of scope — if a gap surfaces, the spec gets
updated first, then the code. Never the other way round.

Steps:

0. **Resume, if there is something to resume from.** If `.claude/handoff/` exists, find the newest
   note whose `**Spec**` header row names *this* spec; if none names it, the newest unattributed
   one. `/ml-specs:handoff` writes one note per invocation, so the directory holds many notes for
   many specs and the newest overall is often about something else.

   **Apply the same 7-day window the `SessionStart` hook uses** (`ML_HANDOFF_MAX_AGE_DAYS`, default
   7, `${CLAUDE_PLUGIN_ROOT}/hooks/handoff-notice.sh`). A note the hook has already stopped
   surfacing must not become live context here: say in one line that a note exists but is older
   than the window, do not read it, and proceed from the spec.

   Within the window, read it **before** the spec. Its goal, status and proposed next action are
   **supporting context** — where the work stopped and what was already tried. The spec remains the
   contract: where the two disagree, the spec wins, and a note claiming something is done is a
   place to look, never evidence that it is. **A stale or absent note never authorises skipping
   work.** Say in one line which note you used, or that there was none, so the human can see which
   context you started from.

   Read only. `/ml-specs:handoff` owns these notes outright, exactly as `/ml-specs:spec-advance`
   owns a spec's `Status` — this command leaves the note exactly as it found it.

0b. **Read your own blocking conditions.** `${CLAUDE_PLUGIN_ROOT}/command-contracts.json` holds an
   entry for `spec-build.md`: `blockingConditions` is the list of situations in which you return
   control to the human rather than continuing, and `produces` is what this command leaves behind.
   When one of them holds, stop and **name the condition** — "returning control: `spec-gap`" — so
   the human knows which rule fired rather than inferring it from a paragraph of explanation.

   The conditions are written down in one file instead of scattered through 23 commands, and the
   validator checks only that the file's shape and names are sound. Honouring the meaning is this
   command's job: the list is not self-enforcing, and a condition nobody acts on is a comment.

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

**IMPLEMENT changes the working tree and nothing else.** No tracker transition, no comment on a
ticket, no remote PR opened, merged or closed, no rewriting of git history, no change to repository
configuration — branch protection, CI workflows, hooks, access. Not as a convenience, not because
the spec's `Ticket` row names an issue, not because it looks like the obvious next step. Each of
those is visible to people who are not in this conversation and cannot be undone by discarding a
diff, which is what separates them from editing a file. The human asks, or it does not happen.
`/ml-specs:pr-address` is the one documented carve-out, and it shows the full diff first.

When you do commit, the message names the humans who own the change and nothing else — no
`Co-Authored-By:` line for an assistant, no "Generated with"/"Made with" line, no model or vendor
name, no tool badge or emoji. This applies to every commit on the branch: a squash merge aggregates
trailers from all of them, so one stray line resurfaces on the merge commit.

Next step: `/ml-specs:spec-advance <spec-file> Implemented` (step 6), then
`/ml-specs:spec-verify <spec-file>` (step 7).

**Then offer those steps as actions.** Put them to the user with the AskUserQuestion tool —
`header: "Next step"`, `multiSelect: false`, one option per concrete command below, the one you
recommend **first** and its label suffixed `(Recommended)`, with the *why* and the cost in its
description:

- `/ml-specs:spec-advance <spec-file> Implemented` **(Recommended)** — the gate re-checks that
  every test the §6 table names exists on disk, so the status has evidence behind it.
- `/ml-specs:spec-verify <spec-file>` — the adversarial pass that gates `Verified`.

**If the agent reported a failing suite or a spec gap, the recommended option is the fix** — the
spec update, or another `/ml-specs:spec-build <spec-file>` — never the advance. Offering a
transition whose evidence you have just been told is missing is the opposite of what the gate is
for. **Given several specs**, the options name the *set* ("verify all four"), because that run has
no single next spec to advance.

**Navigation, not consent** — never offer a step already ruled out, and never ask permission for
something this command should simply do. **No double question:** if this run already stopped on a
blocking decision and that is the last thing the user answered, that decision *is* the close —
name
the next step in prose and stop. Neither the step-2 gap questions nor the step-3 plan approval is
that decision: both come before the work, not after it. **Only a command asks, never an agent** —
a subagent has no
channel to the human, so the `developer` agents spawned in step 4 never present these options,
whether one spec is building or four. The prose next-step line stays either way: it is what the
transcript keeps and all a non-interactive run emits.
