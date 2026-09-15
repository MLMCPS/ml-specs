#!/usr/bin/env bash
# ml-specs :: SessionStart hook — surface a recent session handoff note.
#
# Prints ONE line when .claude/handoff/ holds a note written recently, and nothing at all
# otherwise. Never blocks; always exits 0. It does not read the note into context and does not
# act on it — surfacing is the whole job.
#
# Why a hook rather than a command: a handoff nobody reads is a handoff nobody should have
# written. The note exists precisely because the next session starts without the last one's
# context, so the reminder has to be automatic or it doesn't happen.
#
# Why not inside knowledge-drift.sh: that script exits early in any repo without a knowledge
# layer, which is exactly a repo where a handoff still matters.
#
# Tunable: ML_HANDOFF_MAX_AGE_DAYS (default 7) — how old a note may be and still be surfaced.

set -uo pipefail

days="${ML_HANDOFF_MAX_AGE_DAYS:-7}"

# Anything unexpected → stay silent. A session-start hook must never be the reason a session
# starts badly. The cd is load-bearing: the find below takes a RELATIVE path, so without it this
# hook goes quiet for every session started in a subdirectory.
command -v git >/dev/null 2>&1 || exit 0
root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$root" 2>/dev/null || exit 0
[ -d .claude/handoff ] || exit 0

# The newest note still inside the age window. -mtime is POSIX and behaves identically on
# BSD/macOS and GNU/Linux; `date` arithmetic does not (date -v-7d vs date -d '7 days ago').
# The <YYYY-MM-DD-HHMMSS> prefix makes "newest" a lexical sort, needing no date arithmetic here.
newest="$(find .claude/handoff -type f -name '*.md' -mtime "-${days}" 2>/dev/null | sort | tail -1)"
[ -n "$newest" ] || exit 0

# The printed date is a fixed-width slice of a name /ml-specs:handoff itself wrote — bash
# parameter expansion, no subprocess, no parsing, and not what decides whether to speak.
base="${newest##*/}"
when="${base:0:10}"

echo "ml-specs: a session handoff from ${when} is waiting — .claude/handoff/${base}. Read it before you start, or delete it if that work is done."
exit 0
