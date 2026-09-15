// The CI knowledge-check template, exercised over a throwaway fixture repo.
//
// It lives here rather than beside its subject because `templates/` means exactly one thing —
// what gets written into an adopting repo — and a `.test.mjs` there would ship into every
// plugin install (see the spec's decision 8, and docs/PATTERNS.md).
//
// The fixture is two directories deep because that is where the docs actually live, and
// because `DOC_FILES` / `DOC_DIRS` in the checker are hard-coded: a fixture doc anywhere but
// `docs/architecture/*.md` is silently never read, and the run comes back `empty: true`.
// Every helper below asserts that, so a mis-placed fixture fails loudly instead of passing
// vacuously.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { runChecks } from '../templates/ci/knowledge-check.mjs';

const DOC = 'docs/architecture/notes.md';
const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');

let root;

function put(rel, body) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
}

/** Write the doc under test at `docs/architecture/`, run the checker, return its findings. */
function check(body) {
  put(DOC, `# notes\n\n${body}\n`);
  const result = runChecks({ root });
  assert.equal(result.empty, false, 'fixture docs were not read — check the fixture layout');
  return result;
}

const messages = (result) => result.errors.map((e) => e.msg);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sdd-'));
  put('.github/workflows/release.yml', lines(130));
  put('ml-specs/package.json', lines(10));
  put('ml-specs/scripts/lib/cli.mjs', lines(130));
  put('docs/sibling.md', lines(3));
  put('root.md', lines(2));
  // Deliberately different lengths: AC6's whole claim is that these are two DIFFERENT
  // targets, and identical fixtures would let a swapped resolution pass unnoticed.
  put('a/b.mjs', lines(2));
  put('b.mjs', lines(7));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('AC1 — dot-prefixed paths resolve', () => {
  test('a citation of .github/workflows/release.yml:127 that exists produces no error', () => {
    const result = check('CI is `.github/workflows/release.yml:127`.');
    assert.deepEqual(messages(result), []);
    assert.equal(result.refsChecked, 1);
  });
});

describe('AC2 — a dot-prefixed path that is missing still fails', () => {
  test('.github/workflows/nope.yml:1 produces exactly one error naming that path', () => {
    const result = check('CI is `.github/workflows/nope.yml:1`.');
    assert.deepEqual(messages(result), [
      'references .github/workflows/nope.yml:1, but .github/workflows/nope.yml does not exist',
    ]);
  });
});

describe('AC3 — plain repo-relative paths behave exactly as before', () => {
  test('one line with two references yields exactly two, and no error when both resolve', () => {
    const result = check('See `ml-specs/package.json:3` and `ml-specs/scripts/lib/cli.mjs:6`.');
    assert.deepEqual(messages(result), []);
    assert.equal(result.refsChecked, 2);
  });

  test('both are captured whole, as ml-specs/package.json and ml-specs/scripts/lib/cli.mjs', () => {
    // Over-range line numbers make the checker print each captured path back verbatim, which is
    // the only way from outside to pin what the regex actually captured.
    const result = check('See `ml-specs/package.json:9999` and `ml-specs/scripts/lib/cli.mjs:9999`.');
    assert.deepEqual(messages(result), [
      'references ml-specs/package.json:9999, but that file is only 10 lines',
      'references ml-specs/scripts/lib/cli.mjs:9999, but that file is only 130 lines',
    ]);
  });

  test('the range form :107-125 still resolves', () => {
    const result = check('See `ml-specs/scripts/lib/cli.mjs:107-125`.');
    assert.deepEqual(messages(result), []);
    assert.equal(result.refsChecked, 1);
  });
});

describe('AC4 — the narrowing: a doubled dot is not a path', () => {
  test('..github/x.yml:1 yields no reference at all', () => {
    const result = check('Not a path: ..github/x.yml:1');
    assert.equal(result.refsChecked, 0);
    assert.deepEqual(messages(result), []);
  });

  test('foo.github/x.yml:1 yields exactly one reference, captured whole', () => {
    const result = check('A real path: foo.github/x.yml:1');
    assert.equal(result.refsChecked, 1);
    assert.deepEqual(messages(result), [
      'references foo.github/x.yml:1, but foo.github/x.yml does not exist',
    ]);
  });
});

describe('AC5 — ./ and ../ resolve against the doc that wrote them', () => {
  test('../sibling.md:1 and ../../root.md:1 resolve doc-relative and pass', () => {
    const result = check('See `../sibling.md:1` and `../../root.md:1`.');
    assert.deepEqual(messages(result), []);
    assert.equal(result.refsChecked, 2);
  });

  test('./nope.md:1 produces exactly one error', () => {
    const result = check('See `./nope.md:1`.');
    assert.equal(result.errors.length, 1);
  });

  test('a multi-level relative path is never captured as a bare trailing fragment', () => {
    const result = check('See `../../nowhere/knowledge-check.mjs:34`.');
    assert.deepEqual(messages(result), [
      'references ../../nowhere/knowledge-check.mjs:34, but ../../nowhere/knowledge-check.mjs does not exist',
    ]);
  });
});

describe('AC6 — mid-path . and .. segments are normalised', () => {
  test('a/./b.mjs:1 resolves to a/b.mjs and passes', () => {
    const result = check('See `a/./b.mjs:1`.');
    assert.deepEqual(messages(result), []);
    assert.equal(result.refsChecked, 1);
  });

  test('a/../b.mjs:1 resolves to b.mjs and passes', () => {
    const result = check('See `a/../b.mjs:1`.');
    assert.deepEqual(messages(result), []);
    assert.equal(result.refsChecked, 1);
  });

  test('the two forms resolve to different files, not the same one', () => {
    // The passing cases above cannot see WHICH file was read, so a swapped resolution
    // would satisfy them both. Over-range line numbers make the checker report each
    // resolved file's real length, which pins the target from outside — the same trick
    // AC3 uses. a/b.mjs is 2 lines, b.mjs is 7.
    const result = check('See `a/./b.mjs:9999` and `a/../b.mjs:9999`.');
    assert.deepEqual(messages(result), [
      'references a/./b.mjs:9999, but that file is only 2 lines',
      'references a/../b.mjs:9999, but that file is only 7 lines',
    ]);
  });
});

describe('AC7 — a reference that leaves the repo is reported, not skipped', () => {
  test('a/../../../../etc/hosts.md:1 escapes without ever beginning with ../', () => {
    const result = check('See `a/../../../../etc/hosts.md:1`.');
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].msg, /resolves outside the repository root$/);
  });

  test('../../../../../etc/hosts.md:1 escapes doc-relative', () => {
    const result = check('See `../../../../../etc/hosts.md:1`.');
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].msg, /resolves outside the repository root$/);
  });
});

describe('AC8 — the error names the path as the doc wrote it', () => {
  test('a broken relative reference names ./nope.md, not the resolved form', () => {
    const result = check('See `./nope.md:1`.');
    assert.deepEqual(messages(result), [
      'references ./nope.md:1, but ./nope.md does not exist',
    ]);
  });

  test('an escaping reference gets its own wording, distinct from "does not exist"', () => {
    const result = check('See `../../../../../etc/hosts.md:1`.');
    assert.deepEqual(messages(result), [
      'references ../../../../../etc/hosts.md:1, but ../../../../../etc/hosts.md '
      + 'resolves outside the repository root',
    ]);
  });
});

describe('AC14 — the line count resolves doc-relative too', () => {
  test('../sibling.md:9999 reports one out-of-range error, naming the path as written', () => {
    const result = check('See `../sibling.md:9999`.');
    assert.deepEqual(messages(result), [
      'references ../sibling.md:9999, but that file is only 3 lines',
    ]);
  });
});
