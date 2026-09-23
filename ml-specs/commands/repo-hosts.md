---
description: Which agent hosts this repo is set up for, where an install would land, and which rows are unverified — read-only
argument-hint: (no args) for the board · `--json` for the payload
model: haiku
---

Show the user **which coding-agent hosts this repository is wired for**. Read-only. Do NOT install
anything and do NOT edit a file — installing is a separate, deliberate act the user runs themselves.

Mode: **$ARGUMENTS**

Run this once, and report what it says:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ml-specs.mjs hosts
```

## Reading the output

Sixteen rows. Four things are worth saying out loud, because each is easy to misread:

- **`claude-code` is `served by the plugin, not by a shim`.** That is not a gap. A Claude Code user
  adds the `ml-tools` marketplace and gets 24 commands, 10 agents and the hooks; a generated shim
  would be a worse copy of what they already have. Do not offer to "fix" it.
- **`unverified` means nobody has run it**, not that it is broken. The path and format come from the
  vendor's documentation. Fifteen of sixteen rows say so, and that is the honest state — say it
  plainly rather than rounding it up to "supported".
- **`detected` and `installed` are different questions.** Detected means the host's binary or its
  config directory is present on this machine. Installed means a shim was written here and recorded
  in `.ml-specs.json`. A host can be detected and not installed, which is usually the interesting
  row.
- **`drift`** means a project-scope loop document and a user-scope one no longer match. Say which
  two files, and that re-running the install for the one they want to keep resolves it.

## What to do with it

Summarise; do not dump sixteen rows when three matter. Lead with what is installed, then what is
detected but not installed, then the count of the rest. If nothing is installed, say so in one line
and name the one command that would change it — `npx @mlmcps/ml-specs install --host <id>` — without
running it.

Next: `/ml-specs:repo-status` for the spec board, or `/ml-specs:repo-doctor` if a row looks wrong.
