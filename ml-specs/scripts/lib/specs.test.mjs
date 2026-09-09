// Tests for the shared spec parser. Run with: node --test ml-specs/scripts/lib/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseCriteria, splitCell, resolveStatus, LIFECYCLE } from './specs.mjs';

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
