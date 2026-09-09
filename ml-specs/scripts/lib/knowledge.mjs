// The knowledge layer: standing constraints on disk, in docs/CONSTRAINTS.md.
//
// Pure Node, no dependencies. Writes one file, only when asked.
//
// Why a markdown file and not a database: this is read by people during spec
// review far more often than by this code, and a change to what is in force
// should diff in a pull request like any other change. A store only a machine
// can read becomes a store nobody checks — which is worse than none, because it
// looks like governance while enforcing nothing.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const BEGIN = '<!-- sdd:constraints -->';
const END = '<!-- /sdd:constraints -->';
const REFRESHED = '<!-- sdd:refreshed ';
const LINE = /^-\s+`([A-Za-z0-9_.-]+)`\s+\[([^\]]*)\]\s+(.+)$/;

const HEADER = `# Standing constraints

Constraints in force while authoring any spec. Generated — change the source
(the NFR table, or the incident that produced a lesson) rather than this file.

`;

export function read(path) {
  if (!existsSync(path)) return [];
  const body = readFileSync(path, 'utf8');
  if (!body.includes(BEGIN)) return [];
  const block = body.split(BEGIN)[1].split(END)[0];

  const out = [];
  for (const line of block.split('\n')) {
    const m = LINE.exec(line.trim());
    if (!m) continue;
    const scope = m[2].split(',').map((s) => s.trim()).filter(Boolean);
    out.push({ id: m[1], scope: scope.length ? scope : ['*'], text: m[3] });
  }
  return out;
}

/** Days since the file was last written, or null if it never was. */
export function staleness(path, today = new Date()) {
  if (!existsSync(path)) return null;
  const m = readFileSync(path, 'utf8').match(new RegExp(`${REFRESHED}(\\d{4}-\\d{2}-\\d{2})`));
  if (!m) return null;
  const then = new Date(`${m[1]}T00:00:00Z`);
  return Math.floor((today - then) / 86400000);
}

/**
 * What a spec touching these repos inherits. A constraint scoped `*` applies
 * everywhere; a spec that names no repo yet still inherits the estate-wide ones,
 * which is the common case early in a spec's life.
 */
export function forRepos(constraints, repos = []) {
  if (!repos.length) return constraints.filter((c) => c.scope.includes('*'));
  return constraints.filter((c) => c.scope.includes('*') || repos.some((r) => c.scope.includes(r)));
}

/** Upsert by id. Returns the ids that actually changed, so a caller need not
 *  claim a write that was a no-op. */
export function write(path, incoming, today = new Date()) {
  const existing = new Map(read(path).map((c) => [c.id, c]));
  const changed = [];

  for (const c of incoming) {
    const prev = existing.get(c.id);
    if (!prev || prev.text !== c.text || prev.scope.join() !== c.scope.join()) changed.push(c.id);
    existing.set(c.id, c);
  }

  const rows = [...existing.values()].sort((a, b) => a.id.localeCompare(b.id));
  const lines = rows.length
    ? rows.map((c) => `- \`${c.id}\` [${c.scope.join(', ')}] ${c.text}`)
    : ['_none — no NFR has been compiled and no incident has produced a lesson._'];

  const stamp = today.toISOString().slice(0, 10);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${HEADER}${REFRESHED}${stamp} -->\n\n${BEGIN}\n${lines.join('\n')}\n${END}\n`);
  return changed;
}

/** The block stamped into a new or briefed spec, so constraints are in front of
 *  whoever writes it rather than in a file they are trusted to have read. */
export function renderForSpec(constraints) {
  if (!constraints.length) return '';
  return ['## Constraints in force', '',
          '_Read while authoring. Generated from the knowledge layer._', '',
          ...constraints.map((c) => `- **${c.id}** — ${c.text}`)].join('\n') + '\n';
}
