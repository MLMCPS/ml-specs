// Tests for the shared spec parser. Run with: node --test ml-specs/scripts/lib/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { parseCriteria, splitCell, resolveStatus, listSpecs, LIFECYCLE, rigorOf, RIGOR } from './specs.mjs';

describe('acceptance criteria', () => {
  test('the template style parses', () => {
    const acs = parseCriteria('- [ ] **AC1** — Given a key, when replayed, then the original returns.');
    assert.equal(acs.length, 1);
    assert.deepEqual(acs[0], { id: 'AC-1', ordinal: 1, text: 'Given a key, when replayed, then the original returns.', checked: false });
  });

  test('the hand-written style parses too', () => {
    const acs = parseCriteria('- [x] AC-2: plain style, colon separator');
    assert.equal(acs[0].id, 'AC-2');
    assert.equal(acs[0].checked, true);
  });

  test('criteria come back in ordinal order regardless of file order', () => {
    const acs = parseCriteria('- [ ] **AC3** — third\n- [ ] **AC1** — first\n- [ ] **AC2** — second');
    assert.deepEqual(acs.map((a) => a.ordinal), [1, 2, 3]);
  });

  test('a plain checklist that is not a criterion is ignored', () => {
    assert.equal(parseCriteria('- [ ] buy milk\n- [x] deploy').length, 0);
  });
});

describe('header cells', () => {
  test('comma and slash separated values split', () => {
    assert.deepEqual(splitCell('api-neelias, neelias-pos'), ['api-neelias', 'neelias-pos']);
    assert.deepEqual(splitCell('NFR-03 / NFR-07'), ['NFR-03', 'NFR-07']);
  });

  test('unfilled template placeholders read as absent', () => {
    // Treated as a real repo, `<repo or service name>` would fan a pull request
    // out to a repository that does not exist.
    assert.deepEqual(splitCell('<repo or service name>'), []);
    assert.deepEqual(splitCell('_TBD_'), []);
    assert.deepEqual(splitCell('—'), []);
    assert.deepEqual(splitCell(null), []);
  });

  test('backticks and bold are stripped', () => {
    assert.deepEqual(splitCell('`api-neelias`, **neelias-pos**'), ['api-neelias', 'neelias-pos']);
  });
});

describe('status resolution is unchanged by the new fields', () => {
  test('a canonical status resolves cleanly', () => {
    const r = resolveStatus('Approved');
    assert.equal(r.status, 'Approved');
    assert.equal(r.canonical, true);
  });

  test('prose leading with a stage word is a claim', () => {
    assert.equal(resolveStatus('Implemented (2026-07-07) — all 16 ACs met').status, 'Implemented');
  });

  test('a stage word buried mid-sentence is discussion, not a claim', () => {
    const r = resolveStatus('Phase 1 done, not yet verified by QA');
    assert.equal(r.leading, false);
  });

  test('the lifecycle is the five stages the toolkit ships', () => {
    assert.deepEqual(LIFECYCLE, ['Draft', 'Approved', 'Implemented', 'Verified', 'Archived']);
  });
});

describe('listSpecs filters by filename', () => {
  test('an explore- note is invisible to listSpecs while a real spec is not', () => {
    // Spec 0007 AC10. `/ml-specs:spec-explore` writes `specs/explore-<slug>.md` with no four-digit
    // prefix, deliberately: SPEC_FILE does not match it, so it never carries a Status, never
    // appears in /ml-specs:repo-status or spec_list, and /ml-specs:spec-advance neither reads nor
    // writes it. The fixture holds BOTH kinds of file — with only the note, an empty result would
    // pass the assertion vacuously and prove nothing about filtering.
    //
    // This is the first filesystem-backed case in this file; everything above is pure parsing.
    const dir = mkdtempSync(join(tmpdir(), 'sdd-specs-'));
    try {
      mkdirSync(join(dir, 'specs'), { recursive: true });
      writeFileSync(join(dir, 'specs', 'explore-foo.md'),
        '# Explore: foo\n\n| | |\n|---|---|\n| **Ticket** | \u2014 (no tracker) |\n| **Title** | foo |\n| **Date** | 2026-09-15 |\n');
      writeFileSync(join(dir, 'specs', '0001-real.md'),
        '# Spec: real\n\n| | |\n|---|---|\n| **Status** | Draft |\n');

      const specs = listSpecs(dir);
      assert.deepEqual(specs.map((s) => s.file), ['specs/0001-real.md']);
      assert.equal(specs[0].id, '0001');
      assert.equal(specs[0].slug, 'real');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an explain- note is invisible to listSpecs while a real spec is not', () => {
    // Spec 0011 AC9. `/ml-specs:explain` writes `specs/explain-<slug>.md`, the third file family to
    // live under specs/ and the second with no four-digit prefix. It relies on exactly the same
    // mechanism as the explore- note above — SPEC_FILE at lib/specs.mjs:44 — and on NO new filter
    // code, which is precisely why "nothing changed" is asserted here rather than assumed: a
    // regression that widened SPEC_FILE would silently give explain notes a lifecycle identity.
    //
    // The fixture holds BOTH kinds of file: with only the note, an empty result would pass
    // vacuously and prove nothing about filtering.
    const dir = mkdtempSync(join(tmpdir(), 'sdd-specs-'));
    try {
      mkdirSync(join(dir, 'specs'), { recursive: true });
      writeFileSync(join(dir, 'specs', 'explain-foo.md'),
        '# Explain: foo\n\n| | |\n|---|---|\n| **Target** | src/foo.mjs |\n| **Title** | foo |\n| **Date** | 2026-09-15 |\n');
      writeFileSync(join(dir, 'specs', '0001-real.md'),
        '# Spec: real\n\n| | |\n|---|---|\n| **Status** | Draft |\n');

      const specs = listSpecs(dir);
      assert.deepEqual(specs.map((s) => s.file), ['specs/0001-real.md']);
      assert.equal(specs[0].id, '0001');
      assert.equal(specs[0].slug, 'real');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('rigor', () => {
  test('AC8: a declared rigor is carried through', () => {
    assert.equal(rigorOf('deep'), 'deep');
    assert.equal(rigorOf('light'), 'light');
    assert.deepEqual(RIGOR, ['light', 'standard', 'deep']);
  });

  test('AC9/AC10: absent, empty and unrecognised all resolve to standard', () => {
    // Fail toward MORE rigor, never less. A spec written before the row existed keeps today's
    // behaviour, and a typo cannot silently weaken a suite — only one of those directions is safe.
    for (const v of ['', null, undefined, '—', 'lite', 'DEEPER', 'light | standard | deep']) {
      assert.equal(rigorOf(v), 'standard', `${JSON.stringify(v)} should resolve to standard`);
    }
  });

  test('AC8: the cell is read case- and decoration-insensitively', () => {
    for (const v of ['deep', 'DEEP', ' Deep ', '`deep`', '**deep**']) assert.equal(rigorOf(v), 'deep');
  });

  test('AC8/AC9: listSpecs carries rigor for every spec, defaulting to standard', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mlspecs-rigor-'));
    try {
      mkdirSync(join(dir, 'specs'), { recursive: true });
      const spec = (n, row) => `# Spec: ${n}\n\n| | |\n|---|---|\n${row}| **Status** | Draft |\n\n- [ ] **AC1** — a\n`;
      writeFileSync(join(dir, 'specs', '0001-a.md'), spec('a', '| **Rigor** | deep |\n'));
      writeFileSync(join(dir, 'specs', '0002-b.md'), spec('b', ''));

      const got = Object.fromEntries(listSpecs(dir).map((s) => [s.id, s.rigor]));
      assert.deepEqual(got, { '0001': 'deep', '0002': 'standard' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
