#!/usr/bin/env bash
# sdd-toolkit :: PreToolUse(Bash) hook — block obvious secrets from reaching a commit.
#
# Exit 2 blocks the tool call; exit 0 allows it. This is the one hook in the plugin that is
# allowed to block, because the cost of a committed key is unbounded and the cost of a false
# positive is one line in an allowlist.
#
# Scope, honestly: it scans the STAGED diff, so it catches `git commit`. On a bare `git add`
# there is usually nothing staged yet and it will pass — the commit is the gate that matters.
# It reads added lines only, so deleting a leaked key is never blocked.
#
# False positive? Add an extended-regex line to .claude/secret-allowlist.txt in the repo;
# matching diff lines are dropped before scanning.

set -uo pipefail

# Only look at git-writing commands. The tool payload arrives as JSON on stdin (older
# versions used $CLAUDE_TOOL_INPUT) — a substring check is enough for a gate.
raw=""
if [ ! -t 0 ]; then raw="$(cat 2>/dev/null || true)"; fi
raw="${raw}${CLAUDE_TOOL_INPUT:-}"
case "$raw" in
  *"git commit"*|*"git add"*) ;;
  *) exit 0 ;;
esac

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
staged="$(git diff --cached -U0 2>/dev/null)" || exit 0
[ -n "$staged" ] || exit 0

# Added lines only ('+++' headers excluded).
added="$(printf '%s\n' "$staged" | grep '^+' | grep -v '^+++' || true)"
[ -n "$added" ] || exit 0

allow="$(git rev-parse --show-toplevel 2>/dev/null)/.claude/secret-allowlist.txt"
if [ -s "$allow" ]; then
  added="$(printf '%s\n' "$added" | grep -vE -f "$allow" || true)"
  [ -n "$added" ] || exit 0
fi

pattern='(AKIA[0-9A-Z]{16}'                                  # AWS access key id
pattern+='|-----BEGIN [A-Z ]*PRIVATE KEY-----'               # PEM private keys
pattern+='|xox[baprs]-[0-9A-Za-z-]{10,}'                     # Slack tokens
pattern+='|gh[pousr]_[0-9A-Za-z]{20,}'                       # GitHub tokens
pattern+='|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.'      # JWTs
pattern+="|(secret|password|passwd|api[_-]?key|token)[\"' ]*[:=][\"' ]*[^\"' ]{8,})"  # key=value

hits="$(printf '%s\n' "$added" | grep -nEi -- "$pattern" | head -5 || true)"
[ -n "$hits" ] || exit 0

{
  echo "BLOCKED: possible secret in the staged diff — review before committing."
  printf '%s\n' "$hits"
  echo "False positive? Add a regex to .claude/secret-allowlist.txt, or unstage the file."
} >&2
exit 2
