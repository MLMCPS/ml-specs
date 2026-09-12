# <project name> — code patterns & conventions

> Learned from the existing codebase by `/ml-specs:repo-init`. This is the agent's "house style" memory:
> how THIS project actually writes code, so new code matches what's already there. Every pattern
> below must cite a real example (`path/to/File.ext:line`). The code is the source of truth — if a
> pattern here drifts from reality, fix this file.
>
> Keep only the rows that apply to this stack; delete the rest. Be concrete, not generic
> ("controllers return `Mono<ResponseEntity<Dto>>` and never throw raw" beats "uses MVC").
>
> **Token budget: keep this under ~200 lines.** This loads into context whenever code is written.
> Cite `file:line` examples — do NOT paste code blocks. One bullet per pattern. In a monorepo,
> give each package its own short section (or its own `PATTERNS.md`) rather than one fat file.
>
> **Mark confidence.** A pattern with 3+ consistent examples is the rule — state it plainly. A
> pattern seen once or guessed, prefix `(inferred)` so the agent re-checks it against the code
> before relying on it. A wrong pattern stated as law is worse than an omission. Never invent a
> convention to fill a section — delete the section instead.

## Stack snapshot
- **Language / framework:** <e.g. TypeScript + NestJS 10 / Java 17 + Spring Boot 3 / React 18 + Vite>
- **Build / package manager:** <Maven · Gradle · npm · yarn · pnpm> (from lockfile)
- **Database / ORM:** <PostgreSQL + Prisma · MySQL + Sequelize · MongoDB + Mongoose · Spring Data>
- **Test stack:** <JUnit · Jest · Vitest · Supertest · @nestjs/testing · Playwright>
- **Lint / format / typecheck:** <ESLint + Prettier · `tsc --noEmit` · Checkstyle/Spotless>

## Directory layout
<The real tree the agent should mirror when adding files. One line per significant dir + what lives there.>
```
src/
  ...        # <what goes here>
```

## Naming conventions
- **Files:** <e.g. `kebab-case.ts`, one component per file; `*.controller.ts` / `*.service.ts`>
- **Types/classes/components:** <`PascalCase`; React components `PascalCase.tsx`>
- **Functions/vars:** <`camelCase`>; **constants:** <`SCREAMING_SNAKE`>
- **Tests:** <`*.spec.ts` next to source / `*Test.java` / `__tests__/`>
- Example: `path/File.ext:line`

## How a feature is structured (the layered flow)
<Trace one real feature end to end so the agent can copy the shape. e.g.>
- Entry: <route/controller> — `path:line`
- Business logic: <service/provider> — `path:line`
- Data access: <repository/model/ORM> — `path:line`
- Input/output shape: <DTO/schema/validation> — `path:line`

## Data access & migrations
- How models/entities are defined — `path:line`
- How queries/transactions are written (ORM calls, not raw SQL unless shown) — `path:line`
- How schema changes ship (migration dir + command, e.g. `sequelize-cli db:migrate`) — `path:line`

## API / interface contracts
- Request validation: <Zod / class-validator / Joi / Bean Validation> — `path:line`
- Response shape & serialization (DTOs, never leak entities) — `path:line`
- Status codes / pagination / common envelope, if any — `path:line`

## Error handling
- Error types and where they're thrown — `path:line`
- Central handler/middleware/filter that maps them to responses — `path:line`
- Rule: <e.g. "throw typed errors, never build ad-hoc error bodies in controllers">

## Validation, config & secrets
- Config/env access pattern (`.env`, config service, `@ConfigService`) — `path:line`
- Never hard-code secrets; how the project reads them — `path:line`

## Logging & observability
- Logger used and how it's invoked — `path:line`

## Testing patterns
- Unit test shape (arrange/act/assert, mocking style) — `path:line`
- Integration test shape (test DB, fixtures, Supertest/`@nestjs/testing`) — `path:line`
- Functional/E2E shape (HTTP black-box against the running app; Playwright/Cypress UI flows;
  how the app/DB is started for the run) — `path:line`
- Test command(s): unit/integration `<npm test, mvn test, …>`; functional/E2E
  `<npm run test:e2e, mvn verify, npx playwright test, …>`; full final-acceptance run
  `<the command that runs everything end to end>`

## Don'ts (project-specific anti-patterns observed/avoided)
- <e.g. "no `any` — strict TS", "no raw SQL", "no new `.block()` calls", "no direct entity returns">
