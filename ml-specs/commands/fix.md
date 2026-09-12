---
description: Fix a bug the disciplined way — reproduce it with a failing test first, then make the smallest change that turns it green
argument-hint: <bug description, ticket id, or stack trace>
---

Bug: **$ARGUMENTS**

You are fixing a **defect** — something that already claims to work and doesn't. That is a different
shape of problem from a feature, and it wants different ceremony.

`/ml-specs:spec` is built for features: it asks what the contract *should* be. A bug already has a contract —
the code is just violating it. Writing a feature-shaped spec for a null-pointer wastes everyone's
time, which is why bugs currently get dropped into `/ml-specs:code` with no discipline at all. This is the
middle path: same rigor, a fifth of the paperwork.

**The discipline is one rule: the failing test comes first.** A fix without a test that failed
before it is a fix you are guessing at, and nothing stops the bug returning.

## Procedure

1. **Understand the report.** Read `CLAUDE.md` and `docs/PATTERNS.md`, detect the stack, and find the
   relevant code (`file:line`). If the report is too vague to reproduce — no input, no environment,
   no expected-vs-actual — say exactly what you need and stop. Do not guess at a repro; a fix aimed
   at the wrong cause is worse than no fix, because it closes the ticket.

2. **Reproduce it with a test that FAILS.** Write it in the project's real framework, at the level
   that actually captures the bug (a unit test if the logic is wrong; an integration or functional
   test if it only appears through the stack). **Run it and show the failure output.** This is the
   gate: if you cannot make a test fail, you have not reproduced the bug, and you must say so rather
   than proceeding to "fix" it.

3. **Find the root cause, not the symptom.** State it in one sentence with `file:line` evidence.
   If the honest answer is "the symptom goes away if I add this guard, and I don't know why", say
   that — a suppressed symptom is a worse bug wearing a hat.

4. **Make the smallest change that turns the test green.** Match the surrounding conventions. Resist
   refactoring you happen to notice on the way: mention it, don't do it. A bugfix diff that also
   restructures code is one nobody can review.

5. **Confirm.** The new test passes; the previously-failing case now works; the surrounding suite is
   still green. Report the real commands and real output — if something fails, say so.

6. **Check for siblings.** Nearly every real bug has relatives: the same mistake in a parallel code
   path, the same unguarded input elsewhere. Search for the pattern and report what you find. Fix
   them only if trivial and clearly the same defect; otherwise list them for a decision.

## When to stop and escalate to `/ml-specs:spec`

Stop and say so if the fix would **change a contract** — an API shape, a status or error code, a
data model, an event payload, or behavior another service depends on. At that point it isn't a bug
fix, it's a change of intent, and it needs the contract on paper first. Also escalate if the "bug"
turns out to be the code behaving as specified and the *spec* being wrong.

If the change touches a published contract, run `/ml-specs:repo-impact` before shipping — a fix that corrects
your service and breaks a consumer is not a fix.

## Output

- **Root cause** — one sentence, with `file:line`.
- **The failing test** — its path, and the failure output from before the fix.
- **The change** — files touched and why, kept minimal.
- **Verification** — real commands, real results.
- **Siblings** — same defect elsewhere, fixed or flagged.

Then `/code-review` before opening the PR. Only commit when the human asks — and when you do, the
message names the humans who own the change and nothing else: no `Co-Authored-By:` line for an
assistant, no "Generated with"/"Made with" line, no model or vendor name, no tool badge or emoji.
