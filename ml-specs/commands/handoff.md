---
description: Write a session handoff note — what was done, what is half-finished, what was decided and rejected, and the next concrete step — so the next session resumes instead of re-deriving
argument-hint: <optional — a short label for this handoff>
---

Write a **session handoff note** for whoever picks this work up next — a later session, or a person.
**Do NOT write or change code, do NOT commit or push, and do NOT touch any file other than the note
itself.** You also do not set any spec's `Status`: a handoff is not a lifecycle document, and
`/ml-specs:spec-advance` owns that transition.

The note is written from **this session's conversation**, not from a fresh read of the repo. The
approach that was rejected and why, the work left half-done on purpose, the test that is red
deliberately, the next concrete step — none of that is recoverable from the code alone, which is why
the next session re-derives it badly.

<!--
  This command runs INLINE in the main context and delegates to no agent, deliberately. A subagent
  starts with fresh context and cannot see the parent session's conversation, which is this
  command's entire input — delegating would produce a note about the repo rather than about the
  session.

  This is precedent, not an exception: nine of the shipped commands already invoke no agent under
  the validator's own idiom (fix, nfr, repo-adopt, repo-doctor, repo-impact, repo-rollout,
  repo-status, spec-advance, spec-fanout), and nothing in scripts/validate-plugin.mjs requires a
  command to invoke one — check 6 iterates agents looking for a caller, never the reverse.
  docs/PATTERNS.md:69-71 states the delegation rule as a default against reimplementing an AGENT's
  job inline, and there is no agent whose job this is.
-->

Label: **$ARGUMENTS**

Steps:

1. **Gather verifiable state before writing a word of prose**, so "what is half-done" is grounded
   rather than remembered:
   - `git rev-parse --abbrev-ref HEAD` — the branch this work is on.
   - `git status --short` — what is modified, staged and untracked right now.
   - `git log --oneline` for the branch — what actually landed this session.

   Reconcile that against the conversation. Where memory and `git status` disagree, the command
   output wins and the disagreement is worth a line in the note.

2. Read `${CLAUDE_PLUGIN_ROOT}/templates/handoff/TEMPLATE.md` and fill it in place — it is read and
   filled, never copied into the repo as a template. Its header table takes the date, the branch
   from step 1, and the spec this work belongs to (`specs/NNNN-slug.md`) or `—` when there is none.
   Its five sections, in order:

   - `## 1. Where this got to` — what is done and verified, cited: commits, files, passing tests.
   - `## 2. In flight` — half-finished work and the state each was left in, from `git status --short`
     rather than from memory.
   - `## 3. Decided — and rejected` — the approach taken and the ones dismissed, each with why. This
     is the section that stops the next session re-litigating a settled question.
   - `## 4. Next step` — one concrete action, specific enough to start on without re-reading the
     code.
   - `## 5. Landmines` — a deliberately-red test, a stubbed call, a temporary hack: anything that
     looks like a bug and isn't, or is.

3. Write it to `.claude/handoff/<YYYY-MM-DD-HHMMSS>-<slug>.md`, resolved against the **git toplevel**
   (`git rev-parse --show-toplevel`), never `$PWD` — the SessionStart hook that surfaces these notes
   resolves the same way, and the two must not disagree about which repo they are in. Create
   `.claude/handoff/` if it does not exist.

   | Question | Answer |
   |---|---|
   | Slug | kebab-case of the label above |
   | No label given | the current branch name, kebab-cased; if that is `main` or `HEAD`, the literal `session` |
   | Collision | seconds precision makes this unreachable in practice — it needs two invocations inside one second. The rule stands as a safety net: append `_2`, `_3`, … **before** `.md`, taking the first free integer — this command never replaces an existing note, so nothing a human wrote is silently overwritten |
   | Sort safety | `_` (0x5F) sorts **after** `.` (0x2E), so `…-work_2.md` sorts after `…-work.md` — the order the two were written in. That is the whole reason the suffix is `_N` and not `-N`: `-` is 0x2D, which sorts *before* `.`, so a `-2` suffix would put the newer note FIRST and the SessionStart hook's `sort \| tail -1` would announce the older one. The fixed-width `<YYYY-MM-DD-HHMMSS>` prefix orders notes written in different seconds; this rule is what orders the ones that are not |

   One note per invocation. Two handoffs in one session are two files, and that is intended.

4. **Write every command reference in the namespaced form** — `/ml-specs:spec-build`, carrying the
   `/ml-specs:` prefix, never the bare name on its own. The bare form names a command that does not
   exist, and the repo validator scans `.claude/` and errors on it. The template also carries the
   file-scoped `allow-bare-commands` HTML-comment marker (spelled out in
   `${CLAUDE_PLUGIN_ROOT}/templates/handoff/TEMPLATE.md`, and deliberately **not** spelled out here —
   check 12 skips any file containing that literal, so writing it in a shipped command would turn the
   guard off for this whole file), so whatever a human later types into their own note cannot
   redden anyone's build — but the note you write is namespaced because that is the convention, not
   because the marker is there.

5. Do not commit the note and do not stage it. Whether handoffs are committed or ignored is the
   repo's choice, not this command's.

6. Report the note's path and its `## 4. Next step` line, then name what comes next:
   **`/ml-specs:repo-status`** — the spec board, so the next session starts from where the work
   stands rather than from where this note left off.

A handoff is worth writing only if it is honest. A rejected approach with a stated reason, and a
test left red on purpose, are worth more to the next reader than a tidy summary that reads as though
everything is finished.
