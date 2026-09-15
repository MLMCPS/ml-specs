---
description: Adopt the toolkit into a repo that already has a hand-written CLAUDE.md or docs/ — merges instead of overwriting, and never deletes human prose
argument-hint: (no args) — run from the root of a repo that already has its own CLAUDE.md/docs
---

You are adopting the ml-specs into a repo that **already has a knowledge layer someone wrote by
hand**. `/ml-specs:repo-init` assumes a blank slate; this doesn't. The difference matters because the fastest
way to make a team distrust a tool is to have it clobber documentation they wrote.

**The rule for this entire command: human prose is never deleted and never silently rewritten.**
When the existing text and what you'd generate disagree, the human's text stays and you flag the
disagreement. You are adding structure around their work, not replacing it.

The plugin's templates live under `${CLAUDE_PLUGIN_ROOT}/templates/`.

## Phase 1 — inventory what's already there

1. Read what exists: `CLAUDE.md`, `docs/` (any structure), `specs/`, `AGENTS.md`, `.cursorrules`,
   `.github/copilot-instructions.md`, `CONTRIBUTING.md`. Teams keep agent instructions in all of
   these — find them before assuming there's nothing to preserve.

2. **Classify every section** you found into three buckets, and show the user this classification
   *before* writing anything:
   - **Keep verbatim** — project knowledge only a human knew: domain rules, gotchas, history, "we
     tried X and it broke". This is the valuable part and it is not regenerable.
   - **Merge** — something the toolkit also covers (build commands, conventions, a patterns
     section). Their version wins on content; you may restructure around it.
   - **Missing** — toolkit sections with no counterpart (the working agreement, the spec loop, the
     knowledge-layer index, quality gates).

3. **Check the existing content against the code**, the same way `/ml-specs:repo-init` learns. Where a
   hand-written claim is now wrong (a command that no longer exists, a pattern the code abandoned),
   **do not correct it silently** — collect it for the report. A stale claim a human wrote is
   still theirs to retire.

## Phase 2 — learn what's missing

4. Run `/ml-specs:repo-init`'s Phase 1 learning, but **only for what the existing docs don't already cover**.
   Don't re-derive conventions they've already written down — read theirs, verify it, and move on.
   The point is to fill gaps, not to produce a second opinion on everything.

## Phase 3 — merge

5. **`CLAUDE.md`** — keep their structure and wording. Append only the toolkit sections that are
   missing (from `${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.fragment.md`), and add the knowledge-layer
   index pointing at whatever `docs/` files actually exist here — including the ones they named
   differently. Do not rename their files to match the templates. If their `CLAUDE.md` is already
   over budget, say so and propose what to move out; don't do it unasked.

6. **`docs/PATTERNS.md`** — if they have an equivalent under any name, extend it in their format
   and mark **only what you added** as `(inferred)`. If there's nothing, generate it as `/ml-specs:repo-init`
   would. Never reformat their existing patterns into the template's shape.

7. **`docs/ARCHITECTURE.md`** — same. If their structure doc is organised differently (by feature,
   by layer), keep their organisation; add the `Depends on / Used by` edges if absent, since that's
   what the agents actually retrieve on.

8. **`specs/`** — scaffold `README.md`, `TEMPLATE.md`, `AGENTS.md` if absent. If they already have a
   spec/RFC/ADR practice, **map onto it instead of replacing it**: keep their directory, their
   numbering, and their template's sections, and add only what the loop needs (acceptance criteria
   that are testable, the §6.1 final-acceptance gate, the Status field `/ml-specs:spec-advance` reads).
   Report the mapping so they can see what changed about their process.

8b. **`docs/SKILLS.md`** — if `ml-skills` is available, run **`/ml-specs:repo-skills`** to record the
   catalog skills matching the stack, reusing the learning from Phase 2 rather than re-scanning.
   If they already keep an equivalent list under any name, **extend theirs in their format** and do
   not introduce a second file — the adopt rule applies here as everywhere: merge, never replace.
   If ml-skills is not installed, skip it and say so in one line.

9. **Commit attribution** — merge the `attribution` key from
   `${CLAUDE_PLUGIN_ROOT}/templates/settings.json` into `.claude/settings.json`, creating the file
   if absent and leaving every other key untouched. If the repo already sets `attribution`, keep
   their value and report it rather than overwriting — this command never overrides a deliberate
   choice. Committed, it applies to everyone who clones the repo with no per-machine setup.

10. **CI + hooks** — offer, don't install: the knowledge-layer gate
   (`${CLAUDE_PLUGIN_ROOT}/templates/ci/`) with `--warn-only` for a repo with existing drift, and
   the opt-in project hooks. Say that the plugin's own hooks (drift warning, session-handoff notice,
   secret scan) are already active on install and need nothing here.

## Phase 4 — report

11. Report as three lists, in this order:
    - **Preserved** — their content you kept, by section. Lead with this.
    - **Added** — toolkit sections that were missing.
    - **Conflicts** — where their docs and the code disagree, each with `file:line` evidence and
      **no change made**. These are decisions for them, not for you.

    Then: what to review first, and that `/ml-specs:repo-doctor` will now keep checking it. Do NOT commit.

If the repo has no knowledge layer at all, this is the wrong command — say so and point at
`/ml-specs:repo-init`. If it has one the toolkit already generated, point at `/ml-specs:repo-refresh`.
