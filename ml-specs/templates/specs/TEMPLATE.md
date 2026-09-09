# Spec: <short title>

| | |
|---|---|
| **Ticket** | XXX-0000 |
| **Project / service** | <repo or service name> |
| **Stack** | <e.g. Java/Spring, React, Node/Express, NestJS — fill from the repo> |
| **Status** | Draft \| Approved \| Implemented \| Verified \| Archived |
| **Branch** | <branch this is built on — set by `/spec-advance`; `—` until work starts> |
| **Author** | <name> |
| **Date** | YYYY-MM-DD |

> Status is written by `/spec-advance`, which checks the evidence each transition requires
> (see `specs/README.md`). Don't hand-edit it — a status nobody checked is worth nothing.

## Revisions
<Skip this section entirely if the spec was approved first pass — it exists only to bound
re-review. Add one row per revision, newest first, so a reviewer re-reads what moved instead of
re-reading the whole spec.>

| # | What changed | Why | Sections |
|---|--------------|-----|----------|
| 2 | <e.g. 409 → 422 on expired coupon> | <reviewer: 409 implies a conflict that doesn't exist> | 4.1, AC3 |
| 1 | <initial draft> | — | — |

## 1. Problem / Goal
<What user/business problem are we solving, and why now? 2–4 sentences. No solution here.>

## 2. Scope
**In scope**
- <bullet>

**Non-goals** (explicitly NOT doing)
- <bullet>

## 3. Current behavior
<How does the relevant part work today? Reference real code: `path/to/File.ext:42`. If new, say "new".>

## 4. Proposed change
> Fill only the subsections that apply to this change and this stack. Delete the rest.

### 4.1 API / interface contract
<The contract this change exposes or consumes. Pick what fits:>
- **HTTP API** (Java controller, Express route, NestJS controller): method + path, request shape,
  response shape, status codes, error cases.
- **UI component / module** (React): component name, props in/out, state, events/callbacks,
  the data it fetches and from where.
- **Library/function**: signature, inputs, outputs, errors thrown.

| Method/Type | Path / name | Request / props | Response / return | Notes |
|-------------|-------------|-----------------|-------------------|-------|
| | | | | |

### 4.2 Data / state model
<Pick the row(s) that apply:>
- **Relational (MySQL/PostgreSQL):** new/changed tables, columns, types, indexes, constraints,
  and the **migration** (never hand-edited schema). Note transactions where multiple writes
  must be atomic. Mind dialect specifics (Postgres `SERIAL`/`RETURNING` vs MySQL `AUTO_INCREMENT`).
- **Document (MongoDB):** new/changed collections, document shape, schema/validation, indexes,
  and any migration/backfill of existing documents.
- **Client state (React):** new/changed state shape, where it lives (component, store, cache),
  and how it's derived/invalidated.

### 4.3 Events / side-effects
<Async messages, queues/topics, jobs, webhooks, cache invalidation, emails — payload shape,
idempotency, and failure handling. Omit if none.>

### 4.4 External / cross-service / integration calls
<Outbound calls to other services or third parties (HTTP client, Feign, SDK). For each: what's
called, the contract assumed, and failure/timeout behavior. Omit if none.>

### 4.5 Config / feature flags / env
<New config keys, environment variables (`.env`), feature flags to gate rollout, profiles affected.>

## 5. Acceptance criteria
<Testable Given/When/Then statements. These become the tests AND the review checklist.>

- [ ] **AC1** — Given <state>, when <action>, then <observable outcome>.
- [ ] **AC2** — ...

## 6. Test plan
<Map each AC to at least one test using THIS project's framework. Pick the level that actually
proves the AC — don't over- or under-test:>
- **unit** — pure logic in isolation (Java `*Test.java`; Jest/Vitest).
- **integration** — module + its real collaborators / DB (Java `*IT.java`; Supertest, `@nestjs/testing`).
- **functional / E2E** — the behavior end to end from the outside, the way a user or caller hits it
  (HTTP black-box against the running service; UI flows via Playwright/Cypress). **Every
  user-facing or contract-level AC needs at least one functional/E2E test**, not just a unit test.

| AC | Test type (unit / integration / functional-e2e) | Test file / class / method |
|----|-------------------------------------------------|----------------------------|
| AC1 | unit | |

### 6.1 Final acceptance (gate before `Verified`)
The spec is **not** `Verified` until the project's **full** test suite — including the
functional/E2E tests above — runs green end to end (not just the newly-added tests). List the
command(s) that constitute that final run and any seed/fixtures/services they need:

- Full suite: `<e.g. npm test && npm run test:e2e / mvn verify / pytest && pytest -m e2e>`
- Preconditions: `<test DB seeded, service running, env vars — or "none">`

## 7. Rollout & risks
<Deploy order if cross-service, backward compatibility, data migration risk, rollback plan,
and mitigations.>

## 8. Open questions / follow-ups
<**Non-blocking items only** — things whose answer changes nothing in this spec: a later
optimization, a question for another team, a deferred follow-up. If an answer would change the API
shape, data model, error/status codes, scope boundary, or backward compatibility, it is
**blocking**: it must be answered *before* this spec is written, not parked here. A blocking
question in this section is a bug — it turns one human review into a review, a revision, and a
re-read. Empty is the healthy state.>

- <bullet>
