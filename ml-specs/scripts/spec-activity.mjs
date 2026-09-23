#!/usr/bin/env node
// What the scope guard has been deciding — so "is it helping?" is countable, not felt.
//
//   node spec-activity.mjs                 # the summary
//   node spec-activity.mjs --blocked       # every refusal, newest first
//   node spec-activity.mjs --json
//
// Memory answers this question badly: one annoying refusal is remembered and ten silent allows
// are not, so a guard evaluated from memory gets switched off. This counts instead.
//
// Exit 0 always. This reports; it decides nothing. A high block rate is not a failure — it is a
// `Touches` row narrower than the work, which is a conversation rather than a bug.

import { resolve } from 'node:path';
import { read, summary, LOG } from './lib/activity.mjs';

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : (argv[i + 1] ?? null); };
const has = (n) => argv.includes(`--${n}`);
const ROOT = resolve(flag('root') ?? process.cwd());

const entries = read(ROOT);
if (!entries.length) {
  const msg = `nothing recorded yet — ${LOG} fills as the scope guard runs`;
  if (has('json')) console.log(JSON.stringify({ total: 0, note: msg }, null, 2));
  else console.log(msg);
  process.exit(0);
}

const s = summary(entries);

if (has('json')) {
  console.log(JSON.stringify({ ...s, entries: has('blocked') ? entries.filter((e) => e.decision === 'block') : undefined }, null, 2));
  process.exit(0);
}

if (has('blocked')) {
  for (const e of entries.filter((x) => x.decision === 'block').reverse()) {
    console.log(`  ${String(e.at).slice(0, 19)}  ${(e.tool ?? '-').padEnd(8)} ${(e.files ?? []).join(', ')}`);
    if (e.reason) console.log(`    ${e.reason}`);
  }
  process.exit(0);
}

const pct = (n) => `${Math.round(n * 100)}%`;
console.log(`  ${s.total} decision(s)  ·  ${s.allowed} allowed  ·  ${s.blocked} blocked  (${pct(s.blockRate)})`);

if (!s.blocked) {
  console.log('\n  Nothing has been refused. Either the declarations fit the work, or no spec');
  console.log('  is bounding anything — `spec-guard` says which every time it allows.');
  process.exit(0);
}

console.log('\n  Refused, by spec:');
for (const [spec, n] of Object.entries(s.bySpec).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${spec}`);
console.log('\n  Most-refused paths:');
for (const [path, n] of s.topPaths) console.log(`    ${String(n).padStart(4)}  ${path}`);

// The reading, stated, because a number without one gets read as a score.
console.log('');
if (s.blockRate > 0.2) {
  console.log('  More than a fifth of writes refused. That is usually a `Touches` row narrower than');
  console.log('  the work rather than an agent misbehaving — widen the declaration in the spec,');
  console.log('  with a human, or split the spec. A guard fought this often is one somebody turns off.');
} else {
  console.log('  A low block rate is what a fitting declaration looks like. The paths above are the');
  console.log('  ones worth reading: a path refused repeatedly either belongs in `Touches` or is');
  console.log('  work that belongs in a different spec.');
}
process.exit(0);
