---
description: Map this repo's stack onto the ml-skills catalog and record the matches in docs/SKILLS.md — re-runnable, so the list stays current as the stack and the catalog move
argument-hint: (no args) — run from the repo root
model: sonnet
---

You are recording which **third-party catalog skills** are worth knowing about in THIS repo.

The catalog holds a couple of thousand community skills. Loading them all would cost ~86,000
tokens a session, so they are reached by *search*, never loaded. The problem that leaves: nobody
searches, because at the moment the stack is known — onboarding — nobody has a question yet. This
command closes that gap once, writes the answer down, and lets every later session read it for the
price of one pointer in `CLAUDE.md`.

**This command records pointers. It never installs anything.** No skill is vendored into
`.claude/skills/`, no skill is loaded into context, and nothing here outranks a standard.

## Step 0 — is the catalog reachable at all?

Check for `ml-skills`: the MCP server (`skill_recommend`, `skill_search`), or `npx @mlmcps/ml-skills`.

**If it is not available, stop — and produce no file of any kind.** Say so in one line
("ml-skills is not installed, so there is no catalog to search; skipping") and end the command
there. Do not create `docs/SKILLS.md`, do not create a placeholder, a stub, an empty table or a
"TODO" heading: an empty document is worse than an absent one, because the next run cannot tell
"nothing matched" from "nobody asked". This is the same optionality `/ml-specs:repo-init` step 11 applies
to the architecture standards.

## Step 1 — what is this repo built from?

**Delegate the reading.** Spawn the **scanner** agent with the `stack` brief — language, package
manager, framework, data layer, test framework, and whether this is a monorepo. Do not read the
codebase yourself; that is the agent's job and the reason it exists.

Two shortcuts, in order, before you spawn anything:
- If `docs/ARCHITECTURE.md` or `CLAUDE.md` already state the stack accurately, use that. The
  knowledge layer exists to be read.
- If you are being called from `/ml-specs:repo-init` or `/ml-specs:repo-adopt`, the `stack` findings are already in
  the caller's context. Reuse them — do not scan the same repo twice in one run.

In a monorepo, collect the union of the packages' stacks, and keep the per-package attribution.

## Step 2 — map the stack onto the catalog

Call `skill_recommend` with the detected stack, e.g.
`skill_recommend({ stack: ["java", "spring-boot", "postgres"] })`.

It returns matches grouped by technology under `topics[]`, each row carrying `matchedOn` (which
field matched); the deduplicated `recommended[]` rollup additionally carries `matchedStack` (which
of this repo's technologies matched that skill). It also returns `skillsDoc` and
`claudeMdPointer`, which Step 3 starts from. If only `skill_search` is available, search once
per technology instead and keep the same grouping.

**Judge the results; do not paste them.** They are keyword matches over descriptions, so:
- **Drop anything whose relevance you cannot state in one line.** A row nobody can justify costs
  the next reader a `skill_fetch` to discover it was noise.
- **Watch for homonyms** — a skill matching "spring" may mean the easing curve, not the framework.
- **Prefer breadth.** A skill matching two of this repo's technologies usually beats a
  higher-scoring one matching a single technology.
- **Keep it short.** Roughly 5-15 rows. This is an index, not an inventory.

## Step 3 — write `docs/SKILLS.md`

**`skill_recommend` already returns the document. Start from it; never retype it.**
Its `skillsDoc` field is a complete `docs/SKILLS.md` body — heading, the standards-do-not-apply
framing, the table, and the "no catalog match" section. `skillsDocPath` names where it goes; `howToRecord`
covers writing the file, the pointer line and diff-not-overwrite — the two rules below (deleting
rejected rows, and extending an existing list under another name) are this command's, not the
tool's, so do not expect to find them there.

**It is rendered before you judge anything, so it contains every row the ranking returned — not
the ones you kept in Step 2.** The tool renders the document inside the same call that ranks, and
there is no way to hand curated rows back for a second render. So: take `skillsDoc` as written,
then **delete the table rows Step 2 rejected**. Deleting rows is not re-rendering. What you must
never do is retype the heading, the framing blockquote, the column layout or the section
structure by hand — that is the second copy that drifts. With the default of six matches per
technology, a four- or five-technology stack will render well past Step 2's 5-15 row ceiling;
trimming it down is expected, not an exception.

**Fallback only:** if `skill_recommend` is unavailable but `skill_search` is, hand-fill
`${CLAUDE_PLUGIN_ROOT}/templates/docs/SKILLS.template.md` instead — same shape, built by you —
and delete every placeholder row. Record the technologies that matched *nothing* either way:
"the catalog has nothing for this" is a real answer, and writing it down stops the next run
re-litigating it.

**If `docs/SKILLS.md` already exists**, diff rather than overwrite. Keep any line a human clearly
added or annotated, drop rows whose technology is no longer in the stack, and report what changed.
Never silently discard someone's edit.

**If the repo already keeps an equivalent list under another name** — `docs/recommended-skills.md`,
a section inside `docs/PATTERNS.md`, anything serving this purpose — extend THAT in its existing
format and do not create `docs/SKILLS.md` beside it. Two lists of the same thing is the outcome
this command exists to avoid, and `/ml-specs:repo-adopt` step 8b delegates that promise here. Report which
file you extended.

Then make sure `CLAUDE.md`'s knowledge-layer list carries `claudeMdPointer` from the same tool
response — **one line** pointing at the file. A pointer, never the list itself: `CLAUDE.md` loads
on every task and stays a thin index. The tool renders that line as a `-` bullet; if the target
list is numbered, renumber it to match rather than pasting a bullet into a numbered ladder.

## Step 4 — report

Report the stack you matched on, the rows written, the technologies with no match, and anything you
dropped as noise with the reason. Do NOT commit — leave changes for review.

Run `/ml-specs:repo-doctor` if you want the rest of the knowledge layer checked, or `/ml-specs:repo-refresh` if the
stack has moved far enough that `docs/PATTERNS.md` and `docs/ARCHITECTURE.md` are stale too.
