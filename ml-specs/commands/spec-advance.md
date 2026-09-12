---
description: Advance a spec's lifecycle status (Draft → Approved → Implemented → Verified → Archived) — each transition gated on real evidence, archives merged specs
argument-hint: <path to spec file> [target status] — e.g. specs/0001-foo.md Verified
model: sonnet
---

Spec: **$ARGUMENTS** (path, then optionally the target status — if no status is given, advance to
the next one in the lifecycle).

This is the **only** command that writes a spec's Status. It exists because a status is a claim
about reality, and a claim nobody checks is worth nothing: `Verified` must mean the suite actually
ran green, not that an agent felt done.

## What you may edit

The spec's **header table** (Status, Branch, Date), its **Revisions** table, and its
**acceptance-criteria checkboxes** — nothing else. Never touch code, never commit, never edit
another spec.

## Procedure

1. Read the spec. Record its current Status and the current branch
   (`git rev-parse --abbrev-ref HEAD`). Determine the target status: the argument if given,
   otherwise the next one in `Draft → Approved → Implemented → Verified → Archived`.

2. **Run the mechanical half of the gate first:**

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-gate.mjs <spec-file> --to <target>
   ```

   It checks exactly what a script can check exactly: lifecycle ordering, leftover `<placeholder>`
   text, whether every acceptance criterion is ticked, whether **every test file named in the §6
   table actually exists on disk**, and whether the recorded branch is merged. It prints `PASS` /
   `FAIL` / `MANUAL` per gate and exits non-zero on any `FAIL`. Trust its `FAIL`s — do not re-derive
   them by hand, and do not argue with them.

3. **Then judge the `MANUAL` gates yourself — below. Gather that evidence yourself; do not take the
   user's or another agent's word for it.** These are the ones no script can settle: whether the
   human approved in this conversation, whether a §8 question is blocking, whether `/ml-specs:spec-verify`
   was clean, and whether the §6.1 suite actually ran green.

   For the `Verified` gate, one of those is now mechanical too — call **`verify_evidence`** on the
   `ml-skills` MCP server with `base` set to the branch this work forked from, and read its
   `verdict` rather than re-deriving one. It already draws the distinction this transition turns
   on: `fail` blocks, `pass` clears, `partial` means a requested checker never ran, and
   **`inconclusive` means clean but nothing was ratified, so nothing could have failed**. Only
   `pass` clears this gate on its own; on `partial` or `inconclusive`, record the transition only
   with the gap stated in the same breath. Fall back to `npx @mlmcps/ml-skills check . --json` (or
   `check_repo`) if the tool is unavailable: there, `summary.errors` must be 0 and
   `summary.proposedSkills` names the standards that were **incapable** of failing. If most
   standards are unratified, say so when you record the
   the person reading the status later deserves to know which one they are getting.

   If ml-skills is not installed, that gate is **unavailable**, not passed. Record it as such.

4. **If the evidence isn't there, do not write the status.** Report exactly which gate failed, what
   is missing, and the one command that produces it. A refused transition is a successful run of
   this command.

5. If it passes: update Status, set/refresh the **Branch** row from the current branch, update the
   **Date**, and tick any acceptance criteria you confirmed. Report the transition in one line.

## The gates

| Transition | Required evidence |
|---|---|
| `Draft` → `Approved` | The human approves **in this conversation** — ask if they haven't. Section 8 holds no blocking questions (an answer that would change an API shape, data model, error code, scope boundary, or compatibility). No `<placeholder>` text left in filled sections. If the spec hasn't had an adversarial pass, run `/ml-specs:spec-review` first. |
| `Approved` → `Implemented` | Every acceptance criterion is checked, and each row of the §6 test-plan table names a test file/method that **exists on disk** — `spec-gate.mjs` checks both; a named-but-missing test is the most common lie here. Normally `/ml-specs:spec-build` makes this transition itself. |
| `Implemented` → `Verified` | A clean **`/ml-specs:spec-verify`** — the `reviewer` agent marked every criterion satisfied, with a functional/E2E test for each user-facing or contract-level one — **and** the §6.1 full suite green end to end, **and** no new error-severity finding from the architecture standards (`ml-skills check`, if the repo has a `.mlskills.json`). If any of those did not happen in this session, run them now; if a suite or the standards check can't be run here, say so and refuse the transition. Never set `Verified` on assertion. |
| `Verified` → `Archived` | The spec's branch is merged into the default branch — `spec-gate.mjs` checks `git branch --merged`; if the PR merged but the local branch is behind, fetch first rather than overriding it. Then `git mv` the file to `specs/archive/NNNN-slug.md` — keep the number, create `specs/archive/` if absent — and fix any relative links that pointed at it. Numbers are never reused. |

**Moving backwards** (e.g. `Implemented` → `Draft` because the contract changed) is allowed and
sometimes correct. It needs no evidence gate, but it **must** add a **Revisions** row saying what
changed and why, and it un-ticks the acceptance criteria that no longer hold.

**Skipping a status** is not allowed — run the gates in order. If the user asks to jump straight to
`Verified`, walk each intervening gate and report the first one that fails.

Next step after a successful transition: `Approved` → `/ml-specs:spec-build <spec-file>` ·
`Implemented` → `/ml-specs:spec-verify <spec-file>` · `Verified` → `/ml-specs:pr <spec-file>` · `Archived` → done.
