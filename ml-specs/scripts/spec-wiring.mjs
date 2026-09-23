#!/usr/bin/env node
// What is wired here, and what a host would need. Spec 0037.
//
// Read-only unless `--write` is given, and `--write` refuses to overwrite — the same posture
// `ml-specs.mjs install` takes for a `foreign` target. No network calls.
//
// Every row says it checked PRESENCE. A CI file in the tree that nobody enabled reads identically
// to one that runs on every pull request, and overstating that is the `unavailable ≠ pass` failure
// this toolkit has written down twice.
//
// Exit codes: 0 everything required is present, 1 something is missing, 2 could not read the tree.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { survey, uncovered, emitTarget, SURFACES } from './lib/wiring.mjs';

const OK = 0;
const FINDING = 1;
const CANNOT_RUN = 2;

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, '..', 'templates');

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : (argv[i + 1] ?? d); };
const has = (n) => argv.includes(`--${n}`);
const root = flag('root', process.cwd());

const die = (code, msg) => { console.error(`spec-wiring: ${msg}`); process.exit(code); };

// ── --emit ───────────────────────────────────────────────────────────────────────────────────

if (has('emit')) {
  const id = flag('emit');
  const provider = flag('provider', 'github');
  const rel = emitTarget(id, provider);
  if (!rel) {
    die(CANNOT_RUN, `nothing to emit for '${id}'${provider ? ` / '${provider}'` : ''} — `
      + `emittable: ${SURFACES.filter((s) => Object.keys(s.emit).length).map((s) => s.id).join(', ')}`);
  }

  const src = join(TEMPLATES, rel);
  if (!existsSync(src)) die(CANNOT_RUN, `the shipped template is missing: ${src}`);
  const body = readFileSync(src, 'utf8');

  const out = flag('write');
  if (!out) {
    process.stdout.write(body);
    process.exit(OK);
  }
  const dest = join(root, out);
  // Refuse rather than replace. Silently overwriting somebody's CI config is the "never silently
  // overwrite a user's file" rule read backwards.
  if (existsSync(dest)) die(FINDING, `${dest} already exists — nothing written. Move it aside, or diff against \`--emit ${id}\` on stdout.`);

  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, body);
  console.log(`spec-wiring: wrote ${dest} from templates/${rel}`);
  console.log('  read it before committing — a shipped template is a starting point, not a decision.');
  process.exit(OK);
}

// ── the report ───────────────────────────────────────────────────────────────────────────────

let rows;
try {
  rows = survey(root);
} catch (e) {
  die(CANNOT_RUN, `could not read ${root}: ${e.message}`);
}

const missing = rows.filter((r) => !r.present && !r.optional);
const gaps = uncovered(TEMPLATES);

if (has('json')) {
  console.log(JSON.stringify({
    rows,
    missing: missing.map((r) => r.id),
    // A consumer that cannot infer a caveat is handed it. Presence is not function.
    note: 'each row reports whether the file is PRESENT, never whether it runs',
    uncoveredTemplateDirs: gaps,
  }, null, 2));
  process.exit(missing.length ? FINDING : OK);
}

for (const r of rows) {
  const mark = r.present ? '✓' : r.optional ? '·' : '✗';
  console.log(`  ${mark} ${r.id.padEnd(16)} ${r.what}`);
  if (r.present) {
    console.log(`      found ${r.found.join(', ')} — ${r.checks} checked, not whether it runs`);
  } else {
    console.log(`      looked for ${r.look.join(', ')}`);
    console.log(`      ${r.optional ? 'optional; ' : ''}fix: ${r.fix}`);
  }
}

console.log('');
console.log(missing.length
  ? `${missing.length} required surface(s) absent: ${missing.map((r) => r.id).join(', ')}.`
  : 'every required surface is present.');
console.log('  Presence only — a CI file nobody enabled looks exactly like one that runs.');

if (gaps.length) {
  // AC5's other half surfaced at runtime, not only in a test: a template directory nothing
  // reports on is a report that has quietly narrowed.
  console.log(`  ${gaps.length} template director(ies) no surface covers: ${gaps.join(', ')}.`);
}

process.exit(missing.length ? FINDING : OK);
