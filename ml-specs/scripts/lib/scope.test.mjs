// One definition of "is this path inside that declaration".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { norm, covers, outside, toRepoRelative, ALWAYS_WRITABLE } from './scope.mjs';

test('a declaration covers itself and anything under it, and nothing beside it', () => {
  assert.equal(covers('src/billing', 'src/billing'), true);
  assert.equal(covers('src/billing', 'src/billing/tax.ts'), true);
  assert.equal(covers('src/billing', 'src/billing/deep/nested/x.ts'), true);

  // The one that matters: a sibling sharing a prefix is NOT inside it. `src/billing-legacy`
  // starts with `src/billing`, and a naive prefix test would wave it through.
  assert.equal(covers('src/billing', 'src/billing-legacy/x.ts'), false);
  assert.equal(covers('src/billing', 'src/other/x.ts'), false);
});

test('a trailing slash or a backtick is spelling, not meaning', () => {
  assert.equal(norm('`src/billing/`'), 'src/billing');
  assert.equal(norm('./src/billing'), 'src/billing');
  for (const d of ['src/billing', 'src/billing/', '`src/billing/`', './src/billing']) {
    assert.equal(covers(d, 'src/billing/tax.ts'), true, `${d} should cover the file`);
  }
});

test('SENSOR: a relative .. cannot walk out of the repository', () => {
  // `covers` is a prefix test, so `src/billing/../../escape/x.ts` "starts with" `src/billing/`
  // and would be allowed — a write landing outside the repo entirely. Resolving first closes it,
  // and the answer names where the path actually lands rather than the spelling it was handed.
  const out = toRepoRelative('/repo', 'src/billing/../../escape/x.ts');
  assert.equal(out.includes('..'), false, 'the answer still contains ..');
  assert.equal(outside(['src/billing'], [out]).length, 1, 'the escape was allowed');

  for (const p of ['src/billing/tax.ts', './src/billing/tax.ts', 'src/billing/../billing/tax.ts']) {
    assert.deepEqual(outside(['src/billing'], [toRepoRelative('/repo', p)]), [], `${p} is in scope`);
  }
});

test('specs/ and .ml-specs/ are always writable', () => {
  // A spec that blocks you has to be editable — the fix for an out-of-scope change is very often
  // to widen the declaration, and a rule you cannot amend is one people route around.
  assert.deepEqual(ALWAYS_WRITABLE, ['specs', '.ml-specs']);
  assert.deepEqual(outside(['src/billing'], ['specs/0001-x.md', '.ml-specs/evidence/a.json']), []);
});

test('an empty declaration bounds nothing — the caller decides what that means', () => {
  // Conflating "declared nothing" with "declared that nothing is allowed" would make every
  // unfilled template refuse every write, which is how a guard gets switched off on day one.
  assert.deepEqual(outside([], ['src/anything.ts']), []);
  assert.deepEqual(outside(null, ['src/anything.ts']), []);
});

test('outside names every stray path, not just the first', () => {
  const stray = outside(['src/billing'], ['src/billing/a.ts', 'src/other/b.ts', 'docs/c.md']);
  assert.deepEqual(stray, ['src/other/b.ts', 'docs/c.md']);
});
