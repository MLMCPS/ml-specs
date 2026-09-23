#!/usr/bin/env node
// Acknowledge that a spec changed after its gate passed — deliberately, with a reason.
//
//   node spec-amend.mjs specs/0001-foo.md --because "reworded AC1; the assertion is unchanged"
//   node spec-amend.mjs specs/0001-foo.md --to Verified --because "…" --json
//
// `spec-evidence.mjs` reports `amended` when a spec's criteria or §6 mapping moved after the gate
// read them. That verdict is correct and it blocks — but it had no exit except re-running the
// whole gate, re-attesting the MANUAL gates included, for a record that was never wrong. Reword a
// criterion for clarity on a `Verified` spec and you paid for it with a full transition.
//
// A rule with no affordance for the legitimate case is a rule people learn to ignore, and once
// they ignore `amended` they ignore the real ones too — a criterion quietly deleted after the gate
// checked it was ticked, which is exactly what the verdict exists to catch.
//
// So: an APPEND and a re-baseline, in that order. The previous contract digest stays on the
// record, so the history of what a spec promised is still readable afterwards. Nothing is deleted
// and nothing is re-gated — this says "the spec moved and here is why", not "the gate passed".
//
// The reason is mandatory and held to the same ten characters as `--attest`, for the same reason:
// this is the only way to clear the loudest state without re-running anything, and a one-word
// acknowledgement is a checkbox.
//
// Exit codes: 0 = acknowledged · 1 = refused · 2 = could not run.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LIFECYCLE } from './lib/specs.mjs';
import { readRecord, writeRecord, freshness, AMENDED } from './lib/evidence.mjs';
import { contractOf, changes } from './lib/contract.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const MIN_REASON = 10;

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : (argv[i + 1] ?? null); };
const has = (n) => argv.includes(`--${n}`);
const JSON_OUT = has('json');
const ROOT = resolve(flag('root') ?? process.cwd());
const positional = argv.filter((a, i) => !a.startsWith('--') && !['to', 'because', 'root'].includes(argv[i - 1]?.replace(/^--/, '')));

const die = (code, message) => {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, reason: message }, null, 2));
  else console.error(message);
  process.exit(code);
};

const specArg = positional[0];
if (!specArg) die(2, 'usage: spec-amend.mjs <spec-file> [--to <Status>] --because "…" [--root <path>] [--json]');
const abs = resolve(ROOT, specArg);
if (!existsSync(abs)) die(2, `could not run: no spec at ${specArg}`);
const specRel = relative(ROOT, abs).split('\\').join('/');

const because = String(flag('because') ?? '').trim();
if (because.length < MIN_REASON) {
  die(1,
    `${specRel}: an amendment states why.\n`
    + `  --because "reworded AC1 for clarity; the assertion it names is unchanged"\n\n`
    + `${MIN_REASON} characters minimum. This is the only way to clear the loudest state without\n`
    + 're-running the gate, and a one-word acknowledgement is a checkbox.');
}

// Which record. `--to` names it; otherwise the status the spec currently claims, since that is
// the record an `amended` verdict is being reported against.
const currentStatus = (readFileSync(abs, 'utf8').match(/\|\s*\*\*Status\*\*\s*\|\s*(\w+)/) ?? [])[1] ?? null;
const to = flag('to') ?? currentStatus;
if (!to || !LIFECYCLE.includes(to)) die(2, `could not run: '${to ?? '(none)'}' is not a lifecycle status — pass --to`);

const rec = readRecord(ROOT, specRel, to);
if (!rec) die(2, `could not run: no evidence record for ${specRel} at ${to} — nothing to amend`);
if (!rec.contract) die(2, `could not run: that record predates contract capture — re-run the gate instead`);

// The §6 tokens the gate would read now, from the gate itself. Re-extracting them here would be a
// second implementation of "which tests does §6 name", and it would drift from the one that wrote
// the record — leaving this acknowledging a contract the gate never saw.
let claimed = null;
try {
  const out = execFileSync(process.execPath, [join(HERE, 'spec-gate.mjs'), abs, '--root', ROOT, '--json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  claimed = JSON.parse(out).claimed ?? null;
} catch (e) {
  try { claimed = JSON.parse(e.stdout || '').claimed ?? null; } catch { claimed = null; }
}
if (claimed === null) die(2, 'could not run: the gate did not report what §6 names, so there is nothing to compare');

const current = contractOf(readFileSync(abs, 'utf8'), claimed);
const verdict = freshness(ROOT, rec, current);

if (verdict.verdict !== AMENDED) {
  die(1,
    `${specRel} (${to}) reads ${verdict.verdict}, not amended — nothing to acknowledge.\n`
    + `  ${verdict.reason}\n\n`
    + (verdict.verdict === 'stale'
      ? '  A stale record is about the CODE moving, not the spec. Re-run the gate.'
      : '  Only an amendment can be acknowledged; everything else wants the gate re-run.'));
}

const diff = changes(rec.contract, current);
const who = (() => {
  try {
    const name = execFileSync('git', ['config', 'user.name'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const email = execFileSync('git', ['config', 'user.email'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return email ? `${name || 'unnamed'} <${email}>` : (name || null);
  } catch {
    return null;
  }
})();

// Append, then re-baseline. The previous digest and what changed both stay on the record: an
// acknowledgement is a note in the history, not an erasure of it.
const amendments = [...(rec.amendments ?? []), {
  at: new Date().toISOString(),
  by: who,
  because,
  from: rec.contract.digest,
  to: current.digest,
  changes: diff.map((c) => ({ kind: c.kind, text: c.text })),
}];

const written = writeRecord(ROOT, { ...rec, contract: current, amendments });

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: true, spec: specRel, to, acknowledged: diff.length, record: written.path, amendments: amendments.length }, null, 2));
  process.exit(0);
}
console.log(`${specRel}  (${to})  ${diff.length} amendment(s) acknowledged`);
for (const c of diff) console.log(`  · ${c.text}`);
console.log(`  by ${who ?? 'unknown (git has no user.name)'}: "${because}"`);
console.log(`  record: ${written.path}  — the previous contract digest is kept, ${amendments.length} on file`);
console.log('\n  This does not re-gate anything. It records that the spec moved and why.');
process.exit(0);
