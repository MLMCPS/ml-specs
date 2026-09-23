---
description: What this repo is wired for and what is missing — the CI gate, the doc gate, hooks, MCP, the knowledge layer — each with the one command that fixes it
argument-hint: (no args) for the report · `--json` · `--emit <surface> [--provider github|azure] [--write <path>]`
model: haiku
---

Mode: **$ARGUMENTS**

Show the user **what is wired here and what is not**. Read-only unless they ask for `--emit … --write`.

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-wiring.mjs $ARGUMENTS
```

## Say the caveat, every time

**Present is not running.** Every row reports whether a file is *there*. A CI workflow sitting in
the tree that nobody enabled reads exactly like one that runs on every pull request, and this
cannot tell them apart. Relay that rather than letting a green row be read as a working gate —
`unavailable ≠ pass` is a failure this toolkit has already written down twice.

## Reading the rows

- **`✗`** is a required surface that is absent. Each names the one command that fixes it, and those
  commands are checked to exist — a remedy naming something that is not there is worse than none.
- **`·`** is optional and absent, which is a valid state, not a gap. Architecture standards,
  host shims and handoff notes are all opt-in; `/ml-specs:repo-doctor` reports them as "not in use"
  for the same reason.
- **uncovered template directories** mean the toolkit ships a template this report knows nothing
  about. That is a gap in the report, not in the repo — say so plainly.

## If they ask to fix one

`--emit <surface>` prints the shipped template to stdout; `--write <path>` writes it, and
**refuses if the file already exists**. Do not work around that refusal by writing the file
yourself — diff against the stdout form instead and let the human merge.

A shipped template is a starting point, not a decision. Say so when one lands.

Next: `/ml-specs:repo-hosts` for which agent hosts are set up, or `/ml-specs:repo-doctor` for statuses the repo cannot back up.
