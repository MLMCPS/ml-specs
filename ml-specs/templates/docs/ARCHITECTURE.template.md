# <project name> — architecture summary

> Auto-maintainable summary the coding agent reads **first** to orient before searching.
> Regenerate when structure/endpoints/data layer change (see "Keeping this fresh" at the bottom).
> Source of truth is the code; if this disagrees with the code, the code wins — fix this file.
>
> This is a **stack-neutral skeleton**. Keep the sections that apply to THIS project's stack
> (Java/Spring, React, Node/Express, NestJS, or any other) and delete the rest. Fill every kept
> section with real `file:line` references — do not leave placeholders.
>
> **Token budget: keep this under ~200 lines.** It's a *map*, not the territory — terse tables and
> `file:line` pointers, not prose or pasted code. If it grows past the budget, split per-context /
> per-package or push detail down into the code (which the agent greps on demand).
>
> **Large application? Shard it (the key scaling move).** Do NOT grow one giant file. Keep THIS
> file as a tiny **router**: the "What it is" blurb + the Structure table where each row links to a
> per-module shard `docs/architecture/<module>.md` (each its own ≤~150-line map). The agent reads
> this router (cheap), then loads only the ONE shard for the module a task touches. Same idea for
> patterns: a per-module `docs/patterns/<module>.md` when conventions differ across modules.
> See "Large-codebase layout" at the bottom.

## What it is
<1–3 sentences: what this app/service does, the stack (language, framework, build tool), and
the database engine. Rough size (file/LOC count) helps. If it's one of several services, say so
and link `docs/ESTATE.md`.>

## Structure (where to look by feature)
<How the code is organized. Pick the shape that matches the stack:>
- **Java/Spring:** bounded contexts / packages — `controller → service → domain → repository`,
  plus `events/*` for messaging. Table of contexts with base path + one-liner.
- **Node (Express/NestJS):** modules/routers → controllers → services/providers → data layer;
  middleware or guards/interceptors/pipes. Table of modules with route prefix + one-liner.
- **React:** routes/pages → feature components → shared components/hooks → API/data layer; where
  state lives. Table of routes/features with one-liner.

| Area / module / route | Path | One-liner |
|-----------------------|------|-----------|
| | | |

## Data & persistence (the #1 gotcha)
<The database and how the code talks to it. Be specific — this is where bugs hide.>
- **Engine:** MySQL / PostgreSQL / MongoDB (+ any cache like Redis, object store like S3).
- **Access layer:**
  - Relational: ORM (Sequelize/Prisma/TypeORM, or Spring Data JPA) — where models/entities and
    **migrations** live; transaction style; dialect-specific bits.
  - MongoDB: Mongoose/Spring Data Mongo schemas, validation, indexes; reactive vs blocking (Java).
- **Migrations:** how schema changes ship (e.g. `sequelize-cli db:migrate`, Prisma migrate, Flyway).

## Events / async / side-effects
<Queues, topics, jobs, webhooks, cache invalidation, email. Producer/consumer + payload + failure
handling. Omit if the app has none.>

## External / cross-service calls
| Client / proxy | Target | Purpose |
|----------------|--------|---------|
| | | |
<HTTP clients, Feign proxies, third-party SDKs. Note error/timeout handling. Omit if none.>

## Cross-cutting
- **Errors:** how errors are represented and surfaced (global handler/middleware/filter; error
  types). Don't invent ad-hoc error shapes.
- **Auth:** in-app (JWT/passport/guards) or delegated to a gateway? Say which.
- **Config:** env vars / `.env` / config server / profiles.
- **Quality gates:** lint/format/typecheck and test commands (see CLAUDE.md).

## Large-codebase layout (sharded — fill the Structure table above with these links)
For a big app, this file is just the router; the detail lives in per-module shards loaded on demand:
```
docs/
  ARCHITECTURE.md            # THIS router: blurb + Structure table + the contract index below
  architecture/
    <module-a>.md            # ≤~150 lines: structure, data, events, calls + a "Depends on/Used by" header
    <module-b>.md
  patterns/                  # only if conventions differ per module
    <module-a>.md
```
The agent's path: read `ARCHITECTURE.md` (router) → open the ONE shard for the module the task
touches → grep within that module for exact lines. It never loads modules it isn't working on.

### When modules are interlinked (edges, not just nodes)
Sharding by module only works if you also capture the **contracts between modules** — otherwise a
change that ripples across modules misses the other side. So:

- **Every shard starts with a `## Depends on / Used by` header** listing its edges — the modules it
  calls and is called by, each as a one-line contract pointer (`event/API/shared type → file:line`).
  This is the cheap, always-small part; it's what makes the graph navigable.
- **Module contract index (below)** is the join table: the shared contracts (events, shared
  DTOs/types, shared DB tables, internal APIs) and which modules produce/consume each.
- **Load the dependency closure, bounded:** for a task on module X, load X's full shard **plus only
  the `Depends on / Used by` + relevant contract section of its direct neighbors** — not the
  neighbors' full shards. That's 1-hop: enough to honor the contract, still bounded.
- **If "everything depends on everything"** that's coupling worth surfacing, not hiding. Keep a
  single always-loaded **`docs/architecture/_core.md`** for the truly shared contracts, and let the
  **spec** own the cross-module contract explicitly (template §4.1/4.3/4.4). Tightly-coupled specs
  must be **sequenced, not parallelized** (see `specs/AGENTS.md`).

## Module contract index (the join table — keep in the router)
> The shared edges, so a change designs against both sides. One row per shared contract.

| Contract (event / API / shared type / table) | Produced by | Consumed by | Defined at |
|-----------------------------------------------|-------------|-------------|------------|
| | | | `file:line` |

## Keeping this fresh
Regenerate (or `/ml-specs:repo-refresh`) after changes to routes/endpoints/controllers, the data model or
migrations, event listeners, or external clients. Refresh only the shard(s) that changed — not the
whole set. Use the project's own search (the right grep/glob for the stack), e.g. controllers/route
definitions, `@SqsListener`/queue consumers, ORM model & migration dirs, external-client/proxy
definitions. This file (+ `docs/ESTATE.md` if part of an estate) is the retrieval index; a stale
summary is worse than none.
