#!/usr/bin/env node
// How long things take. Spec 0035.
//
// Read-only over `.ml-specs/evidence/` and the specs' own Revisions tables. Writes nothing, gates
// nothing. No network calls.
//
// The excluded count prints beside every number, not in a footnote. Draft 0020 exists because
// somebody said this is slow, and a report that quietly leaves out the awkward specs settles that
// argument dishonestly.
//
// Exit codes: 0 reported, 2 the board could not be read. Never 1 — a duration is not a verdict.

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { report } from './lib/cycle.mjs';

const OK = 0;
const CANNOT_RUN = 2;

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : (argv[i + 1] ?? d); };
const has = (n) => argv.includes(`--${n}`);
const root = flag('root', process.cwd());

let r;
try {
  r = report(root);
} catch (e) {
  console.error(`spec-cycle: could not read the board: ${e.message}`);
  process.exit(CANNOT_RUN);
}

if (has('json')) {
  console.log(JSON.stringify(r, null, 2));
  process.exit(OK);
}

if (!r.measured) {
  console.log('no transitions recorded yet — nothing to measure.');
  console.log(`  ${r.excluded.length} spec(s) carry no evidence record.`);
  process.exit(OK);
}

console.log('  time in each status, in days');
for (const [status, s] of Object.entries(r.inStatus)) {
  console.log(`    ${status.padEnd(12)} median ${String(s.median).padStart(3)}   longest ${String(s.max).padStart(3)}   (${s.n} transition${s.n === 1 ? '' : 's'})`);
}

const rounds = r.rounds.filter((x) => x.rounds > 0);
if (rounds.length) {
  console.log('');
  console.log('  review rounds, most first');
  for (const x of rounds.slice(0, 5)) console.log(`    ${String(x.rounds).padStart(2)}  ${x.spec}`);
}

if (r.slowest.length) {
  console.log('');
  console.log('  longest single stretches');
  for (const d of r.slowest) console.log(`    ${String(d.days).padStart(3)}d  ${d.from} → ${d.to}  ${d.spec}`);
}

console.log('');
// Beside the numbers, never in a footnote.
console.log(`  measured ${r.specsMeasured} spec(s) over ${r.measured} transition(s).`);
if (r.excluded.length) {
  console.log(`  ${r.excluded.length} spec(s) excluded — no evidence record, so they contribute to no average.`);
}
if (r.outOfOrder.length) {
  console.log(`  ${r.outOfOrder.length} spec(s) have records out of chronological order — a re-record or a clock.`);
  console.log('    Their spans are computed from the sorted order, not the file order.');
}
if (r.unreadable.length) {
  console.log(`  ${r.unreadable.length} record(s) could not be read and were not counted.`);
}

process.exit(OK);
