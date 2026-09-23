// Spec 0035 — durations, rounds, and the two rules about not flattering the numbers.
//
// AC5 IS THE ONE THAT MATTERS, and it runs against THIS REPOSITORY'S real evidence records. Every
// one carries `attested.by` — a name and an email — so a per-person breakdown is one field away.
// A fixture with no name in it could not fail this, which is why it is not used.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { durations, rounds, readRecords, report } from './cycle.mjs';

// Four levels: scripts/lib/ -> scripts/ -> ml-specs/ -> the repo root. Three was one short, and
// the two assertions below then ran against a directory with no evidence records at all — passing
// because there was nothing to leak. The third test in this block exists to catch exactly that.
const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

const at = (d) => new Date(`2026-01-${String(d).padStart(2, '0')}T00:00:00Z`);
const rec = (spec, to, day) => ({ spec, to, at: at(day) });

describe('AC1 — durations are within one spec, never across two', () => {
  test('consecutive transitions of the same spec', () => {
    const { durations: d } = durations([
      rec('specs/0001-a.md', 'Approved', 1),
      rec('specs/0001-a.md', 'Implemented', 4),
      rec('specs/0001-a.md', 'Verified', 5),
    ]);
    assert.deepEqual(d.map((x) => x.days), [3, 1]);
    assert.equal(d[0].from, 'Approved');
    assert.equal(d[0].to, 'Implemented');
  });

  test('two specs interleaved do not produce a cross-spec span', () => {
    // The records are one directory. A naive sort computes the gap between one spec's Approved and
    // another's Implemented — a number that means nothing and looks entirely plausible.
    const { durations: d } = durations([
      rec('specs/0001-a.md', 'Approved', 1),
      rec('specs/0002-b.md', 'Approved', 2),
      rec('specs/0001-a.md', 'Implemented', 10),
    ]);
    assert.equal(d.length, 1, `expected one span, got ${JSON.stringify(d)}`);
    assert.equal(d[0].spec, 'specs/0001-a.md');
    assert.equal(d[0].days, 9);
  });

  test('a single record produces no span', () => {
    assert.deepEqual(durations([rec('specs/0001-a.md', 'Approved', 1)]).durations, []);
  });
});

describe('AC3 — records out of order are reported, not turned into a negative', () => {
  test('a later lifecycle step with an earlier timestamp is out of order', () => {
    // Implemented BEFORE its own Approved. That is genuinely wrong — a re-record, a clock, a
    // hand-edited file — however the two were read.
    const { durations: d, outOfOrder } = durations([
      rec('specs/0001-a.md', 'Approved', 9),
      rec('specs/0001-a.md', 'Implemented', 2),
    ]);
    assert.deepEqual(outOfOrder, ['specs/0001-a.md']);
    assert.ok(d.every((x) => x.days >= 0), 'a spec appeared to finish before it started');
  });

  test('records merely READ in a different order are not out of order', () => {
    // The first version compared each record to the one before it as loaded, so this case was
    // flagged — and the real path, where `readRecords` sorts first, was never flagged at all.
    // Reading order is not a property of the work.
    const { outOfOrder } = durations([
      rec('specs/0001-a.md', 'Implemented', 5),
      rec('specs/0001-a.md', 'Approved', 1),
    ]);
    assert.deepEqual(outOfOrder, [], 'reading order was mistaken for lifecycle disorder');
  });
});

describe('AC4 — review rounds', () => {
  const SPEC = (revisions) => `# Spec: a thing\n\n| | |\n|---|---|\n| **Status** | Draft |\n\n${revisions}## 1. Problem\n\nx\n`;

  test('counts the rows in the Revisions table', () => {
    assert.equal(rounds(SPEC('## Revisions\n\n| # | What | Why | Sections |\n|---|---|---|---|\n| 2 | b | y | 4 |\n| 1 | a | — | — |\n\n')), 2);
  });

  test('0 for a spec with no Revisions section — approved first pass', () => {
    // `specs/TEMPLATE.md:31-33` says to skip the section entirely in that case, so its absence
    // means zero rounds, not missing data.
    assert.equal(rounds(SPEC('')), 0);
  });

  test('a table row elsewhere in the spec is not counted as a revision', () => {
    // §6's test plan is a table too, and its rows start with `| AC1 |` not `| 1 |` — but a §4.2
    // data table can start with a digit. Scoped to the Revisions section for that reason.
    const withSix = SPEC('') + '\n## 6. Test plan\n\n| # | x |\n|---|---|\n| 1 | y |\n| 2 | z |\n';
    assert.equal(rounds(withSix), 0);
  });
});

describe('AC2 — a spec with no records is excluded, never counted as zero', () => {
  function repo(t, { specs = {}, records = [] } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'mlspecs-cycle-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, 'specs'), { recursive: true });
    mkdirSync(join(dir, '.ml-specs', 'evidence'), { recursive: true });
    for (const [n, b] of Object.entries(specs)) writeFileSync(join(dir, 'specs', n), b);
    records.forEach((r, i) => writeFileSync(join(dir, '.ml-specs', 'evidence', `r${i}.json`), JSON.stringify(r)));
    return dir;
  }
  const SPEC = '# Spec: a\n\n| | |\n|---|---|\n| **Status** | Draft |\n';

  test('it appears in `excluded` with a reason and contributes to no average', (t) => {
    const dir = repo(t, {
      specs: { '0001-a.md': SPEC, '0002-b.md': SPEC },
      records: [
        { spec: 'specs/0001-a.md', to: 'Approved', at: at(1).toISOString() },
        { spec: 'specs/0001-a.md', to: 'Implemented', at: at(3).toISOString() },
      ],
    });
    const r = report(dir);
    assert.equal(r.specsMeasured, 1);
    assert.equal(r.excluded.length, 1);
    assert.match(r.excluded[0].spec, /0002-b/);
    assert.ok(r.excluded[0].why, 'excluded with no reason given');
    assert.equal(r.inStatus.Approved.n, 1, 'the unrecorded spec was counted as an instant transition');
  });

  test('an unreadable record is reported, not silently dropped', (t) => {
    const dir = repo(t, { specs: { '0001-a.md': SPEC } });
    writeFileSync(join(dir, '.ml-specs', 'evidence', 'broken.json'), '{ not json');
    assert.equal(readRecords(dir).unreadable.length, 1);
    assert.equal(report(dir).unreadable.length, 1);
  });
});

describe('AC5 — nothing is keyed to a person', () => {
  test('no output carries a name or an email, against the REAL records', () => {
    // This repo's records carry `attested.by` with both. A fixture without one could not fail.
    const r = report(ROOT);
    const text = JSON.stringify(r);
    assert.doesNotMatch(text, /@[\w.-]+\.\w+/, 'an email address reached the report');
    assert.doesNotMatch(text, /attested|\bby\b\s*:/i, 'the attestation block reached the report');
  });

  test('and the report has no per-person shape at all', () => {
    const r = report(ROOT);
    const keys = JSON.stringify(Object.keys(r));
    assert.doesNotMatch(keys, /author|person|by|who/i,
      'a per-person aggregation appeared — spec 0035 §2 makes that a permanent non-goal');
  });

  test('the fixture this runs against really does contain a name', () => {
    // Otherwise the two assertions above pass because there was nothing to leak.
    const { records } = readRecords(ROOT);
    assert.ok(records.length > 0, 'no evidence records — AC5 asserts nothing');
    const raw = readFileSync(join(ROOT, '.ml-specs', 'evidence', '0036-board-verbs-implemented.json'), 'utf8');
    assert.match(raw, /@[\w.-]+\.\w+/, 'the record carries no email, so the leak guard is untested');
  });
});
