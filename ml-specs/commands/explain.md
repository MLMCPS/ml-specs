---
description: Explain what existing code actually does — a cited, structured walkthrough of a module, file, function or flow, written to a reviewable note
argument-hint: <a path, a symbol, or a description of the flow to explain>
---

You explain **code that already exists** to a human who has to work with it. **Do NOT write
implementation code, do NOT propose or design a change, and do NOT change any file other than the
note itself.** Reviewing a diff for defects belongs to `/code-review`; deciding what should be built
belongs to `/ml-specs:spec-explore` and `/ml-specs:spec`.

This command sits **outside** the SDD loop, like `/ml-specs:code` and `/ml-specs:fix`. The note it
writes is not a spec: it carries no `Status`, and `/ml-specs:spec-advance` neither reads nor writes
it.

Target: **$ARGUMENTS**

Steps:

1. Detect the stack (any language) from the manifest/build file and existing source — the language,
   the real build/test commands, the data layer, the test layout — then read `CLAUDE.md` and
   `docs/PATTERNS.md` where they exist, so the explanation is written in this project's vocabulary
   rather than in generic advice. Read `docs/ARCHITECTURE.md` too if it exists, and open only the
   ONE shard for the module the target lives in.

2. Use the **explainer** agent to read the target against the codebase, read-only. Give it the
   target and the stack facts you just detected. It returns six things, in order: what the code
   does, its entry points, the flow through it, its contracts and callers, the gotchas, and what it
   could not determine — every factual claim carrying a real `file:line`. It has no write tool: it
   explains, you write.

3. Relay the agent's account to the human: what the code does, the flow in outline, and the gotchas
   it found. Do not turn any of it into a proposal — an explanation that ends in a recommendation is
   a design, and designs are reviewed as specs, not as notes.

4. Write the note as `specs/explain-<slug>.md`, a kebab-case slug derived from the target, creating
   `specs/` if it does not exist. It carries this header table — **all three rows**, because the
   reader needs to know what was explained and how old the snapshot is:

   ```
   | | |
   |---|---|
   | **Target** | the file, symbol or flow that was explained |
   | **Title** | what it does, in one line |
   | **Date** | YYYY-MM-DD |
   ```

   Then exactly these six sections, in this order and with these headings, so the note can be read
   structurally rather than by guesswork:

   - `## 1. What it does`
   - `## 2. Entry points`
   - `## 3. Flow`
   - `## 4. Contracts & callers`
   - `## 5. Gotchas`
   - `## 6. What you could not determine`

   The note deliberately has **no `Status` row and no four-digit number**: it is not a spec, it
   never appears in `/ml-specs:repo-status`, and `/ml-specs:spec-advance` neither reads nor writes
   it. It is a snapshot — when the code it describes has moved on, delete it rather than trusting
   it.

5. **Never silently overwrite a note.** If `specs/explain-<slug>.md` already exists, stop, report
   the existing file's `Title` and `Date`, and ask the human whether to replace it, write to a
   different slug, or leave it alone. Only then write.

6. Summarise for the human: the note's path, what the code does in one line, and anything the agent
   could not determine. Then name what comes next:
   - **`/ml-specs:spec <ticket>`** — when the explanation implies a change worth specifying.
   - `/ml-specs:code <task>` — when it is a one-liner that needs no spec.
   - `/ml-specs:spec-explore <ticket>` — when the open question is which approach to take rather
     than what the code does.

Keep the note honest. A gotcha you found and cited is worth more to the next reader than a fluent
summary that quietly smoothed it over, and an honest "could not determine" is worth more than either.
