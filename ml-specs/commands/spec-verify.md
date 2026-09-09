---
description: Adversarially verify an implemented change against its spec's acceptance criteria, and run the final-acceptance suite — read-only, decides whether the spec can be Verified
argument-hint: <path to spec file, e.g. specs/0001-foo.md>
---

Spec: **$ARGUMENTS**

You are in the **VERIFY** phase of spec-driven development. This command is **read-only** — it
judges the implementation, it does NOT fix it.

Use the **reviewer** agent to review the current branch/diff against this spec. It runs with
fresh context, so it judges the code against the written contract rather than against the intent
of whoever wrote it.

This is not a substitute for `/code-review` — they answer different questions and you want both:

| | Question it answers |
|---|---|
| `/spec-verify` (this) | Does the implementation satisfy **this spec's** acceptance criteria, each with a test that would fail on regression? |
| `/code-review` (built-in) | Is the **diff** itself correct — bugs, edge cases, simplifications — regardless of any spec? |

**If the change touches a published contract** (an event payload, an API request/response shape,
shared data, an exported package type), also run `/repo-impact <spec-file>` — neither this review nor
`/code-review` looks outside this repo, so a change that breaks a consumer passes both cleanly.

Relay the agent's verdict without softening it:
- The **per-acceptance-criterion table**: satisfied / not satisfied / **untested** (implemented but
  with no test that would fail if the behavior regressed, or a user-facing criterion covered only
  by a unit test with no functional/E2E test).
- The **must-fix list**, each with `file:line`.
- The **final-acceptance result** (spec §6.1) — the real command and its real output. If the suite
  could not be run, say so explicitly; never report an unrun suite as green.
- The **architecture standards result** — from **`verify_evidence`** on the `ml-skills` MCP server,
  with `base` set to the branch this work forked from so findings are scoped to what this change
  actually touched. Report its `verdict` verbatim: `fail`, `pass`, `partial`, or `inconclusive`.
  **`inconclusive` means clean but nothing was ratified, so nothing could have failed — it is not a
  pass**, and rounding it to one is how a gate goes decorative without anyone noticing. Findings in
  files this diff did not touch are pre-existing, not this change's problem — say so rather than
  turning the review into a cleanup project. If ml-skills is not installed, report the standards
  verdict as **unavailable**; an unrun check is not a clean one.

Then split the must-fixes into two groups and act:
1. **Code fixes** — the implementation doesn't match the approved spec. Offer to fix them
   (`/spec-build` or the `coder` agent), then re-run this command.
2. **Spec gaps** — the code is right and the *spec* is wrong or silent. That is a contract change:
   put it to the user with the AskUserQuestion tool as concrete options with a recommendation.
   Update the spec (with a **Revisions** row) before touching code. Never quietly widen the spec to
   match what was built.

Next step:
- **Clean** (every criterion satisfied, functional/E2E present for the user-facing ones, full suite
  green, no new error-severity standards finding) → `/spec-advance <spec-file> Verified`, then
  `/pr <spec-file>`.
- **Not clean** → fix, then re-run `/spec-verify <spec-file>`. Do not advance the spec's status and
  do not open a PR on a failing verdict.
