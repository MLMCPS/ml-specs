---
description: Onboard the toolkit across an estate — survey the repos cheaply, then init/adopt them in reviewed waves rather than all at once
argument-hint: <parent dir containing the repos, or an explicit list> — e.g. ~/work or ../svc-a ../svc-b
model: sonnet
---

Target repos: **$ARGUMENTS**

You are rolling the toolkit out across many repos. The whole job is **aiming the expensive part**.

`/ml-specs:repo-init` is the most costly operation in this toolkit — a full codebase scan. Running it across
an estate unattended produces a large bill and, worse, a pile of knowledge layers nobody reviewed,
which is the exact failure the toolkit exists to prevent. So: survey cheaply, onboard deliberately,
and let the first repo teach you what the rest need.

**Never commit in another repo. Never onboard more than one repo before a human has seen the first
one's output.**

## Phase 1 — survey (cheap, mechanical, read-only)

1. Run the survey script — no model needed, so this costs almost nothing:

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/survey-estate.mjs <parent-or-repos>
   ```

   It classifies each repo as **init** (no knowledge layer, active), **adopt** (has hand-written
   docs or another tool's agent instructions — `/ml-specs:repo-init` would clobber them), **refresh** (already
   onboarded), **review** (dormant, or no recognisable manifest), or **skip**. It also counts
   cross-service edge signals.

2. Relay the table and the per-repo reasons. Flag anything with uncommitted changes — onboard on a
   clean tree, or the toolkit's diff is tangled with someone's work in progress.

## Phase 2 — agree the order with the human

3. Order by **what onboarding unlocks**, not alphabetically. Repos with the most cross-service edge
   signals come first: their `docs/ARCHITECTURE.md` is what `/ml-specs:repo-estate` needs to resolve the *other*
   side of a contract, so onboarding them makes `/ml-specs:repo-impact` answerable for their peers too. A leaf
   service with no edges can wait.

4. Put the plan to the user with AskUserQuestion: which repos are in the first wave (recommend 1–3),
   and confirm the **review** ones — dormant or unrecognised repos are a human call, not yours. State
   the rough cost: one `/ml-specs:repo-init` per repo, larger repos costing more.

## Phase 3 — onboard, one repo at a time

5. **The first repo is a calibration run.** Onboard exactly one, then **stop** and have the human read
   its generated `CLAUDE.md`, `docs/PATTERNS.md`, and `docs/ARCHITECTURE.md`. Almost always something
   is systematically off — a convention mislabelled, the wrong build command, too much detail in the
   thin index. Fixing that once, before repo two, is the difference between 17 good knowledge layers
   and 17 copies of the same mistake.

6. For each repo in the wave, in its own directory:
   - `action: init` → run `/ml-specs:repo-init`'s procedure there.
   - `action: adopt` → run `/ml-specs:repo-adopt`'s procedure instead. **Never `/ml-specs:repo-init` a repo with existing
     docs** — clobbering documentation a team wrote is how a tool gets banned.
   - Leave every change **uncommitted**. Report the file list per repo. The human commits.
   - If a repo turns out to be something other than a service (a library, a config repo, an
     archive), stop and say so rather than generating a knowledge layer for it.

7. Between repos, carry forward what you learned: if repo one's `PATTERNS.md` needed the same
   correction twice, apply it from the start in repo three.

## Phase 4 — make the estate index real

8. Once **two or more** repos are onboarded, run `/ml-specs:repo-estate` from one of them. Before this, the
   contract index is mostly `_TBD_` and `/ml-specs:repo-impact` correctly refuses to answer; after it, both
   start returning real consumers. This is the payoff for the whole rollout — don't skip it because
   the individual repos "look done".

## Phase 5 — report

9. Report: repos onboarded, repos deliberately skipped **and why**, repos still pending, what the
   human must review first (the `(inferred)` patterns), and the next wave. Be explicit about what
   was NOT done — a rollout that silently stops at 4 of 17 and reads as finished is worse than one
   that says "13 remain".

10. Re-running this command is how you resume: the survey re-derives every repo's state from what's
    on disk, so onboarded repos show as `refresh` and drop out of the queue. There is no ledger to
    go stale.

Related: `/ml-specs:repo-init` (one repo, greenfield) · `/ml-specs:repo-adopt` (one repo, existing docs) ·
`/ml-specs:repo-estate` (the contract index) · `/ml-specs:repo-doctor` (drift, per repo).
