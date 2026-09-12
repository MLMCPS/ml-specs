---
description: Health-check the project's Claude knowledge layer (CLAUDE.md, docs/, specs/) and report drift — read-only, suggests /ml-specs:repo-refresh when needed
argument-hint: (no args) — run from the repo root
model: haiku
---

You are doing a **read-only health check** of this repo's spec-driven-development setup. Do NOT
edit any files — diagnose and report, then recommend the fix command.

The point: the knowledge layer is only worth its tokens if it's *accurate*. A stale doc that
points at deleted files or contradicts the code is worse than none. Find the drift, don't fix it.

Steps:

1. **Inventory.** Check which knowledge files exist: `CLAUDE.md`, `docs/PATTERNS.md`,
   `docs/ARCHITECTURE.md` (or sharded `docs/architecture/*.md` + `docs/patterns/*.md`),
   `docs/SKILLS.md`, `specs/README.md`, `specs/TEMPLATE.md`. If none exist, report that and
   recommend `/ml-specs:repo-init`, then stop.

   `docs/SKILLS.md` is **optional** — it only exists where `ml-skills` is installed. Its absence
   is not drift; report it as "not in use" and move on. Where it does exist, check that the
   technologies it claims to match still appear in the stack, and that `CLAUDE.md` points at it in
   one line rather than inlining the list. Recommend `/ml-specs:repo-skills` if either has drifted.

2. **Broken references.** If `.github/scripts/knowledge-check.mjs` exists, run it — it does this
   check mechanically and faster than you can. Otherwise scan the docs for `file:line` references
   and file paths yourself, flagging any that point at files that no longer exist or whose line
   ranges are now well off (the file shrank past the cited line). These are the highest-signal
   drift markers. If the script is missing, recommend seeding it from the plugin's `templates/ci/`
   so CI catches this instead of waiting for someone to run `/ml-specs:repo-doctor`.

3. **Stale commands.** Cross-check the build/test/run/lint commands listed in `CLAUDE.md` against
   the real manifest/build file (`package.json` scripts, `pom.xml`/`build.gradle`, `Makefile`/
   `Taskfile`, `pyproject.toml`, etc.). Flag commands that no longer exist.

4. **Budget & shape.** Flag any doc over its ~200-line budget, and whether `CLAUDE.md` is still a
   thin index (links out) rather than having inlined large patterns. For sharded layouts, flag
   router rows pointing at missing shards, or module shards with no router row.

5. **`(inferred)` markers.** List patterns still marked `(inferred)` in `docs/PATTERNS.md` — they
   were never confirmed against code and deserve a human glance.

6. **Spec hygiene.** In `specs/` (ignore `specs/archive/`), flag:
   - Status `Implemented` with unchecked acceptance criteria.
   - Status `Verified` where a §6 test-plan row names a test file that doesn't exist — the status
     claims evidence the repo doesn't have.
   - Status `Verified` with the branch already merged into the default branch → should be archived
     (`/ml-specs:spec-advance <spec> Archived`).
   - Stuck in `Draft`/`Approved` with no matching branch or code (best-effort; don't block on it).
   - Two specs sharing a number, or a `Status` holding prose rather than one lifecycle word.
     Both are mechanical to repair — point at `scripts/fix-specs.mjs` in the plugin (dry run by
     default) rather than fixing them one at a time here.
   - A blocking contract question parked in section 8 (an answer that would change an API shape,
     data model, error code, scope, or compatibility) — that spec isn't approvable as written.

7. **`(inferred)` vs reality spot-check.** Pick 2–3 of the most load-bearing claims in
   `docs/PATTERNS.md` / `docs/ARCHITECTURE.md` and verify them against the code. Report matches and
   mismatches.

Report a concise, prioritized list grouped as **Broken (fix now)**, **Stale (likely drift)**, and
**OK**. End with a one-line recommendation: run `/ml-specs:repo-refresh` if there's real drift, `/ml-specs:repo-init`
if nothing exists, or "knowledge layer looks healthy" if clean. Do NOT make changes yourself.
