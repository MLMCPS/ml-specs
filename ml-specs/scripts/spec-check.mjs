#!/usr/bin/env node
// Gate the whole board in one run. Spec 0036.
//
// `spec-gate.mjs` takes one spec, by design. So "is this whole board honest" means running it N
// times and reading N outputs, which nobody does — and a stale `Verified` sits until somebody
// happens to look.
//
// THE THING THIS MUST NOT BECOME
//
// A green board here is NOT a judged board. `spec-gate` splits its verdicts into PASS/FAIL, which
// a script decides, and MANUAL, which it explicitly does not — whether a human approved, whether
// §8 holds a blocking question, whether the suite really ran green. This runs the mechanical half
// across every spec and says so on every row. A board-wide command that let "✓" be read as
// "checked" would be the rubber stamp spec 0025 §5 records, at N times the scale.
//
// No network calls. Read-only: it runs the gate, which writes nothing without `--to`.
//
// Exit codes: 0 no mechanical gate failed, 1 one did, 2 the board could not be read.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSpecs } from './lib/specs.mjs';

const OK = 0;
const FINDING = 1;
const CANNOT_RUN = 2;

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, 'spec-gate.mjs');

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : (argv[i + 1] ?? d); };
const has = (n) => argv.includes(`--${n}`);
const root = flag('root', process.cwd());
const to = flag('to');

let specs;
try {
  specs = listSpecs(root).filter((s) => !s.file.includes('archive/'));
} catch (e) {
  console.error(`spec-check: could not read the board: ${e.message}`);
  process.exit(CANNOT_RUN);
}

if (!specs.length) {
  console.log('no specs to check.');
  process.exit(OK);
}

const rows = specs.map((s) => {
  const r = spawnSync(process.execPath, [GATE, s.file, '--root', root, '--json', ...(to ? ['--to', to] : [])], {
    cwd: root, encoding: 'utf8',
  });
  let report = null;
  try { report = JSON.parse(r.stdout); } catch { /* the gate could not produce one */ }

  const gates = report?.gates ?? [];
  const failed = gates.filter((g) => g.verdict === 'FAIL');
  const manual = gates.filter((g) => g.verdict === 'MANUAL');
  return {
    spec: s.file,
    status: s.status,
    ranAt: report ? null : `the gate could not run (exit ${r.status ?? '-'})`,
    failed: failed.map((g) => g.name),
    manual: manual.map((g) => g.name),
    mechanical: gates.length - manual.length,
  };
});

if (has('json')) {
  console.log(JSON.stringify({
    checked: rows.length,
    failing: rows.filter((r) => r.failed.length).length,
    // Named, not just counted: a consumer that sees `failing: 0` and nothing else will read it as
    // "the board is fine", which is the one thing this output must never say.
    note: 'mechanical gates only — MANUAL gates are listed per row and were not judged',
    rows,
  }, null, 2));
  process.exit(rows.some((r) => r.failed.length) ? FINDING : OK);
}

for (const r of rows) {
  const mark = r.ranAt ? '?' : r.failed.length ? '✗' : '✓';
  console.log(`  ${mark} ${r.status.padEnd(12)} ${r.spec}`);
  if (r.ranAt) { console.log(`      ${r.ranAt}`); continue; }
  if (r.failed.length) console.log(`      failed: ${r.failed.join(', ')}`);
  // EVERY row says what was not judged, not just the failing ones — a "✓" with no caveat beside
  // it is exactly what would get read as "checked".
  console.log(`      ${r.mechanical} mechanical gate(s) ran`
    + (r.manual.length ? `; not judged here: ${r.manual.join(', ')}` : '; nothing needed judgement'));
}

console.log('');
const failing = rows.filter((r) => r.failed.length).length;
console.log(failing
  ? `${failing} of ${rows.length} spec(s) failed a mechanical gate.`
  : `${rows.length} spec(s) passed every mechanical gate. Nothing here judged a MANUAL one.`);

process.exit(failing ? FINDING : OK);
