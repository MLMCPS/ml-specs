// Spec 0035 AC5, AC6 — the report as an operator actually sees it.
//
// `lib/cycle.test.mjs` tests the computation. This drives the real CLI, because AC5 is about what
// reaches a person and AC6 is about two surfaces agreeing — neither is observable from the
// function that produces the numbers.
//
// AC5 runs against THIS repository's records, which carry `attested.by` with a name and an email.
// A fixture without one could not fail, and the first version of the unit-level guard passed
// vacuously for exactly that reason: its root was one directory short.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE));
const CLI = join(HERE, 'spec-cycle.mjs');

const run = (root, ...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args, '--root', root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, stdout: r.stdout || '' };
};

/** A repo with specs and records, for the cases the real one cannot produce on demand. */
function repo(t, { specs = {}, records = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mlspecs-cyclew-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'specs'), { recursive: true });
  mkdirSync(join(dir, '.ml-specs', 'evidence'), { recursive: true });
  for (const [n, b] of Object.entries(specs)) writeFileSync(join(dir, 'specs', n), b);
  records.forEach((r, i) => writeFileSync(join(dir, '.ml-specs', 'evidence', `r${i}.json`), JSON.stringify(r)));
  return dir;
}
const SPEC = '# Spec: a\n\n| | |\n|---|---|\n| **Status** | Draft |\n';
const at = (d) => `2026-01-${String(d).padStart(2, '0')}T00:00:00Z`;

describe('AC5 — no name, no email, no per-person anything, against the real records', () => {
  test('the human report leaks nothing', () => {
    const r = run(ROOT);
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /@[\w.-]+\.\w+/, 'an email address reached the report');
    assert.doesNotMatch(r.out, /attested/i, 'the attestation block reached the report');
  });

  test('and neither does --json', () => {
    const r = run(ROOT, '--json');
    assert.doesNotMatch(r.stdout, /@[\w.-]+\.\w+/);
    assert.doesNotMatch(r.stdout, /attested/i);
  });

  test('the records it read really do carry one — or the two above assert nothing', () => {
    const dir = join(ROOT, '.ml-specs', 'evidence');
    assert.ok(existsSync(dir), 'no evidence directory — AC5 is untested');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    assert.ok(files.length > 0, 'no evidence records — AC5 is untested');
    const anyEmail = files.some((f) => /@[\w.-]+\.\w+/.test(
      execFileSync('cat', [join(dir, f)], { encoding: 'utf8' })));
    assert.ok(anyEmail, 'no record carries an email, so the leak guard is exercising nothing');
  });

  test('the report offers no per-person breakdown to ask for', () => {
    const j = JSON.parse(run(ROOT, '--json').stdout);
    assert.doesNotMatch(JSON.stringify(Object.keys(j)), /author|person|who|^by$/i,
      'a per-person key appeared — spec 0035 §2 makes that a permanent non-goal');
  });
});

describe('AC6 — both surfaces report the same numbers, and both state the exclusions', () => {
  test('the excluded count appears in the human output and in --json', (t) => {
    const dir = repo(t, {
      specs: { '0001-a.md': SPEC, '0002-b.md': SPEC, '0003-c.md': SPEC },
      records: [
        { spec: 'specs/0001-a.md', to: 'Approved', at: at(1) },
        { spec: 'specs/0001-a.md', to: 'Implemented', at: at(4) },
      ],
    });

    const j = JSON.parse(run(dir, '--json').stdout);
    assert.equal(j.excluded.length, 2);
    assert.equal(j.specsMeasured, 1);

    const human = run(dir).out;
    assert.match(human, new RegExp(`${j.excluded.length} spec\\(s\\) excluded`),
      'the human report does not say how many specs were left out');
    assert.match(human, new RegExp(`measured ${j.specsMeasured} spec\\(s\\)`));
  });

  test('the same span appears in both, with the same number of days', (t) => {
    const dir = repo(t, {
      specs: { '0001-a.md': SPEC },
      records: [
        { spec: 'specs/0001-a.md', to: 'Approved', at: at(1) },
        { spec: 'specs/0001-a.md', to: 'Implemented', at: at(8) },
      ],
    });
    const j = JSON.parse(run(dir, '--json').stdout);
    assert.equal(j.slowest[0].days, 7);
    assert.match(run(dir).out, /7d\s+Approved → Implemented/,
      'the human report and --json disagree about a span');
  });

  test('out-of-order records are surfaced in both', (t) => {
    const dir = repo(t, {
      specs: { '0001-a.md': SPEC },
      records: [
        // Implemented timestamped BEFORE its own Approved — genuinely out of lifecycle order.
        { spec: 'specs/0001-a.md', to: 'Approved', at: at(9) },
        { spec: 'specs/0001-a.md', to: 'Implemented', at: at(2) },
      ],
    });
    const j = JSON.parse(run(dir, '--json').stdout);
    assert.deepEqual(j.outOfOrder, ['specs/0001-a.md']);
    assert.match(run(dir).out, /out of chronological order/);
  });

  test('an empty board says so and still reports the excluded count', (t) => {
    const dir = repo(t, { specs: { '0001-a.md': SPEC } });
    const r = run(dir);
    assert.equal(r.code, 0);
    assert.match(r.out, /nothing to measure/);
    assert.match(r.out, /1 spec\(s\) carry no evidence record/,
      'an empty report still owes the reader the reason it is empty');
  });
});

describe('it writes nothing', () => {
  test('a full run leaves the tree untouched', (t) => {
    const dir = repo(t, {
      specs: { '0001-a.md': SPEC },
      records: [{ spec: 'specs/0001-a.md', to: 'Approved', at: at(1) }],
    });
    const before = spawnSync('find', [dir, '-type', 'f'], { encoding: 'utf8' }).stdout;
    run(dir);
    run(dir, '--json');
    assert.equal(spawnSync('find', [dir, '-type', 'f'], { encoding: 'utf8' }).stdout, before);
  });
});
