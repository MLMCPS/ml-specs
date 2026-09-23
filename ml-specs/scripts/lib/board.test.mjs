// Spec 0036 — the board-wide logic.
//
// AC2 is the one with a real failure behind it: `specs/README.md` says numbers are never reused,
// and nothing enforced it. An archived 0031 is still 0031, and a scaffold that hands it out again
// produces two specs with one number and a merge that silently keeps whichever landed second.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nextSpecNumber, usableSlug, RIGORS, shipped, spliceUnreleased } from './board.mjs';

const SPEC = (status, title = 'a thing', revisions = '') => `# Spec: ${title}

| | |
|---|---|
| **Status** | ${status} |
| **Branch** | — |
| **Author** | Ada |

${revisions}## 5. Acceptance criteria
- [x] **AC1** — it validates.

## 8. Open questions
None blocking.
`;

const REVISIONS = `## Revisions

| # | What changed | Why | Sections |
|---|--------------|-----|----------|
| 2 | widened the allowlist | a real command was refused | 4.2 |
| 1 | initial draft | — | — |

`;

/** A repo with specs, optionally some archived. */
function repo(t, { specs = {}, archive = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mlspecs-board-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'specs', 'archive'), { recursive: true });
  for (const [name, body] of Object.entries(specs)) writeFileSync(join(dir, 'specs', name), body);
  for (const [name, body] of Object.entries(archive)) writeFileSync(join(dir, 'specs', 'archive', name), body);
  execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'ignore' });
  return dir;
}

describe('AC2 — a number is never reused', () => {
  test('the archive counts', (t) => {
    // The failure: `0031` is archived, `nextSpecNumber` reads only `specs/`, and the next scaffold
    // hands out 0031 again.
    const dir = repo(t, {
      specs: { '0001-a.md': SPEC('Draft') },
      archive: { '0031-old.md': SPEC('Archived') },
    });
    assert.equal(nextSpecNumber(dir, { fetch: false }).next, '0032');
  });

  test('an empty board starts at 0001', (t) => {
    assert.equal(nextSpecNumber(repo(t), { fetch: false }).next, '0001');
  });

  test('gaps are not filled — a deleted 0002 does not come back', (t) => {
    const dir = repo(t, { specs: { '0001-a.md': SPEC('Draft'), '0003-c.md': SPEC('Draft') } });
    assert.equal(nextSpecNumber(dir, { fetch: false }).next, '0004');
  });

  test('the caveat travels with the number', (t) => {
    // A number derived without fetching can collide, and a caller handed one with no warning has
    // no way to know. The warning is part of the return, not a log line somebody may not print.
    const n = nextSpecNumber(repo(t), { fetch: false });
    assert.ok(n.warning, 'a number with no remote checked carries no caveat');
    assert.match(n.warning, /remote/i);
    assert.equal(n.remoteChecked, false);
  });
});

describe('AC3 — a slug that would become something other than a filename', () => {
  for (const [slug, why] of [
    ['../escape', 'a path'],
    ['has space', 'a space'],
    ['UPPER', 'uppercase'],
    ['-leading', 'a leading hyphen'],
    ['', 'empty'],
  ]) {
    test(`${why} is refused`, () => {
      assert.ok(usableSlug(slug), `'${slug}' was accepted`);
    });
  }

  test('an ordinary slug is fine', () => {
    assert.equal(usableSlug('token-validator'), null);
    assert.equal(usableSlug('a1'), null);
  });

  test('the rigor set is the three the template names', () => {
    assert.deepEqual([...RIGORS], ['light', 'standard', 'deep']);
  });
});

describe('AC7 — a spec with no Revisions table', () => {
  test('contributes its title and does not break the run', (t) => {
    // `specs/TEMPLATE.md:31-33` says to skip Revisions entirely when a spec was approved first
    // pass. Treating its absence as a defect would punish the specs that went smoothest.
    const dir = repo(t, { specs: { '0001-a.md': SPEC('Verified', 'went smoothly') } });
    const [s] = shipped(dir);
    assert.equal(s.title, 'went smoothly');
    assert.deepEqual(s.revisions, []);
  });

  test('a spec with revisions carries them, newest first once sorted', (t) => {
    const dir = repo(t, { specs: { '0001-a.md': SPEC('Verified', 'a thing', REVISIONS) } });
    const [s] = shipped(dir);
    assert.equal(s.revisions.length, 2);
    assert.equal(s.revisions.find((r) => r.n === 2).what, 'widened the allowlist');
  });

  test('only shipped statuses count', (t) => {
    const dir = repo(t, {
      specs: { '0001-a.md': SPEC('Draft'), '0002-b.md': SPEC('Verified') },
      archive: { '0003-c.md': SPEC('Archived') },
    });
    assert.deepEqual(shipped(dir).map((s) => s.number), ['0002', '0003']);
  });
});

describe('AC6 — the splice leaves released sections alone', () => {
  const CHANGELOG = `# Changelog

## [Unreleased]

- an old line

## [1.2.0] - 2026-01-01

### Fixed
- something released
`;

  test('only the Unreleased section changes', () => {
    const { text, error } = spliceUnreleased(CHANGELOG, '- a new line');
    assert.equal(error, null);
    // The released section, byte for byte. A splice that reflows the whole file passes an
    // assertion about the one section it meant to change.
    const released = (s) => s.slice(s.indexOf('## [1.2.0]'));
    assert.equal(released(text), released(CHANGELOG));
    assert.match(text, /- a new line/);
  });

  test('a changelog with no Unreleased section is an error, not a silent no-op', () => {
    const { text, error } = spliceUnreleased('# Changelog\n\n## [1.0.0]\n\n- x\n', '- new');
    assert.match(error ?? '', /no \[Unreleased\]/);
    assert.equal(text, '# Changelog\n\n## [1.0.0]\n\n- x\n', 'the text changed despite the error');
  });

  test('an Unreleased section that runs to the end of the file still splices', () => {
    const { text, error } = spliceUnreleased('# Changelog\n\n## [Unreleased]\n\n- old\n', '- new');
    assert.equal(error, null);
    assert.match(text, /- new/);
  });
});
