// What the guard decided, and why.
//
// A blocked write leaves no trace. So the question anybody actually asks in the first week —
// "is this guard helping, or is it getting in my way?" — has no evidence behind it but memory,
// and memory answers that question badly: one annoying refusal is remembered and ten silent
// allows are not. A guard evaluated that way gets switched off.
//
// One line per decision, append-only, so the answer is countable instead of felt.
//
// ── What is NOT written here ────────────────────────────────────────────────────────────────
//
// Never the file's contents, and never the proposed edit. The guard receives what an agent is
// about to write, and a second copy of somebody's source sitting in a log file is a worse leak
// than anything the guard prevents. Paths, a decision and a reason — never a byte of content.
//
// Paths are not all repository-relative, though, and this comment used to say they were. A write
// the guard blocks is by definition a write OUTSIDE the repo, and `scope.mjs:63` hands back the
// absolute path in that case by design — so a blocked write to a home-directory credentials file
// records where that file lives. A name is not its contents and nobody gains access through this,
// but it is a local path trail, which is why `.gitignore` holds this log while the evidence
// records beside it are committed. Do not move it into `.ml-specs/evidence/`.
//
// Failing to write the log NEVER changes the decision. A guard that refuses a write because it
// could not open its own log file would be refusing for a reason that has nothing to do with
// scope, which is the fastest way to lose the argument for having one.

import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const LOG = join('.ml-specs', 'activity.jsonl');

/**
 * Append one decision. Returns nothing and throws nothing.
 *
 * @param {string} root
 * @param {{decision: 'allow'|'block', reason?: string, spec?: string|null, files?: string[], tool?: string|null}} entry
 */
export function record(root, entry) {
  try {
    const line = JSON.stringify({
      at: new Date().toISOString(),
      decision: entry.decision,
      spec: entry.spec ?? null,
      tool: entry.tool ?? null,
      // Capped. A payload naming two hundred files is a real thing and a log line holding all of
      // them is not readable by anybody.
      files: (entry.files ?? []).slice(0, 12),
      more: Math.max(0, (entry.files ?? []).length - 12),
      reason: entry.reason ? String(entry.reason).split('\n')[0].slice(0, 200) : null,
    });
    mkdirSync(join(root, dirname(LOG)), { recursive: true });
    appendFileSync(join(root, LOG), `${line}\n`);
  } catch {
    // Deliberately silent — see the header. The decision has already been made.
  }
}

/** @returns {object[]} every decision, oldest first. A line nobody can parse is skipped. */
export function read(root) {
  const path = join(root, LOG);
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // A half-written line from an interrupted process is not a decision; it is noise.
    }
  }
  return out;
}

/**
 * @returns {{total, allowed, blocked, blockRate, bySpec: object, topPaths: Array}}
 *
 * `blockRate` is the number the rollout question turns on. A guard blocking almost nothing is
 * either working or unnecessary and the log cannot tell you which; one blocking a large share of
 * writes is being fought, and that is a `Touches` row too narrow rather than an agent misbehaving.
 */
export function summary(entries) {
  const blocked = entries.filter((e) => e.decision === 'block');
  const bySpec = {};
  const paths = {};
  for (const e of blocked) {
    bySpec[e.spec ?? '(no spec)'] = (bySpec[e.spec ?? '(no spec)'] ?? 0) + 1;
    for (const f of e.files ?? []) paths[f] = (paths[f] ?? 0) + 1;
  }
  return {
    total: entries.length,
    allowed: entries.length - blocked.length,
    blocked: blocked.length,
    blockRate: entries.length ? blocked.length / entries.length : 0,
    bySpec,
    topPaths: Object.entries(paths).sort((a, b) => b[1] - a[1]).slice(0, 10),
  };
}
