#!/usr/bin/env bash
# ml-specs :: PreToolUse hook — refuse a write outside the active spec's declared Touches.
#
# Exit 2 blocks the tool call and hands stderr back to the model; exit 0 allows it. That is the
# HOST's contract — everywhere else in this plugin 2 means "could not run".
#
# It fails open on purpose: no active spec, a spec with no Touches row, no node on PATH, or a
# payload with no file path in it all ALLOW. A guard that blocks when it is confused gets switched
# off after one bad afternoon, and a switched-off guard protects nothing.
set -uo pipefail

# ${CLAUDE_PLUGIN_ROOT} is where the plugin lives; ${CLAUDE_PROJECT_DIR} is the repo being edited.
# Both are set by the host. Without the first there is nothing to run, and saying so beats
# failing silently — an unenforced write that announces itself is recoverable.
guard="${CLAUDE_PLUGIN_ROOT:-}/scripts/spec-guard.mjs"
if [ ! -f "$guard" ]; then
  echo "ml-specs: scope-guard is not installed (no CLAUDE_PLUGIN_ROOT) — the guard is not running" >&2
  exit 0
fi
command -v node >/dev/null 2>&1 || {
  echo "ml-specs: node is not on PATH — the scope guard is not running" >&2
  exit 0
}

exec node "$guard" --stdin --root "${CLAUDE_PROJECT_DIR:-$PWD}"
