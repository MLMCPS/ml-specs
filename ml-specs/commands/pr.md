---
description: Turn a completed spec plus its diff into a PR title and description, with the acceptance criteria as a review checklist
argument-hint: <path to spec file, e.g. specs/0001-foo.md> — omit to use the spec matching the current branch
model: sonnet
---

Spec: **$ARGUMENTS**

If no spec was given, find the one matching the current branch (the spec whose **Branch** row or
number/slug matches `git rev-parse --abbrev-ref HEAD`). If that's ambiguous, ask which spec rather
than guessing.

Use the **pr-author** agent to produce the PR title and body from the spec plus the branch diff.

Before delegating, check the spec's Status and say so up front if the work isn't verified yet — a
PR from an `Implemented` spec is fine, but the human should know `/spec-verify` hasn't passed.

Relay the agent's output **ready to paste**: the title, then the body (`## Summary`,
`## Changes`, `## Acceptance criteria` as a checklist mapped to tests, `## Testing` with the real
commands and real results, `## Risks / follow-ups`), with the spec file linked.

Hard rules:
- **Do not open or push the PR** as part of this command, and do not commit. This produces text.
- Only if the user explicitly asks to open it: push the branch, then `gh pr create --title ... --body-file <file>`
  using the generated body written to a temp file (never retype it inline).
- Never tick an acceptance criterion the diff doesn't clearly satisfy, and never state a test result
  you didn't observe. An honest unchecked box is the point of the checklist.
- **No AI attribution** in the title or body: no `Co-Authored-By:` line for an assistant, no
  "Generated with"/"Made with" line, no model or vendor name, no tool badge or emoji. If the user
  asks you to open the PR, pass the body through unchanged — don't let `gh` or a template append one.

Next step: `/spec-advance <spec-file> Archived` once the PR is merged.
