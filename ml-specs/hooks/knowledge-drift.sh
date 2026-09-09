#!/usr/bin/env bash
# sdd-toolkit :: SessionStart hook — knowledge-layer drift warning.
#
# Prints ONE line when this repo's learned knowledge layer has fallen behind the code, and
# nothing at all otherwise. Never blocks; always exits 0.
#
# Why a hook rather than a command: /sdd-doctor and /sdd-refresh only run when a human
# remembers to type them, and drift is silent — the docs don't get louder as they get wronger.
# The reminder has to be automatic or it doesn't happen.
#
# Tunable: SDD_DRIFT_THRESHOLD (default 30) — how many source commits since the knowledge
# layer was last touched before it's worth saying anything. Raise it if this gets noisy.

set -uo pipefail

threshold="${SDD_DRIFT_THRESHOLD:-30}"

# Anything unexpected → stay silent. A session-start hook must never be the reason a
# session starts badly.
command -v git >/dev/null 2>&1 || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$root" 2>/dev/null || exit 0

# Only speak in repos that actually use the toolkit.
layer=()
for f in CLAUDE.md docs/PATTERNS.md docs/ARCHITECTURE.md; do
  [ -f "$f" ] && layer+=("$f")
done
[ "${#layer[@]}" -gt 0 ] || exit 0

# When was the knowledge layer last updated?
last="$(git log -1 --format=%H -- "${layer[@]}" 2>/dev/null)"
[ -n "$last" ] || exit 0

# How many commits since then changed real source? Docs and markdown don't count as drift —
# refreshing the docs must not itself look like the code moved.
behind="$(git rev-list --count "$last..HEAD" -- . ':(exclude)docs/*' ':(exclude)*.md' 2>/dev/null)" || exit 0
[ -n "$behind" ] || exit 0
[ "$behind" -gt "$threshold" ] 2>/dev/null || exit 0

echo "sdd-toolkit: the knowledge layer (CLAUDE.md / docs/) is ${behind} source commits behind the code. Run /sdd-doctor to see the drift, /sdd-refresh to fix it."
exit 0
