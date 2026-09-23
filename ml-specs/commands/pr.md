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
PR from an `Implemented` spec is fine, but the human should know `/ml-specs:spec-verify` hasn't passed.

Relay the agent's output **ready to paste**: the title, then the body (`## Summary`,
`## Changes`, `## Acceptance criteria` as a checklist mapped to tests, `## Testing` with the real
commands and real results, `## Risks / follow-ups`), with the spec file linked.

Hard rules:
- **Do not open or push the PR** as part of this command, and do not commit. This produces text.
  The one carve-out is `/ml-specs:pr-address`, which addresses review feedback on an already-open
  PR and therefore does commit and push; that divergence is recorded in
  `specs/0014-pr-address-review-feedback.md` §4.6, and its gate refuses to reply about unpushed work.
- Only if the user explicitly asks to open it: push the branch, then `gh pr create --title ... --body-file <file>`
  using the generated body written to a temp file (never retype it inline).
- Never tick an acceptance criterion the diff doesn't clearly satisfy, and never state a test result
  you didn't observe. An honest unchecked box is the point of the checklist.
- **No AI attribution** in the title or body: no `Co-Authored-By:` line for an assistant, no
  "Generated with"/"Made with" line, no model or vendor name, no tool badge or emoji. If the user
  asks you to open the PR, pass the body through unchanged — don't let `gh` or a template append one.

Next step: `/ml-specs:spec-advance <spec-file> Archived` once the PR is merged.

**Then offer those steps as actions.** Put them to the user with the AskUserQuestion tool —
`header: "Next step"`, `multiSelect: false`, one option per concrete command below, the one you
recommend **first** and its label suffixed `(Recommended)`, with the *why* and the cost in its
description:

- `/ml-specs:spec-advance <spec-file> Archived` **(Recommended)** — the spec's last transition,
  once the PR is merged. The gate checks the branch really is merged before it writes anything.
- `/ml-specs:pr-address <pr>` — when the reviewers have left comments: triage each one, fix, reply.
  It is the one command that commits and pushes, and it shows the full diff first.

**Navigation, not consent** — never offer a step already ruled out, and never ask permission for
something this command should simply do. **No double question:** if this run already stopped on a
blocking decision and that is the last thing the user answered, that decision *is* the close — name
the next step in prose and stop. **Only a command asks, never an agent** — a subagent has no
channel to the human. The prose next-step line stays either way: it is what the transcript keeps
and all a non-interactive run emits.
