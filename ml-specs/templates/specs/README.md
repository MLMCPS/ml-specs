# Spec-Driven Development (SDD)

Every non-trivial change starts with a **spec** — a reviewable document that defines
*what* and *why* before any *how* is written. The spec is the contract Claude implements
against, and the artifact a human reviews **before** code exists.

> One-line / trivial fixes don't need a spec. Anything touching an API, a data model,
> an event, cross-service behavior, or more than ~one file does.

## The loop

```
  0. ANALYZE   →   1. SPECIFY   →   2. PLAN   →   3. IMPLEMENT   →   4. VERIFY
   (optional)       (write spec)   (approve)     (code + tests)    (review + CI)
```

0. **Analyze** (optional) — `/ml-specs:spec-explore <ticket-or-description>`
   For a half-formed idea, or a change where the *approach* is the open question rather than the
   details. The `analyst` agent compares two or three approaches with what each costs and what it
   forecloses, names the cross-module ripple, and surfaces the blocking contract questions — then
   the command writes `specs/explore-<slug>.md`. Nothing is committed to: no spec, no code, no
   `Status`, and no number.

   `/ml-specs:spec` picks that note up on its own and carries its blocking questions and its
   **rejected** approaches into the spec, so a reviewer three weeks later can tell an alternative
   that was considered and dismissed from one nobody thought of.

   **Skip it whenever the approach is obvious.** This step is optional and the loop below is
   unchanged without it.

1. **Specify** — `/ml-specs:spec <ticket-or-description>`
   Claude explores the relevant code, then does two things **before** the spec reaches you:

   - **Asks you the blocking questions up front**, batched, as concrete options with a
     recommendation. A question is blocking if its answer would change a contract (API shape, data
     model, error codes, scope, compatibility). Answering four of these in one pass is cheap;
     discovering them one revision at a time is not.
   - **Runs an adversarial pass over its own draft** (the `spec-reviewer` agent, fresh context)
     and fixes what it finds — contract gaps, untestable criteria, unnamed ripple. Hole-finding is
     the agent's job, not yours.

   Then it writes `specs/NNNN-slug.md` and hands it to you to review and approve. **No
   implementation code is written in this step.** The spec is the source of truth.

   You should be approving, not QA-ing. If a review keeps turning up holes, that's a bug in the
   loop — not a reason to review harder.

   `/ml-specs:spec-review specs/NNNN-slug.md` runs that same adversarial pass on demand. `/ml-specs:spec` already
   does it, so reach for the command when a spec was hand-written, heavily edited, or came from
   someone else.

   **If you send a spec back:** Claude records what changed in the spec's **Revisions** table, so
   round two is a diff read rather than another full read.

2. **Plan** — Claude proposes an implementation plan from the approved spec (plan mode).
   You approve before edits begin.

3. **Implement** — `/ml-specs:spec-build specs/NNNN-slug.md`
   Claude implements **strictly against the spec's acceptance criteria**, writing a test
   for each criterion using this project's framework (Java `*Test.java`/`*IT.java`; React/Node
   Jest/Vitest + Testing Library / Supertest / `@nestjs/testing`). Every user-facing or
   contract-level criterion also gets a **functional/E2E test** (HTTP black-box, or Playwright/
   Cypress UI flow), and Claude runs them. Anything not in the spec is out of scope — if a gap
   surfaces, update the spec first, then continue.

4. **Verify** — `/ml-specs:spec-verify specs/NNNN-slug.md`
   The `reviewer` agent judges the implementation against the spec's acceptance criteria with
   fresh context, and runs the **final acceptance** pass (spec section 6.1): the project's *full*
   test suite, including the functional/E2E tests, green end to end — not just the new tests. Then
   `/code-review` (and `/security-review` where relevant) and the normal CI pipeline — those check
   the diff for bugs, which is a different question from "does it match the spec". Run both.

   Then `/ml-specs:spec-advance specs/NNNN-slug.md Verified`, and `/ml-specs:pr specs/NNNN-slug.md` for the PR text
   with the acceptance criteria as a review checklist.

## Lifecycle

A spec's Status is a claim about reality, so **`/ml-specs:spec-advance` is the only thing that writes it**,
and each transition has to show its evidence:

| Status | Means | Gate to reach it |
|--------|-------|------------------|
| `Draft` | Written, not agreed | — (`/ml-specs:spec` creates it here) |
| `Approved` | The contract is agreed; build it | Human approval + no blocking question left in §8 |
| `Implemented` | Code + tests exist for every criterion | Every AC checked, every §6 test named **exists on disk** |
| `Verified` | It actually works | Clean `/ml-specs:spec-verify` + §6.1 full suite green |
| `Archived` | Merged and closed out | Branch merged → `git mv` to `specs/archive/NNNN-slug.md` |

If the evidence isn't there, the transition is refused — that's the feature. Moving *backwards*
(the contract changed mid-build) is fine and needs no gate, but it must add a **Revisions** row.
`/ml-specs:repo-status` shows where everything sits; `/ml-specs:repo-doctor` flags statuses the repo can't back up.

## Conventions

- Specs are numbered sequentially: `specs/0001-add-coupon-expiry.md`, `specs/0002-...md`. Archiving
  moves the file to `specs/archive/` but **keeps its number** — numbers are never reused.
- **The number comes from every branch, not your working tree.** Two people speccing in parallel
  will otherwise both take the next number and collide at merge — a conflict in a filename, which
  git resolves badly. `/ml-specs:spec` does this for you; by hand it's:
  ```
  git fetch --quiet && git log --all --pretty=format: --name-only --diff-filter=A -- 'specs/[0-9]*' | sort -u
  ```
  If a collision does land, renumber the *later* spec and update its branch name — don't merge two
  specs onto one number.
- Keep the spec in the **same PR/branch** as the implementation — it documents intent and
  lives next to the code it describes.
- A spec is "done" (`Verified`) when every acceptance criterion has a passing test — including a
  functional/E2E test for each user-facing/contract-level criterion — and the project's full test
  suite passes end to end (the final-acceptance run, spec section 6.1).
- Update the spec if reality diverges; a stale spec is worse than none.

## Why this works across many repos and stacks

The same template + the same `/ml-specs:spec` and `/ml-specs:spec-build` commands work in every repo, whatever
the stack (Java, React, Node/Express, NestJS) and database (MySQL, PostgreSQL, MongoDB). The
spec captures the contract — API/interface, data model, events, and any cross-service calls —
explicitly, so changes that ripple between modules or services are designed on paper before
they're coded.
