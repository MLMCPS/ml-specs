---
description: Make a code change in any project with the senior-engineer coding agent (detects the stack, smallest correct change, tests)
argument-hint: <what to change — a task, bug, or small feature>
---

Use the **coder** agent to carry out this change in the current project:

**Task:** $ARGUMENTS

Operate as a senior engineer in an existing codebase, in whatever language/stack this project
uses:

1. **Detect the stack first** — find the manifest/build file (`package.json`, `pom.xml`,
   `pyproject.toml`, `go.mod`, `Gemfile`, `composer.json`, `Cargo.toml`, `*.csproj`, …), the real
   task runner/commands (`package.json` scripts, `Makefile`/`Taskfile`/`justfile`, or the
   ecosystem's standard tool), and whether it's a monorepo (work in the right sub-package). Read
   `CLAUDE.md`, `docs/PATTERNS.md`, and `docs/ARCHITECTURE.md` if present.
2. **Inspect before editing** — identify the relevant files; never assume structure.
3. **Smallest correct change** — match the surrounding code's conventions, reuse existing
   utilities, don't add dependencies/patterns without reason.
4. **If a contract-level decision is ambiguous** (API shape, data model, error/status codes,
   breaking change) or this clearly warrants a spec (touches an API, data model, or several
   files), STOP and ask — or suggest `/spec` instead of guessing.
5. **Test** — write/adjust tests and run the project's real test/lint/typecheck commands; report
   REAL results.
6. Respond in the fixed format: `PLAN / FILES TO INSPECT / IMPLEMENTATION / REVIEW / TESTS`.

For anything non-trivial (an API/data-model/multi-file change), prefer the spec loop: `/spec
<ticket>` → review → `/spec-build`.
