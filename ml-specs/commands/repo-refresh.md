---
description: Re-learn what changed since the last refresh and update the Claude knowledge files (docs/, CLAUDE.md) so the agent's memory matches reality
argument-hint: (no args) — run from the repo root after the codebase has drifted
---

The project has evolved since `/ml-specs:repo-init` (or the last refresh). Re-learn it and update the
generated knowledge files so the coding agents' memory stays accurate. The code is the source of
truth — a stale summary is worse than none.

This is the LEARN + UPDATE half of `/ml-specs:repo-init` (it does NOT re-scaffold `specs/` or
`.gitattributes`). The plugin's templates live under `${CLAUDE_PLUGIN_ROOT}/templates/`.

Steps:

1. **Scope the re-learn to what actually moved.** A refresh is not a re-init: most of the repo is
   unchanged, and re-learning all of it is the single most wasteful path in this toolkit. Find the
   changed surface first — it's cheap and mechanical:

   ```
   git log -1 --format=%H -- CLAUDE.md docs/            # when the knowledge layer was last updated
   git diff --name-only <that-sha>..HEAD -- . ':(exclude)docs/*' ':(exclude)*.md'
   ```

   If that returns nothing, the docs are current — say so and stop. If it returns more than roughly
   half the repo's source files (or the last-doc commit is unreachable), fall back to a full
   re-learn and say that you did.

2. **Re-learn, in parallel, scoped to those paths.** Spawn **scanner** agents **in a single
   message** — one `patterns` and one `structure` brief, each scoped to the changed paths, plus a
   `stack` brief **only if** the manifest/build file or lockfile is among them (otherwise the stack
   hasn't moved and re-detecting it is pure cost). Each returns `file:line` findings, not source, so
   the changed code never lands in this context.

3. **Diff against the existing docs.** Read the current `docs/PATTERNS.md`, `docs/ARCHITECTURE.md`,
   and the "Code patterns & conventions" section of `CLAUDE.md`. Identify what changed: new
   modules/endpoints/components, new or changed data models & migrations, new conventions, removed
   patterns, new dependencies, changed commands.

4. **Update the files in place** (don't blow away human edits — merge and preserve hand-written
   notes; only correct what's now wrong or missing). Refreshing is also pruning: **delete stale
   patterns and trim bloat** so each doc stays under its ~200-line budget and `CLAUDE.md` stays a
   thin index — replace drifted sections, don't just append. Smaller, current memory = fewer tokens
   every task.
   - `docs/PATTERNS.md` — refresh the house style from current code.
   - `docs/ARCHITECTURE.md` — refresh structure, data/persistence, events, external calls.
   - `CLAUDE.md` — fix the stack/build/run/test commands and the "Code patterns & conventions"
     summary if they've drifted.
   - `docs/SKILLS.md` — do NOT rewrite it here. If the stack itself changed (a new language,
     framework or data store), say so and recommend `/ml-specs:repo-skills`, which re-matches the catalog.
     If the stack is unchanged, leave the file alone: the catalog moving is not repo drift.
   - `docs/ESTATE.md` — do NOT rewrite it here. If this repo's cross-service contracts changed
     (a new client, listener, or published topic), say so and recommend `/ml-specs:repo-estate`, which reads
     the peer repos to resolve both sides of each edge.
   - **Sharded (large app):** update ONLY the `docs/architecture/<module>.md` (and
     `docs/patterns/<module>.md`) shards for modules that changed; add a shard + router row for a
     new module; remove the row + shard for a deleted one. Don't rewrite untouched shards.

5. **Report a concise changelog** of what you updated (and what you intentionally left), and what
   the human should review. Do NOT commit — leave changes staged/untracked for review.

If no knowledge files exist yet, tell the user to run `/ml-specs:repo-init` first.
