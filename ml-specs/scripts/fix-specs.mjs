#!/usr/bin/env node
// Repair spec hygiene in a repo that has been using specs/ for a while.
// Pure Node, no dependencies. Runs entirely on your machine — no network calls.
//
//   node fix-specs.mjs --root /path/to/repo              # dry run: prints the plan, writes nothing
//   node fix-specs.mjs --root /path/to/repo --apply      # actually does it
//
// Two repairs, both opt-outable (--no-numbering / --no-status):
//
//   NUMBERING  Two specs sharing a number is a filename collision — git merges those badly.
//              The later-created file is renumbered to the next free number, across ALL
//              branches, and references to its old filename are rewritten.
//
//   STATUS     A Status cell holding prose ("Implemented — all 16 ACs met, gate green…")
//              is real information in the wrong field: /spec-advance, /repo-status, and the
//              MCP spec_list tool all read Status as one word. The lifecycle word moves into
//              Status; the prose is PRESERVED verbatim as a note under the header table.
//              Nothing is ever deleted.
//
// Idempotent: running it twice changes nothing the second time.

import { readFileSync, writeFileSync, existsSync, readdirSync, renameSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveStatus } from './lib/specs.mjs';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1]; };
const ROOT = flag('--root') || process.cwd();
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const DO_NUMBERING = !args.includes('--no-numbering');
const DO_STATUS = !args.includes('--no-status');

const LIFECYCLE = ['Draft', 'Approved', 'Implemented', 'Verified', 'Archived'];
// A spec id is digits plus an OPTIONAL letter: 0165 and 0165b are different specs, not a clash.
const SPEC_FILE = /^(\d{4}[a-z]?)-(.+)\.md$/;

const abs = (p) => join(ROOT, p);
const git = (...a) => {
  try {
    return execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};
const isRepo = git('rev-parse', '--is-inside-work-tree') === 'true';

// --- collect specs ----------------------------------------------------------

function collect() {
  const out = [];
  for (const dir of ['specs', 'specs/archive']) {
    if (!existsSync(abs(dir))) continue;
    for (const f of readdirSync(abs(dir))) {
      const m = f.match(SPEC_FILE);
      if (!m) continue;
      out.push({ dir, file: `${dir}/${f}`, name: f, id: m[1], slug: m[2] });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function addedAt(file) {
  if (isRepo) {
    const t = git('log', '--diff-filter=A', '--format=%at', '-1', '--', file);
    if (t) return Number(t);
  }
  try { return Math.floor(statSync(abs(file)).mtimeMs / 1000); } catch { return 0; }
}

// Highest number in use anywhere — working tree plus every branch's history, so a renumber
// can't land on an id that exists only on a branch nobody has checked out.
function highestUsed(specs) {
  let max = 0;
  const consider = (name) => {
    const m = basename(name).match(/^(\d{4})/);
    if (m) max = Math.max(max, Number(m[1]));
  };
  specs.forEach((s) => consider(s.name));
  if (isRepo) {
    git('log', '--all', '--pretty=format:', '--name-only', '--diff-filter=A', '--', 'specs/[0-9]*')
      .split('\n').filter(Boolean).forEach(consider);
  }
  return max;
}

// --- repair 1: duplicate numbers -------------------------------------------

function planNumbering(specs) {
  const byId = new Map();
  for (const s of specs) {
    if (!byId.has(s.id)) byId.set(s.id, []);
    byId.get(s.id).push(s);
  }

  let next = highestUsed(specs);
  const renames = [];
  for (const [id, group] of byId) {
    if (group.length < 2) continue;
    // Keep the original; renumber everything created after it.
    const dated = group.map((s) => ({ ...s, at: addedAt(s.file) })).sort((a, b) => a.at - b.at);
    for (const later of dated.slice(1)) {
      next += 1;
      const id2 = String(next).padStart(4, '0');
      renames.push({
        from: later.file,
        to: `${later.dir}/${id2}-${later.slug}.md`,
        oldId: id,
        newId: id2,
        addedAt: later.at ? new Date(later.at * 1000).toISOString().slice(0, 10) : 'unknown',
        keeping: dated[0].file,
      });
    }
  }
  return renames;
}

// Files that might mention a renamed spec by filename. Deliberately narrow: specs, docs,
// and top-level markdown. An exact-filename rewrite is safe; guessing at prose is not.
function referenceCandidates() {
  const out = [];
  const walk = (dir, depth) => {
    if (!existsSync(abs(dir)) || depth > 3) return;
    for (const f of readdirSync(abs(dir))) {
      const rel = `${dir}/${f}`;
      let st;
      try { st = statSync(abs(rel)); } catch { continue; }
      if (st.isDirectory()) walk(rel, depth + 1);
      else if (f.endsWith('.md')) out.push(rel);
    }
  };
  walk('specs', 0);
  walk('docs', 0);
  if (existsSync(abs('CLAUDE.md'))) out.push('CLAUDE.md');
  if (existsSync(abs('README.md'))) out.push('README.md');
  return [...new Set(out)];
}

// --- repair 2: status normalization ----------------------------------------

const STATUS_ROW = /^\|\s*\*\*Status\*\*\s*\|/;

function planStatus(specs) {
  const changes = [];
  const skipped = [];

  for (const s of specs) {
    const text = readFileSync(abs(s.file), 'utf8');
    const lines = text.split('\n');
    const i = lines.findIndex((l) => STATUS_ROW.test(l));
    if (i === -1) continue;

    const line = lines[i];
    // Take everything between the cell delimiter and the LAST pipe: the prose itself often
    // contains pipes, and truncating at the first one would silently eat content.
    const start = line.indexOf('|', line.indexOf('**Status**')) + 1;
    const end = line.lastIndexOf('|');
    if (start <= 0 || end <= start) continue;

    const raw = line.slice(start, end).trim();
    const plain = raw.replace(/\*\*/g, '').replace(/`/g, '').trim();
    if (LIFECYCLE.includes(plain)) continue;               // already canonical
    if (/^Draft \\?\| Approved/.test(plain)) continue;      // untouched TEMPLATE placeholder

    const r = resolveStatus(plain);
    if (!r.status) {
      skipped.push({ file: s.file, raw, why: 'no lifecycle word at all' });
      continue;
    }
    // The word must LEAD the cell. "Implemented (2026-07-07) — …" is an author declaring a
    // status; a stage word buried mid-sentence is narration, and promoting it writes a claim
    // they never made. This is not about ambiguity — one buried word is just as much a guess
    // as three, and this script rewrites files.
    if (!r.leading) {
      skipped.push({
        file: s.file,
        raw,
        why: r.candidates.length > 1
          ? `mentions ${r.candidates.join(', ')} mid-text, none leading`
          : `"${r.status}" appears mid-text, not as the status`,
      });
      continue;
    }
    if (text.includes('> **Status note:**')) continue;      // already normalized

    changes.push({ file: s.file, from: raw, to: r.status, lineIndex: i });
  }
  return { changes, skipped };
}

function applyStatus(change) {
  const lines = readFileSync(abs(change.file), 'utf8').split('\n');
  const i = change.lineIndex;
  const line = lines[i];
  const start = line.indexOf('|', line.indexOf('**Status**')) + 1;
  const end = line.lastIndexOf('|');
  lines[i] = `${line.slice(0, start)} ${change.to} ${line.slice(end)}`;

  // Insert the preserved prose immediately after the header table block.
  let j = i;
  while (j + 1 < lines.length && lines[j + 1].trimStart().startsWith('|')) j++;
  lines.splice(j + 1, 0, '', `> **Status note:** ${change.from}`);

  writeFileSync(abs(change.file), lines.join('\n'));
}

// --- run --------------------------------------------------------------------

const specs = collect();
if (specs.length === 0) {
  console.log(`No specs found under ${ROOT}/specs — nothing to do.`);
  process.exit(0);
}

if (APPLY && isRepo && !FORCE) {
  const dirty = git('status', '--porcelain', '--', 'specs', 'docs').split('\n').filter(Boolean);
  if (dirty.length) {
    console.error('Refusing to --apply with uncommitted changes under specs/ or docs/.');
    console.error('Commit or stash first so this script\'s changes are reviewable on their own,');
    console.error('or pass --force if you know what you are doing.');
    process.exit(1);
  }
}

const renames = DO_NUMBERING ? planNumbering(specs) : [];
const { changes, skipped } = DO_STATUS ? planStatus(specs) : { changes: [], skipped: [] };

console.log(`repo: ${ROOT}`);
console.log(`specs: ${specs.length}${isRepo ? '' : '   (not a git repo — using file mtimes, local branches unchecked)'}`);
console.log(APPLY ? '\nMODE: APPLY — writing changes\n' : '\nMODE: DRY RUN — nothing will be written (pass --apply to do it)\n');

// 1. numbering
if (DO_NUMBERING) {
  console.log(`── duplicate spec numbers: ${renames.length} file(s) to renumber`);
  const candidates = renames.length ? referenceCandidates() : [];
  for (const r of renames) {
    console.log(`   ${r.from}`);
    console.log(`     → ${r.to}     (added ${r.addedAt}; keeping ${basename(r.keeping)} on ${r.oldId})`);

    const refs = candidates.filter((c) => {
      if (c === r.from) return false;
      try { return readFileSync(abs(c), 'utf8').includes(basename(r.from)); } catch { return false; }
    });
    if (refs.length) console.log(`     ${refs.length} file(s) reference the old filename and will be updated`);

    if (APPLY) {
      const tracked = isRepo && git('ls-files', '--', r.from) !== '';
      if (tracked) git('mv', r.from, r.to);
      else renameSync(abs(r.from), abs(r.to));
      for (const c of refs) {
        const t = readFileSync(abs(c), 'utf8');
        writeFileSync(abs(c), t.split(basename(r.from)).join(basename(r.to)));
      }
    }
  }
  if (renames.length) {
    console.log('   NOTE: only exact filename references are rewritten. Prose like "see spec 0043"');
    console.log('         is left alone — search for the old number by hand if you use that style.');
  }
}

// 2. status
if (DO_STATUS) {
  console.log(`\n── non-canonical Status values: ${changes.length} file(s)`);
  for (const c of changes.slice(0, 8)) {
    const preview = c.from.length > 88 ? c.from.slice(0, 88) + '…' : c.from;
    console.log(`   ${c.file}`);
    console.log(`     "${preview}"`);
    console.log(`     → Status: ${c.to}   (full text preserved as a "Status note" under the table)`);
  }
  if (changes.length > 8) console.log(`   … and ${changes.length - 8} more`);
  if (APPLY) changes.forEach(applyStatus);
}

if (skipped.length) {
  console.log(`\n── needs a human: ${skipped.length} file(s) left untouched`);
  for (const s of skipped.slice(0, 10)) {
    console.log(`   ${s.file}  (${s.why})`);
    console.log(`      "${s.raw.length > 70 ? s.raw.slice(0, 70) + '…' : s.raw}"`);
  }
  if (skipped.length > 10) console.log(`   … and ${skipped.length - 10} more`);
}

console.log(
  APPLY
    ? `\n✓ applied: ${renames.length} renumbered, ${changes.length} statuses normalized. Review with \`git diff\` / \`git status\` — nothing was committed.`
    : `\nDry run complete: would renumber ${renames.length}, normalize ${changes.length}. Re-run with --apply to write.`,
);
