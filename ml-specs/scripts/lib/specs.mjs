// Shared spec parsing. Imported by the MCP server (mcp/ml-specs-server.mjs) and the dashboard
// generator (scripts/spec-dashboard.mjs) so there is exactly one implementation of "what is
// a spec and what does it say" — two copies of this would have drifted within a release.
//
// Pure Node, no dependencies. Read-only.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const LIFECYCLE = ['Draft', 'Approved', 'Implemented', 'Verified', 'Archived'];

// `- [ ] **AC1** — text`, and the plainer `- [ ] AC-1: text`. Both appear in the
// wild: the template writes the first, people hand-write the second.
const AC_LINE = /^\s*-\s*\[([ xX])\]\s*(?:\*\*)?AC-?(\d+)(?:\*\*)?\s*[—–:-]\s*(.+?)\s*$/gm;

/** Acceptance criteria as structured rows, so a script can pair each with a test case. */
export function parseCriteria(text) {
  const out = [];
  for (const m of text.matchAll(AC_LINE)) {
    out.push({
      id: `AC-${Number(m[2])}`,
      ordinal: Number(m[2]),
      text: m[3],
      checked: m[1].toLowerCase() === 'x',
    });
  }
  return out.sort((a, b) => a.ordinal - b.ordinal);
}

// Template placeholders must read as absent. `<repo or service name>` treated as
// a real repo would fan a pull request out to a repository that does not exist.
const PLACEHOLDER = /^(<.*>|_TBD_|—|-|n\/?a|none|tbd)$/i;

/** A comma- or slash-separated header cell as a clean list. */
export function splitCell(value) {
  if (!value) return [];
  return value
    .split(/[,/]/)
    .map((v) => v.replace(/[`*]/g, '').trim())
    .filter((v) => v && !PLACEHOLDER.test(v));
}

// A spec id is digits plus an OPTIONAL letter: 0165 and 0165b are different specs, not a clash.
const SPEC_FILE = /^(\d{4}[a-z]?)-(.+)\.md$/;

/**
 * Resolve a Status cell that holds prose down to one lifecycle word.
 *
 * Two rules, both learned the hard way:
 *  1. Match by position in the TEXT, not position in the enum. Picking the first enum member
 *     that appears anywhere means a status reading "Phase 1 ✓ … verified …" resolves to a stage
 *     its author never claimed — and this feeds a script that rewrites files.
 *  2. Trust the word only when it LEADS the cell. "Implemented (2026-07-07) — …long prose…" is
 *     an author stating a status. A stage word buried mid-sentence is discussion, not a claim,
 *     so when several appear and none leads, say ambiguous and let a human decide.
 */
export function resolveStatus(plain) {
  const text = (plain ?? '').trim();
  if (LIFECYCLE.includes(text)) {
    return { status: text, canonical: true, leading: true, ambiguous: false, candidates: [text] };
  }

  const found = LIFECYCLE
    .map((w) => ({ word: w, at: text.search(new RegExp(`\\b${w}\\b`, 'i')) }))
    .filter((m) => m.at !== -1)
    .sort((a, b) => a.at - b.at);

  if (found.length === 0) {
    return { status: null, canonical: false, leading: false, ambiguous: false, candidates: [] };
  }

  // "Leading" allows for markdown/whitespace the caller already stripped, plus a stray bullet.
  const leading = found[0].at <= 2;
  return {
    status: found[0].word,
    canonical: false,
    leading,
    ambiguous: found.length > 1 && !leading,
    candidates: found.map((m) => m.word),
  };
}

/** Every spec under specs/ and specs/archive/, sorted by id. */
export function listSpecs(root = process.cwd()) {
  const out = [];
  for (const dir of ['specs', 'specs/archive']) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)) {
      const m = f.match(SPEC_FILE);
      if (!m) continue;
      const text = readFileSync(join(abs, f), 'utf8');

      // Header-table cells: take to the LAST pipe on the line — the prose people write in
      // Status often contains pipes, and stopping at the first would silently truncate it.
      const field = (name) => {
        const line = text.split('\n').find((l) =>
          new RegExp(`^\\|\\s*\\*\\*${name}\\*\\*\\s*\\|`, 'i').test(l));
        if (!line) return null;
        const start = line.indexOf('|', line.indexOf(`**${name}**`)) + 1;
        const end = line.lastIndexOf('|');
        if (start <= 0 || end <= start) return null;
        const v = line.slice(start, end).trim();
        return v === '' || v === '—' ? null : v;
      };

      const rawStatus = field('Status');
      const plain = (rawStatus ?? '').replace(/\*\*/g, '').replace(/`/g, '').trim();
      const resolved = resolveStatus(plain);

      const boxes = [...text.matchAll(/^\s*-\s*\[([ xX])\]/gm)];
      const criteria = parseCriteria(text);

      out.push({
        file: `${dir}/${f}`,
        id: m[1],
        slug: m[2],
        title: (text.match(/^#\s+(?:Spec:\s*)?(.+)$/m) ?? [, m[2]])[1].trim(),
        status: resolved.status,
        rawStatus,
        statusIsCanonical: resolved.canonical,
        statusLeading: resolved.leading,       // the word opens the cell — safe to normalize
        statusAmbiguous: resolved.ambiguous,   // several stage words present, none clearly leading
        statusCandidates: resolved.candidates,
        branch: field('Branch'),
        ticket: field('Ticket'),
        acTotal: boxes.length,
        acChecked: boxes.filter((b) => b[1].toLowerCase() === 'x').length,
        archived: dir.endsWith('archive'),
        // Added for the traceability and brief scripts. Existing fields are
        // untouched — the MCP server and the dashboard both read this shape.
        criteria,
        repos: splitCell(field('Project / service') ?? field('Project') ?? field('Repos')),
        nfrs: splitCell(field('NFRs') ?? field('NFR')),
        approvedBy: field('Approved by') ?? field('Approver'),
        author: field('Author'),
      });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Everything a human should look at, derived once so the dashboard, /repo-status and
 * /repo-doctor all flag the same things.
 */
export function analyze(specs) {
  const byStatus = Object.fromEntries(LIFECYCLE.map((s) => [s, 0]));
  let unknownStatus = 0;
  for (const s of specs) {
    if (s.status) byStatus[s.status]++;
    else unknownStatus++;
  }

  const byId = new Map();
  for (const s of specs) {
    if (!byId.has(s.id)) byId.set(s.id, []);
    byId.get(s.id).push(s.file);
  }

  const acTotal = specs.reduce((n, s) => n + s.acTotal, 0);
  const acChecked = specs.reduce((n, s) => n + s.acChecked, 0);

  return {
    total: specs.length,
    active: specs.filter((s) => !s.archived).length,
    byStatus,
    unknownStatus,
    acTotal,
    acChecked,
    duplicateIds: [...byId.entries()].filter(([, f]) => f.length > 1).map(([id, files]) => ({ id, files })),
    nonCanonical: specs.filter((s) => s.rawStatus && !s.statusIsCanonical),
    // Claims the repo can't back up, in severity order.
    attention: [
      ...specs
        .filter((s) => s.status === 'Implemented' && s.acTotal > 0 && s.acChecked < s.acTotal)
        .map((s) => ({ level: 'critical', spec: s, why: `Implemented but ${s.acTotal - s.acChecked} of ${s.acTotal} criteria unchecked` })),
      ...specs
        .filter((s) => s.status === 'Verified' && !s.archived && s.acTotal > 0 && s.acChecked < s.acTotal)
        .map((s) => ({ level: 'critical', spec: s, why: 'Verified with unchecked criteria — the status claims evidence that is not there' })),
      ...specs
        .filter((s) => !s.status && s.rawStatus)
        .map((s) => ({ level: 'serious', spec: s, why: `Status has no lifecycle word: "${s.rawStatus.slice(0, 60)}"` })),
      ...specs
        .filter((s) => !s.archived && (s.status === 'Draft' || s.status === 'Approved') && !s.branch)
        .map((s) => ({ level: 'warning', spec: s, why: `${s.status} with no branch recorded — not started` })),
      ...specs
        .filter((s) => s.acTotal === 0 && !s.archived)
        .map((s) => ({ level: 'warning', spec: s, why: 'No acceptance criteria — nothing to verify against' })),
    ],
  };
}
