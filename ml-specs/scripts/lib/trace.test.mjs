// Tests for the ID spine. Run with: node --test ml-specs/scripts/lib/
// Pure Node's built-in runner — no dependencies, consistent with everything else here.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  slugify, specId, branchName, prTitle, testCaseId,
  keyFrom, buildChain, verifyChain, renderChain,
} from './trace.mjs';

const spec = {
  id: '0031',
  title: 'Idempotent refund submission',
  file: 'specs/0031-idempotent-refund-submission.md',
  ticket: 'PAY-2204',
  status: 'Approved',
  branch: 'feat/0031-idempotent-refund-submission',
  criteria: [{ id: 'AC-1', ordinal: 1 }, { id: 'AC-2', ordinal: 2 }],
};

describe('derivation and recovery are symmetric', () => {
  test('every id a function produces, a parser recovers', () => {
    assert.equal(branchName('0031', 'Idempotent refund submission'), 'feat/0031-idempotent-refund-submission');
    assert.equal(prTitle('0031', 'X'), '[SPEC-0031] X');
    assert.equal(testCaseId('0031', 3), 'TC-0031.3');

    assert.equal(keyFrom('branch', branchName('0031', 'X')), '0031');
    assert.equal(keyFrom('prTitle', prTitle('0031', 'X')), '0031');
    assert.equal(keyFrom('testCase', testCaseId('0031', 3)), '0031');
    assert.equal(keyFrom('specId', specId('0031')), '0031');
  });

  test('a suffixed spec id is a different spec, not a clash', () => {
    // Matches lib/specs.mjs: 0165 and 0165b coexist.
    assert.equal(keyFrom('branch', 'feat/0165b-follow-up'), '0165b');
    assert.notEqual(keyFrom('branch', 'feat/0165b-x'), keyFrom('branch', 'feat/0165-x'));
  });

  test('three-digit ids still read, so existing repos are not orphaned', () => {
    assert.equal(keyFrom('branch', 'feat/023-legacy'), '023');
    assert.equal(keyFrom('specFile', 'specs/023-legacy.md'), '023');
    assert.equal(keyFrom('specFile', 'specs/archive/0023-old.md'), '0023');
  });

  test('an artifact carrying no key returns null rather than guessing', () => {
    assert.equal(keyFrom('branch', 'feature/payment-thing'), null);
    assert.equal(keyFrom('prTitle', 'fix the thing'), null);
    assert.equal(keyFrom('testCase', 'TC-abc.1'), null);
  });

  test('slugify is bounded and never trails a hyphen', () => {
    assert.equal(slugify('Payment hold — on partial capture!'), 'payment-hold-on-partial-capture');
    const long = slugify('x'.repeat(80));
    assert.ok(long.length <= 48);
    assert.ok(!long.endsWith('-'));
  });

  test('an unknown artifact kind is a programming error, not a silent null', () => {
    assert.throws(() => keyFrom('nonsense', 'x'), /unknown artifact kind/);
  });
});

describe('chain verification', () => {
  test('a well-formed spec produces an intact chain', () => {
    const report = verifyChain(buildChain(spec));
    assert.equal(report.ok, true);
    assert.equal(report.broken.length, 0);
  });

  test('the hand-typed ticket is reported as unverifiable, not as passing', () => {
    // Counting it as passing would make the whole report a lie.
    const report = verifyChain(buildChain(spec));
    assert.deepEqual(report.unverifiable.map((l) => l.kind), ['ticket']);
  });

  test('a branch carrying the wrong key is caught with the key it does carry', () => {
    const report = verifyChain(buildChain({ ...spec, branch: 'feat/0019-wrong' }));
    assert.equal(report.ok, false);
    assert.equal(report.broken[0].reason, 'wrong-key');
    assert.equal(report.broken[0].found, '0019');
  });

  test('a branch with no key at all is caught as missing', () => {
    const report = verifyChain(buildChain({ ...spec, branch: 'hotfix-urgent' }));
    assert.equal(report.broken[0].reason, 'missing-key');
    assert.equal(report.broken[0].found, null);
  });

  test('a Draft spec has no test cases in its chain yet', () => {
    const chain = buildChain({ ...spec, status: 'Draft' });
    assert.ok(!chain.links.some((l) => l.kind === 'testCase'));
  });

  test('an approved spec pairs every criterion with a test case', () => {
    const cases = buildChain(spec).links.filter((l) => l.kind === 'testCase');
    assert.deepEqual(cases.map((l) => l.ref), ['TC-0031.1', 'TC-0031.2']);
    assert.deepEqual(cases.map((l) => l.from), ['AC-1', 'AC-2']);
  });

  test('a spec with no recorded branch falls back to the derived one', () => {
    const chain = buildChain({ ...spec, branch: null });
    const branch = chain.links.find((l) => l.kind === 'branch');
    assert.equal(branch.origin, 'derived');
    assert.equal(verifyChain(chain).ok, true);
  });

  test('renderChain marks what it could not check', () => {
    assert.match(renderChain(buildChain(spec)), /PAY-2204 \(unverified\)/);
  });
});
