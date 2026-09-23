// Spec 0046 AC1, AC5, AC6 — the runner driven end to end, with a STUB.
//
// No real runner is configured here and none should be: an eval suite that needs a model to test
// itself is one nobody runs. The stub is a shell script that touches files and exits with a code,
// which is exactly the surface the judge reads — so every path through the runner is exercised
// without a model, and the real one differs only in what it happens to do to the tree.
//
// AC6 is proved by a snapshot of THIS repository, not by reading the code. An eval that writes
// into the repo it is evaluating would be caught by nothing else.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = dirname(HERE);
const ROOT = dirname(PLUGIN);
const CLI = join(HERE, 'spec-eval.mjs');

/** A throwaway evals directory holding one file. */
function evals(t, name, doc) {
  const d = mkdtempSync(join(tmpdir(), 'mlspecs-evaldir-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  writeFileSync(join(d, `${name}.json`), JSON.stringify(doc, null, 2));
  return d;
}

/** A stub runner: a script that does something observable and exits with a chosen code. */
function stub(t, body, code = 0) {
  const d = mkdtempSync(join(tmpdir(), 'mlspecs-runner-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const p = join(d, 'run.sh');
  writeFileSync(p, `#!/bin/sh\ncat > /dev/null\n${body}\nexit ${code}\n`, { mode: 0o755 });
  return p;
}

const run = (dir, env = {}, ...args) => {
  const r = spawnSync(process.execPath, [CLI, '--evals', dir, ...args], {
    encoding: 'utf8', env: { ...process.env, ML_SPECS_EVAL_RUNNER: '', ...env },
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, stdout: r.stdout || '' };
};

const DOC = (expect) => ({
  command: 'spec',
  cases: [{
    name: 'a case', given: { files: { 'a.txt': 'one\n' } },
    invoke: '/ml-specs:spec do a thing', expect,
  }],
});

/**
 * What git sees as changed or untracked, as one string.
 *
 * `git status --porcelain` rather than a recursive walk: the first version of this test walked the
 * whole repository four times and took the suite past ten minutes. Git already maintains the index
 * this needs, and the question AC6 asks — did anything appear or change — is exactly what porcelain
 * answers.
 */
function dirty(root) {
  return spawnSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).stdout ?? '';
}

describe('AC1 — a case runs and reports what decided it', () => {
  test('a runner that satisfies the expectation passes', (t) => {
    const dir = evals(t, 'spec', DOC([{ exists: 'made.txt', why: 'the command writes it' }]));
    const r = run(dir, { ML_SPECS_EVAL_RUNNER: `${stub(t, 'touch made.txt')}` });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /✓/);
    assert.match(r.out, /1 passed, 0 failed/);
  });

  test('a runner that does not satisfy it fails, naming the expectation', (t) => {
    const dir = evals(t, 'spec', DOC([{ exists: 'made.txt', why: 'the command writes it' }]));
    const r = run(dir, { ML_SPECS_EVAL_RUNNER: `${stub(t, 'true')}` });
    assert.equal(r.code, 1, 'a failing case did not report a finding');
    assert.match(r.out, /expected made\.txt to exist/,
      'the report does not say which expectation decided it');
  });

  test('`unchanged` catches a runner that edits what it should not', (t) => {
    const dir = evals(t, 'spec', DOC([{ unchanged: 'a.txt', why: 'this phase writes no code' }]));
    const clean = run(dir, { ML_SPECS_EVAL_RUNNER: `${stub(t, 'true')}` });
    assert.equal(clean.code, 0, clean.out);

    const dirty = run(dir, { ML_SPECS_EVAL_RUNNER: `${stub(t, 'echo two > a.txt')}` });
    assert.equal(dirty.code, 1, 'a runner rewrote the fixture and the case passed');
    assert.match(dirty.out, /a\.txt changed/);
  });

  test('`exit` reads the runner\'s code', (t) => {
    const dir = evals(t, 'spec', DOC([{ exit: 1, why: 'a refusal is a finding' }]));
    assert.equal(run(dir, { ML_SPECS_EVAL_RUNNER: `${stub(t, 'true', 1)}` }).code, 0);
    assert.equal(run(dir, { ML_SPECS_EVAL_RUNNER: `${stub(t, 'true', 0)}` }).code, 1);
  });
});

describe('AC2 — no runner is a clean, silent state', () => {
  test('every case is not-run, the exit is 0, and the count is held apart', (t) => {
    const dir = evals(t, 'spec', DOC([{ exists: 'made.txt', why: 'x' }]));
    const r = run(dir);
    assert.equal(r.code, 0, 'an unconfigured runner failed the run');
    assert.match(r.out, /1 case\(s\) not run/);
    assert.doesNotMatch(r.out, /passed/, 'not-run was reported as a pass');
    assert.match(r.out, /ML_SPECS_EVAL_RUNNER/, 'the report does not say how to configure one');
  });

  test('and --json says so too', (t) => {
    const dir = evals(t, 'spec', DOC([{ exists: 'made.txt', why: 'x' }]));
    const j = JSON.parse(run(dir, {}, '--json').stdout);
    assert.equal(j.runner, null);
    assert.equal(j.notRun, 1);
    assert.equal(j.pass, 0);
  });
});

describe('an unusable eval file is could-not-run, not a failure', () => {
  test('bad JSON exits 2', (t) => {
    const d = mkdtempSync(join(tmpdir(), 'mlspecs-evaldir-'));
    t.after(() => rmSync(d, { recursive: true, force: true }));
    writeFileSync(join(d, 'spec.json'), '{ not json');
    const r = run(d);
    assert.equal(r.code, 2, "nobody's prompt is wrong because a JSON file has a typo");
  });

  test('a text expectation exits 2 and names what an expectation may be', (t) => {
    const dir = evals(t, 'spec', DOC([{ contains: 'refused' }]));
    const r = run(dir);
    assert.equal(r.code, 2);
    assert.match(r.out, /never a string the model produced/);
  });
});

describe('AC6 — nothing writes into this repository', () => {
  test('a full run leaves the repo byte-identical', (t) => {
    const before = dirty(ROOT);
    const dir = evals(t, 'spec', DOC([{ exists: 'made.txt', why: 'x' }]));
    // A runner that writes greedily into its cwd. If the cwd were the repo, this would show.
    run(dir, { ML_SPECS_EVAL_RUNNER: `${stub(t, 'touch made.txt EVAL_LEAKED.txt')}` });
    assert.equal(dirty(ROOT), before, 'an eval run wrote into the repository');
    assert.ok(!existsSync(join(ROOT, 'EVAL_LEAKED.txt')));
  });

  test('the shipped evals run against the real files without writing', () => {
    const before = dirty(ROOT);
    const r = spawnSync(process.execPath, [CLI], { encoding: 'utf8', env: { ...process.env, ML_SPECS_EVAL_RUNNER: '' } });
    assert.equal(r.status, 0);
    assert.equal(dirty(ROOT), before);
  });
});

describe('AC5 — the suite reports and does not gate', () => {
  test('the CI job runs the evals and cannot fail the build on them', () => {
    // A probabilistic check wired into a deterministic pipeline makes the pipeline probabilistic.
    const wf = readFileSync(join(ROOT, '.github', 'workflows', 'validate.yml'), 'utf8');
    assert.match(wf, /spec-eval/, 'no CI step runs the evals');

    // Scoped to the step, not the file: `continue-on-error` anywhere else in the workflow would
    // satisfy a file-global match while the eval step still gated the build.
    const step = wf.slice(wf.indexOf('spec-eval') - 400, wf.indexOf('spec-eval') + 200);
    assert.match(step, /continue-on-error:\s*true/,
      'the eval step can fail the build — it reports, it never gates');
  });
});
