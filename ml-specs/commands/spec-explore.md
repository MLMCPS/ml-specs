---
description: Analyse a ticket or half-formed idea into a reviewable note — what it touches, the viable approaches, the blocking questions — before any spec is written
argument-hint: <ticket, or a description of the problem>
---

You are in the **ANALYZE** phase of spec-driven development — the phase *before* SPECIFY. Your job
is to produce a reviewable **analysis note** under `specs/`. **Do NOT write a spec, do NOT write
implementation code, and do NOT change any file other than the note itself.** You also do **not**
put the analysis's blocking contract questions to the human — they are *reported* in the note and
*asked* by `/ml-specs:spec` step 3, which already owns that job. The one thing you ask about is
overwriting an existing note (step 5).

This phase is **optional**. `/ml-specs:spec` runs unchanged when no note exists.

Ticket / problem: **$ARGUMENTS**

Steps:

1. Detect the stack (any language) from the manifest/build file and existing source — the real
   test/build commands, the data layer, the test layout — then read `CLAUDE.md` and
   `docs/PATTERNS.md` so the analysis is grounded in this project's actual conventions rather than
   generic advice. Read `specs/README.md` too if it exists.

2. Use the **analyst** agent to analyse the problem read-only against the codebase. Give it the
   ticket/description and the stack facts you just detected. It returns five things, in order: what
   exists (cited `file:line`), what the change touches, two or three approaches with their costs and
   one marked recommended, the blocking contract questions, and what it could not determine. It has
   no write tool — it analyses, you write.

3. Relay the agent's output to the human: the recommendation and why, the approaches it rejected
   and what each would have cost, and the blocking questions it surfaced. Do not resolve those
   questions yourself and do not ask them — `/ml-specs:spec` batches them to the human in step 3 of
   the SPECIFY phase.

4. Write the note as `specs/explore-<slug>.md`, kebab-case slug derived from the problem, creating
   `specs/` if it does not exist. It carries this header table — **all three rows**, because
   `/ml-specs:spec` matches a note on its `Ticket` cell, or on its `Title` when the ticket cell says
   `— (no tracker)`, never on the filename:

   ```
   | | |
   |---|---|
   | **Ticket** | ACME-412, or `— (no tracker)` |
   | **Title** | the problem in one line |
   | **Date** | YYYY-MM-DD |
   ```

   Then exactly these five sections, in this order and with these headings, so the note can be read
   structurally rather than by guesswork:

   - `## 1. What exists`
   - `## 2. What it touches`
   - `## 3. Approaches`
   - `## 4. Blocking questions`
   - `## 5. Not determined`

   The note deliberately has **no `Status` row and no four-digit number**: it is not a spec, it
   never appears in `/ml-specs:repo-status`, and `/ml-specs:spec-advance` neither reads nor writes
   it. When the spec it fed is archived, the note may simply be deleted.

5. **Never silently overwrite a note.** If `specs/explore-<slug>.md` already exists, stop, report
   the existing file's `Title` and `Date`, and ask the human whether to replace it, write to a
   different slug, or leave it alone. Only then write.

6. Summarise for the human: the note's path, the recommended approach, and the blocking questions
   they will be asked next. Then name the next command:
   **`/ml-specs:spec <ticket>`** — it globs `specs/explore-*.md`, matches this note, and carries its
   blocking questions and rejected approaches into the spec instead of re-deriving them.

Keep the note honest. An approach you rejected with a stated reason is worth more to the next
reader than a confident recommendation with no alternatives beside it.
