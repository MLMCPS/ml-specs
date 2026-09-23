#!/usr/bin/env node
// Run the prompt evals. Spec 0046.
//
// Every assertion this repo makes about its prompt files is that a literal is PRESENT. That is the
// right call — `mlskills-flag-wiring.test.mjs:10-13` records why — and it leaves a hole: a command
// can be rewritten into something that no longer works with every gate green.
//
// This closes part of it, and says plainly which part. An expectation is a file, an exit code or
// an absence — never a string the model produced. It reports; it never gates. A probabilistic
// check wired into a deterministic pipeline makes the pipeline probabilistic.
//
// No runner configured is a clean, silent state: every case reports `not run`, counted separately
// from passes, and the exit is 0.
//
// Exit codes: 0 ran (or could not), 1 a case failed, 2 the eval files are unusable.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEvals, validate, judge, tally, runnerFrom, RESULTS } from './lib/evals.mjs';

const OK = 0;
const FINDING = 1;
const CANNOT_RUN = 2;

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : (argv[i + 1] ?? d); };
const has = (n) => argv.includes(`--${n}`);
const EVALS = flag('evals', join(HERE, '..', 'evals'));
const only = flag('command');

const runner = runnerFrom();

// 1. Load and validate before running anything. An unusable eval file is a could-not-run, not a
//    failure: nobody's prompt is wrong because a JSON file has a typo in it.
const files = readEvals(EVALS).filter((e) => !only || e.name === only);
if (!files.length) {
  console.error(`spec-eval: no eval files in ${EVALS}${only ? ` for '${only}'` : ''}`);
  process.exit(CANNOT_RUN);
}

const broken = [];
for (const e of files) {
  const findings = e.unreadable
    ? [{ rule: 'json', message: e.unreadable }]
    : validate(e.name, e.doc);
  for (const f of findings) broken.push(`${e.name}.json: ${f.rule}: ${f.message}`);
}
if (broken.length) {
  console.error('spec-eval: eval files are unusable —');
  for (const b of broken) console.error(`  ${b}`);
  process.exit(CANNOT_RUN);
}

// 2. Run.
const results = [];
for (const e of files) {
  for (const c of e.doc.cases) {
    if (!runner) {
      results.push({ command: e.name, name: c.name, result: RESULTS.NOT_RUN, failures: [] });
      continue;
    }

    // A fresh tree per case. Nothing here writes into this repository — spec 0046 AC6.
    const dir = mkdtempSync(join(tmpdir(), 'mlspecs-eval-'));
    try {
      const before = new Map();
      for (const [rel, body] of Object.entries(c.given.files ?? {})) {
        mkdirSync(join(dir, dirname(rel)), { recursive: true });
        writeFileSync(join(dir, rel), body);
        before.set(rel, body);
      }

      const r = spawnSync('/bin/sh', ['-c', runner], {
        cwd: dir, encoding: 'utf8', input: c.invoke, timeout: 300_000,
      });
      const { result, failures } = judge(c, { dir, code: r.status ?? -1, before });
      results.push({ command: e.name, name: c.name, result, failures });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

// 3. Report.
const counts = tally(results);

if (has('json')) {
  console.log(JSON.stringify({ runner: runner ?? null, ...counts, results }, null, 2));
  process.exit(counts.fail ? FINDING : OK);
}

for (const r of results) {
  const mark = { [RESULTS.PASS]: '✓', [RESULTS.FAIL]: '✗', [RESULTS.NOT_RUN]: '·' }[r.result];
  console.log(`  ${mark} ${r.command.padEnd(14)} ${r.name}`);
  for (const f of r.failures) console.log(`      ${f}`);
}
console.log('');

if (!runner) {
  // `not run` is a RESULT, never folded into passes. Same distinction `lib/evidence.mjs:14` draws
  // for `unknown`, and for the same reason.
  console.log(`  ${counts.notRun} case(s) not run — no runner configured.`);
  console.log('  Set ML_SPECS_EVAL_RUNNER to a command that drives an agent headlessly.');
} else {
  console.log(`  ${counts.pass} passed, ${counts.fail} failed, of ${counts.total}.`);
}

process.exit(counts.fail ? FINDING : OK);
