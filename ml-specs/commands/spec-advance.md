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

The spec's **header table** (Branch, Date), its **Revisions** table, and its
**acceptance-criteria checkboxes** — nothing else. Never touch code, never commit, never edit
another spec.

**Not the Status cell.** `scripts/spec-advance.mjs` writes that, and only after the gate cleared
and you signed the judgement it could not make (step 5). Editing the cell by hand produces the
one thing this command exists to prevent: a status with no record behind it.

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

   For the `Verified` gate, one of those is now mechanical too — **but first read `.ml-specs.json`
   at the repo root.** If it sets `"mlSkills": "off"`, this gate does not apply: do not run the
   check, do not report it, and do not treat its absence as a gap. Skip to **Record it once**.
   Any other state — no file, no key, unreadable JSON, unrecognised value — is `auto`, and the rest
   of this paragraph applies; fail open, never silently into `off`.

   Otherwise — call **`verify_evidence`** on the
   `ml-skills` MCP server with `base` set to the branch this work forked from, and read its
   `verdict` rather than re-deriving one. It already draws the distinction this transition turns
   on: `fail` blocks, `pass` clears, `partial` means a requested checker never ran, and
   **`inconclusive` means clean but nothing was ratified, so nothing could have failed**. Only
   `pass` clears this gate on its own; on `partial` or `inconclusive`, record the transition only
   with the gap stated in the same breath. Fall back to `npx @mlmcps/ml-skills check . --json` (or
   `check_repo`) if the tool is unavailable: there, `summary.errors` must be 0 and
   `summary.proposedSkills` names the standards that were **incapable** of failing. If most
   standards are unratified, say so when you record the transition — a `pass` over ratified
   standards and a `pass` over none look identical in the status line, and the person reading it
   later deserves to know which one they are getting.

   If ml-skills is not installed, that gate is **unavailable**, not passed. Record it as such.

   A repo that has declared it does not use architecture standards is not missing evidence — which
   is why the `"mlSkills": "off"` check is the first thing this step does, not the last.

   **Record it once, though — only when the flag is `off`.** Write one line into the note:
   `architecture standards: out of scope per .ml-specs.json`. The per-review paragraph is the noise
   the flag removes; the permanent record is not. Without that line a reader of the archived spec
   cannot tell "checked, clean" from "opted out" — which is the `unavailable ≠ pass` failure this
   command exists to prevent, moved from the review into the record.

   Any state other than `"off"` — no file, no key, unreadable JSON, unrecognised value — is `auto`
   and the gate applies as written. Fail open, never silently into `off`.

4. **If the evidence isn't there, do not write the status.** Report exactly which gate failed, what
   is missing, and the one command that produces it. A refused transition is a successful run of
   this command.

5. **Write the status with the script — never by editing the table yourself:**

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-advance.mjs <spec-file> --to <target> \
     --attest "<what you judged, in your own words>"
   ```

   This sentence at the top of the file — *"the only command that writes a spec's Status"* — used
   to have nothing behind it. The gate reported and a model did the writing, so the rule was
   advice: the same model, the same repo, two runs, two outcomes, and no way to tell afterwards
   which had happened. The script refuses on any `FAIL`, refuses when a `MANUAL` gate is unsigned,
   and refuses an attestation under ten characters. It exits 1 on a refusal and 2 when it could
   not run at all.

   **`--run-suite` turns one of those judgements into a verdict.** Pass it and the gate runs the
   command §6.1 names, so `suite-green` becomes PASS or FAIL instead of something you vouch for.
   It is off by default because a gate that always costs minutes is one people route around —
   opt in where the suite is fast enough to afford it, and keep the honest MANUAL where it is
   not. A command that cannot be found or that times out reports as MANUAL, never as a red
   suite: sending somebody to debug tests that never ran is worse than saying so.

   **The command is printed to stderr before it runs, and you should read it.** §6.1 lives in a
   Markdown file somebody wrote, so passing this flag runs a command that spec chose. The gate
   refuses anything carrying a shell metacharacter beyond a conservative allowlist — `;`, `|`,
   `$`, a backtick, redirection, a lone `&`, a glob — and reports MANUAL naming the character,
   which means run the suite yourself and attest. `&&` and grouping are allowed, so a chain of
   commands is still possible: what the gate guarantees is that nothing runs unseen, not that a
   contributor cannot run code.

   **Do not wire `--run-suite` into CI on untrusted branches.** Every control here assumes a human
   reading a terminal: the command is disclosed on stderr, and the refusal tells that person to run
   it themselves. A workflow that passes this flag on pull-request content has neither — the §6.1
   command comes from the contributor who opened the PR, and nobody reads the disclosure. Run the
   suite in CI the way you normally would, with a command your workflow names, and leave this flag
   for interactive use.

   `--attest` is where step 3's judgement goes. Write what you actually checked, not "done" — the
   sentence is recorded against your git identity and read by whoever comes to this spec later.

   **`--unattended` when no human made that judgement.** `--attest` is signed with git's idea of who
   ran the command, which on an automated run is a person who never read anything — so the record
   would carry their name against a judgement they did not make. Pass `--unattended` and the record
   says `mode: "unattended"` instead. It lowers no bar: the ten-character minimum still applies, and
   every gate still has to pass. It only labels who was there, so
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-evidence.mjs` can tell the two apart afterwards.

   **Under `--unattended`, `--attest` is required on every target** — including `Approved →
   Implemented`, which asks for no human judgement at all. Without it the record's `attested` is
   `null`, and an absent mode reads `human`: an unattended run would leave behind the one record
   shape that claims a person made the call.

   **`--re-record` refreshes the record for the status a spec already holds.** Acting on a review
   finding edits files the last gate fingerprinted, so that record reads `stale` for having done
   the right thing — and without this flag there is no way to refresh it, because the gate refuses
   a same-status transition with `already <status>`.

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-advance.mjs <spec-file> --re-record \
     --attest "<what you judged, in your own words>"
   ```

   It relaxes exactly that one check. **The `Status` cell does not move**, every other gate for
   that status runs in full, and any `FAIL` still refuses — a re-record is a re-gate, not a rubber
   stamp, and it is not a way to make a red record green. Pointed with `--to` at a status the spec
   does not hold it refuses: refreshing a past status would be writing history that never happened.
   A record for a status the spec does not hold needs no refreshing at all —
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-evidence.mjs` reads it as `superseded`, which is
   history and not a failure, whether the spec moved past that status or back from it.

   **Three more refusals, and each removes a way to re-record something nobody checked:**

   - **At `Draft`** — no gate block exists for it, so the record would be written with the
     lifecycle check alone examined.
   - **At `Archived`** — its only gate asks `git branch --merged`, which lists the branches on
     *this* machine: a merged branch that was pruned reads FAIL, and a merge nobody pushed reads
     PASS. Re-gating a status granted long ago is exactly where the pruned branch is normal.
   - **When the branch diff has gone empty** since the record being replaced named files in it.
     The radius is a three-dot diff from the merge base, which empties the moment the branch
     merges — so a re-record after the merge would narrow what the status is checked against
     instead of re-answering it. A *partial* shrink is honest, is named in the output, and
     proceeds: a file genuinely deleted as part of the work leaves the diff.

   The script writes the Status cell and nothing else. **You still do the rest by hand:** the
   **Branch** row, the **Date**, any acceptance criteria you confirmed, the Revisions row on a
   reversal, and the `git mv` on archive. Those are changes a person should watch happen.

6. **What the script leaves behind.** On success it writes an evidence record under
   `.ml-specs/evidence/` holding the base branch and sha, a hash of every §6 test the gate
   resolved, a hash of every file this spec's branch changed — **for `Implemented` and `Verified`;
   an `Approved` record has no file radius, because approving a contract happens before the code
   exists and it is judged by that contract instead** — the gate verdicts, and your signed
   attestation. That is what makes the status re-checkable later: delete one of those tests, or
   rewrite the module, and the record reads `stale` and names the file. Commit it with the spec.

   A record that no longer digests to its own contents reads `unsound` — it was edited after the
   gate wrote it. Do not edit records; re-run the gate. That stays true of a record whose spec has
   moved on: `superseded` never outranks `unsound`, so advancing a spec cannot launder one.

7. Report the transition in one line.

## The gates

| Transition | Required evidence |
|---|---|
| `Draft` → `Approved` | The human approves **in this conversation** — ask if they haven't. Section 8 holds no blocking questions (an answer that would change an API shape, data model, error code, scope boundary, or compatibility). No `<placeholder>` text left in filled sections. If the spec hasn't had an adversarial pass, run `/ml-specs:spec-review` first. |
| `Approved` → `Implemented` | Every acceptance criterion is checked, and each row of the §6 test-plan table names a test file/method that **exists on disk** — `spec-gate.mjs` checks both; a named-but-missing test is the most common lie here. Normally `/ml-specs:spec-build` makes this transition itself. |
| `Implemented` → `Verified` | A clean **`/ml-specs:spec-verify`** — the `reviewer` agent marked every criterion satisfied, with a functional/E2E test for each user-facing or contract-level one — **and** the §6.1 full suite green end to end, **and** no new error-severity finding from the architecture standards (`ml-skills check`, if the repo has a `.mlskills.json` **and** `.ml-specs.json` does not set `"mlSkills": "off"` — when it does, this clause does not apply and step 3's one-line record replaces it). If any of those did not happen in this session, run them now; if a suite or an applicable standards check can't be run here, say so and refuse the transition. Never set `Verified` on assertion. |
| `Verified` → `Archived` | The spec's branch is merged into the default branch — `spec-gate.mjs` checks `git branch --merged`; if the PR merged but the local branch is behind, fetch first rather than overriding it. Then `git mv` the file to `specs/archive/NNNN-slug.md` — keep the number, create `specs/archive/` if absent — and fix any relative links that pointed at it. Numbers are never reused. |

**Moving backwards** (e.g. `Implemented` → `Draft` because the contract changed) is allowed and
sometimes correct. It needs no evidence gate, but it **must** add a **Revisions** row saying what
changed and why, and it un-ticks the acceptance criteria that no longer hold.

**Skipping a status** is not allowed — run the gates in order. If the user asks to jump straight to
`Verified`, walk each intervening gate and report the first one that fails.

Next step after a successful transition: `Approved` → `/ml-specs:spec-build <spec-file>` ·
`Implemented` → `/ml-specs:spec-verify <spec-file>` · `Verified` → `/ml-specs:pr <spec-file>` · `Archived` → done.

**Then offer those steps as actions.** Put them to the user with the AskUserQuestion tool —
`header: "Next step"`, `multiSelect: false`, one option per concrete command below, the one you
recommend **first** and its label suffixed `(Recommended)`, with the *why* and the cost in its
description. Offer only the row of the map above that matches the status you actually wrote:

- after `Approved` → `/ml-specs:spec-build <spec-file>` **(Recommended)** — the IMPLEMENT phase.
  `/ml-specs:repo-impact` is the second option: which other services this breaks, answered before
  the code exists rather than after a reviewer finds it.
- after `Implemented` → `/ml-specs:spec-verify <spec-file>` **(Recommended)** — the adversarial pass
  that gates `Verified`; `/code-review` is the second option, a different question about the diff.
- after `Verified` → `/ml-specs:pr <spec-file>` **(Recommended)** — the PR title and body. This
  produces text; it does not open anything. `/ml-specs:spec-fanout` is the second option, for a
  contract change that lands in more than one repo: same derived branch name in each, so the set is
  provably one change.
- after `Archived` the loop is over: **do not ask.** A menu at the end of a finished loop is the
  menu-fatigue this convention is trying to avoid.

**On a refused transition** (step 4) the options are the one command that produces the missing
evidence — not the transition again. Re-offering a gate that just refused teaches the human to
click past the question.

**Navigation, not consent** — never offer a step already ruled out, and never ask permission for
something this command should simply do. **No double question:** if this run already stopped on a
blocking decision and that is the last thing the user answered, that decision *is* the close — name
the next step in prose and stop. **Only a command asks, never an agent** — a subagent has no
channel to the human. The prose next-step line stays either way: it is what the transcript keeps
and all a non-interactive run emits.
