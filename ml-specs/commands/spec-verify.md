---
description: Adversarially verify an implemented change against its spec's acceptance criteria, and run the final-acceptance suite — read-only, decides whether the spec can be Verified
argument-hint: <path to spec file, e.g. specs/0001-foo.md>
---

Spec: **$ARGUMENTS**

You are in the **VERIFY** phase of spec-driven development. This command is **read-only** — it
judges the implementation, it does NOT fix it.

Use the **reviewer** agent to review the current branch/diff against this spec, and use the
**security-reviewer** agent to review the same diff for security regressions. Both run with fresh
context, so they judge the code against the written contract rather than against the intent of
whoever wrote it.

Dispatch both agents **in a single message** so they run concurrently — they are read-only and
share no state, so the security review costs no extra wall-clock time. **Run both every time**,
on every change, with no precondition on the diff looking security-relevant. Whether a change
moves a trust boundary is the finding, not the entry criterion — a security review gated on
somebody already suspecting the answer is the conditional built-in `/security-review` habit this
replaces, and it catches nothing new.

This is not a substitute for `/code-review` — they answer different questions and you want all three:

| | Question it answers |
|---|---|
| `/ml-specs:spec-verify` (this) | Does the implementation satisfy **this spec's** acceptance criteria, each with a test that would fail on regression? |
| `/code-review` (built-in) | Is the **diff** itself correct — bugs, edge cases, simplifications — regardless of any spec? |
| `security-reviewer` (this) | Does this change **move a trust boundary** — authorization, tenant isolation, data exposure, injection, secrets — whether or not any criterion mentions it? |

**If the change touches a published contract** (an event payload, an API request/response shape,
shared data, an exported package type), also run `/ml-specs:repo-impact <spec-file>` — neither this review nor
`/code-review` looks outside this repo, so a change that breaks a consumer passes both cleanly.

Relay both agents' verdicts without softening them:
- The **per-acceptance-criterion table**: satisfied / not satisfied / **untested** (implemented but
  with no test that would fail if the behavior regressed, or a user-facing criterion covered only
  by a unit test with no functional/E2E test).
- The **must-fix list**, each with `file:line`.
- The **final-acceptance result** (spec §6.1) — the real command and its real output. If the suite
  could not be run, say so explicitly; never report an unrun suite as green.
- The **architecture standards result** — unless `.ml-specs.json` at the repo root sets
  `"mlSkills": "off"`, in which case omit this bullet completely rather than reporting it as
  unavailable. Any other state — no file, no key, unreadable JSON, unrecognised value — is `auto`,
  the behaviour below; fail open, never silently into `off`. Otherwise, from **`verify_evidence`**
  on the `ml-skills` MCP server,
  with `base` set to the branch this work forked from so findings are scoped to what this change
  actually touched. Report its `verdict` verbatim: `fail`, `pass`, `partial`, or `inconclusive`.
  **`inconclusive` means clean but nothing was ratified, so nothing could have failed — it is not a
  pass**, and rounding it to one is how a gate goes decorative without anyone noticing. Findings in
  files this diff did not touch are pre-existing, not this change's problem — say so rather than
  turning the review into a cleanup project. If ml-skills is not installed, report the standards
  verdict as **unavailable**; an unrun check is not a clean one.
- The **security verdict** — from the `security-reviewer` agent, verbatim as one of exactly three
  words: `blocked`, `inconclusive`, or `clear`. Report it with the findings (severity, `file:line`,
  the reachable entry point) and the **"not assessed"** list of trust boundaries it could not reach.
  **`inconclusive` means clean but a boundary the diff crosses could not be assessed from this repo
  — it is not `clear`**, and softening it into one is the failure mode here, exactly as it is for
  the standards verdict above. Cite credentials by `file:line` and pattern; never paste a secret's
  value into this report.

Then split the must-fixes into two groups and act:
1. **Code fixes** — the implementation doesn't match the approved spec. Offer to fix them
   (`/ml-specs:spec-build` or the `coder` agent), then re-run this command.
2. **Spec gaps** — the code is right and the *spec* is wrong or silent. That is a contract change:
   put it to the user with the AskUserQuestion tool as concrete options with a recommendation.
   Update the spec (with a **Revisions** row) before touching code. Never quietly widen the spec to
   match what was built.

Next step:
- **Clean** (every criterion satisfied, functional/E2E present for the user-facing ones, full suite
  green, no new error-severity standards finding — *unless `.ml-specs.json` sets `"mlSkills": "off"`,
  in which case that clause does not apply at all* — **and the security verdict is `clear`**) →
  `/ml-specs:spec-advance <spec-file> Verified`, then `/ml-specs:pr <spec-file>`. Both `blocked` and `inconclusive`
  stop the `Verified` transition — `blocked` because there is a reachable finding, `inconclusive`
  because nobody knows whether there is one.
- **Not clean** → fix, then re-run `/ml-specs:spec-verify <spec-file>`. Do not advance the spec's status and
  do not open a PR on a failing verdict.
