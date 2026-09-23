// Spec 0046 — the eval schema, and the rule that keeps it from becoming what it replaces.
//
// AC4 IS THE ONE THAT MATTERS. An expectation is a file, an exit code or an absence — never a
// string the model produced. Enforced by the schema, not by discipline: `KINDS` is a closed set
// and not one member carries a handle on output. Somebody reaching for `contains` or `matches`
// has nowhere to put it.
//
// Without a test of the SCHEMA, that erodes one convenient review at a time. "And it must say it
// refused" is obviously true, passes review, and six months later the eval suite is the
// wording-pin `mlskills-flag-wiring.test.mjs:10-13` refuses.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS, RESULTS, validate, judge, tally, runnerFrom, readEvals } from './evals.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EVALS = join(dirname(HERE), '..', 'evals');

const CASE = {
  name: 'a case',
  given: { files: { 'a.txt': 'one\n' } },
  invoke: '/ml-specs:spec do a thing',
  expect: [{ exists: 'a.txt' }],
};
const doc = (over = {}) => ({ command: 'spec', cases: [{ ...CASE, ...over }] });

describe('AC4 — an expectation cannot be a string the model produced', () => {
  test('every kind inspects the filesystem or an exit code, and nothing else', () => {
    const ALLOWED = new Set(['filesystem', 'exit-code']);
    for (const [kind, spec] of Object.entries(KINDS)) {
      assert.ok(ALLOWED.has(spec.inspects),
        `\`${kind}\` inspects "${spec.inspects}" — an expectation that reads model output is the `
        + 'wording-pin this suite exists to refuse (spec 0046 §2)');
    }
  });

  test('no kind takes a pattern, a substring or anything matched against output', () => {
    // The structural half. `takes` is 'path' or 'number'; a regex or a string-to-find would need
    // a third, and adding one fails here before it can be used anywhere.
    const ALLOWED = new Set(['path', 'number']);
    for (const [kind, spec] of Object.entries(KINDS)) {
      assert.ok(ALLOWED.has(spec.takes), `\`${kind}\` takes "${spec.takes}"`);
    }
  });

  test('and an unknown kind is refused, naming what an expectation may be', () => {
    const f = validate('spec', doc({ expect: [{ contains: 'refused' }] }));
    assert.equal(f.length, 1);
    assert.match(f[0].message, /never a string the model produced/,
      'the refusal does not say why — a reader will just try `matches` next');
    assert.match(f[0].message, /exists/, 'the refusal does not say what IS allowed');
  });

  test('the kind set is closed and small', () => {
    assert.ok(Object.isFrozen(KINDS));
    assert.ok(Object.keys(KINDS).length <= 6, 'the kind set grew — check none of them reads output');
  });
});

describe('the schema refuses what would pass silently', () => {
  test('a case with no expectations — it would pass whatever happened', () => {
    const f = validate('spec', doc({ expect: [] }));
    assert.ok(f.some((x) => x.message.includes('would pass whatever happened')));
  });

  test('a file with no cases', () => {
    assert.ok(validate('spec', { command: 'spec', cases: [] }).some((x) => x.rule === 'cases'));
  });

  test('an expectation naming two kinds at once', () => {
    // `{exists: 'a', absent: 'b'}` reads as two and is judged as one — whichever comes first.
    const f = validate('spec', doc({ expect: [{ exists: 'a.txt', absent: 'b.txt' }] }));
    assert.ok(f.some((x) => x.message.includes('names 2 kinds')));
  });

  test('a name that disagrees with the file it lives in', () => {
    assert.ok(validate('pr', doc()).some((x) => x.rule === 'command'));
  });

  test('a wrong-typed value', () => {
    assert.ok(validate('spec', doc({ expect: [{ exit: 'zero' }] })).some((x) => x.rule === 'expect'));
    assert.ok(validate('spec', doc({ expect: [{ exists: 7 }] })).some((x) => x.rule === 'expect'));
  });

  test('a well-formed file is clean', () => {
    assert.deepEqual(validate('spec', doc()), []);
  });

  test('`why` is allowed beside a kind and is not counted as one', () => {
    assert.deepEqual(validate('spec', doc({ expect: [{ exists: 'a.txt', why: 'because' }] })), []);
  });
});

describe('judging an observed run', () => {
  function tree(t, files) {
    const d = mkdtempSync(join(tmpdir(), 'mlspecs-judge-'));
    t.after(() => rmSync(d, { recursive: true, force: true }));
    const before = new Map();
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(join(d, dirname(rel)), { recursive: true });
      writeFileSync(join(d, rel), body);
      before.set(rel, body);
    }
    return { dir: d, before };
  }

  test('exists and absent', (t) => {
    const { dir, before } = tree(t, { 'a.txt': 'one\n' });
    assert.equal(judge({ expect: [{ exists: 'a.txt' }] }, { dir, code: 0, before }).result, RESULTS.PASS);
    assert.equal(judge({ expect: [{ exists: 'b.txt' }] }, { dir, code: 0, before }).result, RESULTS.FAIL);
    assert.equal(judge({ expect: [{ absent: 'b.txt' }] }, { dir, code: 0, before }).result, RESULTS.PASS);
    assert.equal(judge({ expect: [{ absent: 'a.txt' }] }, { dir, code: 0, before }).result, RESULTS.FAIL);
  });

  test('unchanged compares bytes, and a rewrite with identical content is unchanged', (t) => {
    const { dir, before } = tree(t, { 'a.txt': 'one\n' });
    assert.equal(judge({ expect: [{ unchanged: 'a.txt' }] }, { dir, code: 0, before }).result, RESULTS.PASS);
    writeFileSync(join(dir, 'a.txt'), 'two\n');
    assert.equal(judge({ expect: [{ unchanged: 'a.txt' }] }, { dir, code: 0, before }).result, RESULTS.FAIL);
  });

  test('unchanged catches a DELETION, not just an edit', (t) => {
    // The case a naive content comparison misses: the file is gone, so reading it returns nothing,
    // and "nothing" must not compare equal to the content that was there.
    const { dir, before } = tree(t, { 'a.txt': 'one\n' });
    rmSync(join(dir, 'a.txt'));
    assert.equal(judge({ expect: [{ unchanged: 'a.txt' }] }, { dir, code: 0, before }).result, RESULTS.FAIL);
  });

  test('exit', (t) => {
    const { dir, before } = tree(t, {});
    assert.equal(judge({ expect: [{ exit: 1 }] }, { dir, code: 1, before }).result, RESULTS.PASS);
    assert.equal(judge({ expect: [{ exit: 0 }] }, { dir, code: 1, before }).result, RESULTS.FAIL);
  });

  test('a failure says which expectation decided it', (t) => {
    const { dir, before } = tree(t, {});
    const { failures } = judge({ expect: [{ exists: 'gone.txt' }, { exit: 0 }] }, { dir, code: 3, before });
    assert.equal(failures.length, 2);
    assert.match(failures[0], /gone\.txt/);
    assert.match(failures[1], /exit 0, got 3/);
  });
});

describe('AC2 — `not run` is a result, never a pass', () => {
  test('no runner configured resolves to null', () => {
    assert.equal(runnerFrom({}), null);
    assert.equal(runnerFrom({ ML_SPECS_EVAL_RUNNER: 'claude -p' }), 'claude -p');
  });

  test('the tally holds not-run apart from passes', () => {
    const t = tally([
      { result: RESULTS.PASS }, { result: RESULTS.FAIL },
      { result: RESULTS.NOT_RUN }, { result: RESULTS.NOT_RUN },
    ]);
    assert.deepEqual(t, { total: 4, pass: 1, fail: 1, notRun: 2 });
    assert.notEqual(t.pass, t.total - t.fail, 'not-run was folded into passes');
  });
});

describe('AC3 — every loop command has a case', () => {
  const LOOP = ['spec', 'spec-build', 'spec-verify', 'spec-advance', 'pr', 'pr-address'];

  test('one eval file each, and every one is valid', () => {
    const files = readEvals(EVALS);
    const byName = new Map(files.map((f) => [f.name, f]));
    for (const c of LOOP) {
      const f = byName.get(c);
      assert.ok(f, `no eval file for the ${c} loop command`);
      assert.equal(f.unreadable, null, `${c}.json: ${f.unreadable}`);
      assert.deepEqual(validate(c, f.doc), [], `${c}.json is invalid`);
    }
  });

  test('and every case says WHY its expectation matters', () => {
    // Not wording-pinning: an expectation with no stated reason is one nobody can review, and the
    // reason is the only part a person reads when a case fails.
    for (const f of readEvals(EVALS)) {
      for (const c of f.doc.cases) {
        for (const e of c.expect) {
          assert.ok(e.why, `${f.name}.json, "${c.name}": an expectation with no \`why\``);
        }
      }
    }
  });
});
