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
   tell the user to run `/repo-init` first, or fall back to the plugin template at
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
   record it with `/spec-advance specs/NNNN-<slug>.md Approved`; the next step after that is
   `/spec-build specs/NNNN-<slug>.md`. Leave the Status at `Draft` yourself — you don't approve
   your own spec.

**If the user sends the spec back for changes:** update the file, add a row to its **Revisions**
table recording what changed and why, and point them at that row. They should only have to re-read
what moved — not the whole document.

Keep the spec tight and honest. Flag risks and cross-service impacts explicitly.
