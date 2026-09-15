---
description: Draft a spec-driven-development spec for a feature/ticket (no implementation)
argument-hint: <ticket-id or short feature description>
---

You are in the **SPECIFY** phase of spec-driven development. Your job is to produce a
specification document — **do NOT write any implementation code in this phase.**

Feature / ticket: **$ARGUMENTS**

Aim for a spec the human can approve in **one pass**. Every blocking question you leave in the
document costs them a read, a revision, and a re-read — so resolve those up front, and let an
adversarial pass find the holes before the human does rather than after.

Steps:

0. **Look for an existing analysis.** Glob `specs/explore-*.md` and read each header table.
   `/ml-specs:spec-explore` may already have compared the approaches and found the blocking
   questions; re-deriving them wastes the pass and loses the alternatives it rejected.

   **The branch is decided per note, on that note's own `Ticket` cell — not on the argument.** For
   each globbed note: if its `Ticket` cell **contains `no tracker`, case-insensitively** (so
   `— (no tracker; proposed 2026-09-12)` counts), match it on **Title**; otherwise compare its
   `Ticket` cell to the argument **exactly**, and do not Title-match it at all. A note carrying a
   real tracker ID is therefore never reached by free-prose input: a tracker ID is an exact key, and
   guessing past it is how the wrong analysis gets attached.

   When Title-matching, compare as **normalized tokens**. Normalize by: lowercase; **replace every
   run of non-alphanumeric characters with a single space** (so `spec-explore` becomes the two
   tokens `spec`, `explore` — punctuation is replaced, never deleted); trim; split on spaces. A note
   matches when the **shorter** token list appears in the longer **in order** — an in-order
   subsequence, not necessarily contiguous — **and** the shorter list has **at least two tokens**.
   So `add explore phase` matches a note titled `Add the explore phase`, while a one-word argument
   like `fix` is below the floor and matches nothing.

   **Report every match and ask which to use — never pick one silently.** A loose match silently
   attached to the wrong spec is worse than a question. **With no match, say so and proceed exactly
   as today** — `/ml-specs:spec-explore` is optional and this command is unchanged without it.

   When a note *is* matched and chosen, **consume it**: take its **blocking questions** into step 3
   and ask those rather than re-deriving them, and take its **rejected approaches** into the spec's
   rationale so a later reader can see what was considered and dismissed. A note nothing reads is a
   document nobody should have written.

1. Detect the stack (any language) from the manifest/build file and existing source, then read
   `CLAUDE.md`, `docs/PATTERNS.md`, and `specs/README.md` so you follow this project's conventions.

2. Explore the relevant code to ground the spec in reality (current behavior, the affected
   module/component/bounded context, the data/API contracts, relevant events or cross-module
   calls). Cite real `file:line` references.

3. **Resolve blocking ambiguity BEFORE writing — never defer it into the document.** A question is
   **blocking** if its answer would change a contract: API shape, data model or migration,
   error/status codes, scope boundary, or backward compatibility. Rule of thumb: if knowing the
   answer would make you rewrite a section, it's blocking.
   Ask all of them in **one batch** with the AskUserQuestion tool — never one at a time, and never
   as open prose. Each question gets concrete options grounded in the code you just read, your
   recommendation first, and a line on what choosing it means. The user should be able to accept
   your defaults in seconds.
   A question whose answer changes **nothing** in this spec (a later optimization, something for
   another team) is not blocking — that goes in section 8, and only that.

4. Copy `specs/TEMPLATE.md` and fill every section, using the answers from step 3. Make acceptance
   criteria concrete and testable (Given/When/Then), and map each AC to a planned test for this
   project's stack. (If `specs/` or `specs/TEMPLATE.md` is missing, the repo hasn't been set up —
   tell the user to run `/ml-specs:repo-init` first, or fall back to the plugin template at
   `${CLAUDE_PLUGIN_ROOT}/templates/specs/TEMPLATE.md`.)

5. **Actually create the file** — use the Write tool to save it as `specs/NNNN-<slug>.md`,
   creating the `specs/` directory if it doesn't exist. Do NOT just print the spec in chat — it must
   land on disk.

   **Pick NNNN from every branch, not just this one.** The next number after the highest that
   exists *anywhere*, or two people speccing in parallel both get `0007-` and find out at merge:

   ```
   git log --all --pretty=format: --name-only --diff-filter=A -- 'specs/[0-9]*' | sort -u
   ```

   Union that with the working tree (`specs/` and `specs/archive/`) and take max + 1. If the repo
   has a remote, `git fetch --quiet` first so branches you haven't pulled are counted too — and if
   the fetch fails (offline, no remote), say so and note the number may collide, rather than
   quietly numbering off a stale view.

6. **Adversarial pass before the human sees it.** Spawn the **spec-reviewer** agent on the file
   you just wrote. It reads with fresh context and will catch contract gaps and untestable criteria
   you cannot see, because you wrote them. Fix every **blocker** and **needs-work** item it returns.
   If a fix needs a human contract decision, batch it back through AskUserQuestion (step 3) — do
   not write it into section 8 instead. Re-run the reviewer only if you made substantial changes.

7. Summarize for the user: the spec path, the contract decisions taken, cross-module impact, and
   what the reviewer flagged and you fixed. Then **ask them to review/approve.** On their approval,
   record it with `/ml-specs:spec-advance specs/NNNN-<slug>.md Approved`; the next step after that is
   `/ml-specs:spec-build specs/NNNN-<slug>.md`. Leave the Status at `Draft` yourself — you don't approve
   your own spec.

**If the user sends the spec back for changes:** update the file, add a row to its **Revisions**
table recording what changed and why, and point them at that row. They should only have to re-read
what moved — not the whole document.

Keep the spec tight and honest. Flag risks and cross-service impacts explicitly.
