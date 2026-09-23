// Spec 0062 — the assumptions that only held on the machine this was written on.
//
// AC1 and AC2 build the SAME spec twice, once with each line ending, and compare the gate's WHOLE
// output rather than one field. A per-field assertion passes while the field beside it carries a
// trailing `\r`, and the field beside it is the one that breaks: a §6 row resolving to
// `test/thing.test.mjs\r` makes the gate report a file that is sitting right there as missing.
//
// `.gitattributes` already normalises this repo to LF, and that is a mitigation rather than a fix.
// It protects a checkout that HAS one. An adopting repo usually does not, and `core.autocrlf=true`
// on Windows then puts CRLF in the working tree — which is what the gate reads.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE));
const GATE = join(HERE, 'spec-gate.mjs');

const SPEC = `# Spec: a thing

| | |
|---|---|
| **Status** | Draft |
| **Branch** | feat/thing |
| **Author** | Ada |

## 5. Acceptance criteria
- [x] **AC1** — it validates the token.

## 6. Test plan
| AC | Test file | What it proves |
|---|---|---|
| AC1 | \`test/thing.test.mjs\` | it validates |

### 6.1 Final acceptance
- Full suite: \`npm test\`

## 8. Open questions
None blocking.
`;

/** A repo holding one spec, written with the given line ending. */
function repo(t, eol) {
  const dir = mkdtempSync(join(tmpdir(), 'mlspecs-eol-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'specs'), { recursive: true });
  mkdirSync(join(dir, 'test'), { recursive: true });
  writeFileSync(join(dir, 'specs', '0001-thing.md'), SPEC.split('\n').join(eol));
  writeFileSync(join(dir, 'test', 'thing.test.mjs'), '// proves AC1\n');
  return dir;
}

const gate = (dir, ...args) => {
  const r = spawnSync(process.execPath, [GATE, 'specs/0001-thing.md', '--root', dir, ...args], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

describe('AC1 — a CRLF spec gates identically to an LF one', () => {
  test('same verdicts, same output, same exit code', (t) => {
    const lf = gate(repo(t, '\n'), '--to', 'Approved');
    const crlf = gate(repo(t, '\r\n'), '--to', 'Approved');

    // The whole output, not one field. The failure this guards leaves the Status parsing fine and
    // the §6 path carrying a `\r`.
    const strip = (s) => s.replace(/mlspecs-eol-[A-Za-z0-9]+/g, 'DIR');
    assert.equal(strip(crlf.out), strip(lf.out),
      'a CRLF spec produced a different gate report from the same spec with LF endings');
    assert.equal(crlf.code, lf.code);
  });

  test('and the Status cell is read, not read-with-a-carriage-return', (t) => {
    // The symptom: `Approved\r` matches no lifecycle value, so the gate refuses a transition for a
    // status it cannot name — which reads as a broken toolkit, not as a line-ending problem.
    const r = gate(repo(t, '\r\n'), '--to', 'Approved');
    assert.doesNotMatch(r.out, /\\r|\r(?!\n)/, 'a carriage return reached the report');
    assert.match(r.out, /Draft → Approved/, `the lifecycle line is missing:\n${r.out}`);
  });
});

describe('AC2 — a §6 test path is not resolved with a trailing CR', () => {
  test('the named file is found in a CRLF spec', (t) => {
    const dir = repo(t, '\r\n');
    const r = gate(dir, '--to', 'Implemented');

    assert.ok(existsSync(join(dir, 'test', 'thing.test.mjs')), 'fixture is wrong');
    // Scoped to the `tests-exist` gate's own line. A file-global search for "missing" matches the
    // closing sentence every failing run prints — "the one command that produces the missing
    // evidence" — which would make this pass or fail for reasons unrelated to line endings.
    const row = r.out.split('\n').find((l) => l.includes('tests-exist')) ?? '';
    assert.match(row, /PASS/,
      `the gate did not resolve a §6 path in a CRLF spec:\n${r.out}`);
    assert.doesNotMatch(row, /\\r/, 'a carriage return reached the resolved path');
  });

  test('and a genuinely missing file still fails — or the above proves nothing', (t) => {
    const dir = repo(t, '\r\n');
    rmSync(join(dir, 'test', 'thing.test.mjs'));
    const r = gate(dir, '--to', 'Implemented');
    assert.notEqual(r.code, 0, 'a missing §6 file passed the gate');
  });
});

describe('AC5 — every platform assumption is fixed or written down', () => {
  const PATTERNS = join(ROOT, 'docs', 'PATTERNS.md');

  /** The areas the survey covered. A row here with nothing in PATTERNS.md is an unstated limit. */
  const SURVEYED = ['line endings', 'path separators', 'case-insensitive', 'symlink', 'module system'];

  test('the surveyed areas each have a row, and each row states a condition', () => {
    // Scoped to a ROW carrying a state word, not to the phrase appearing anywhere. A substring
    // check scored zero when the heading was mangled — the area name survived inside the mangled
    // text and the assertion never noticed. An area listed with no state is an unstated limit
    // wearing a table row, which is the exact thing this criterion exists to prevent.
    const rows = readFileSync(PATTERNS, 'utf8').split('\n').filter((l) => l.trim().startsWith('|'));
    const STATE = /\b(Fixed|Believed|Partly|unverified|not exercised)\b/;

    for (const area of SURVEYED) {
      // The area name INSIDE the bold label, not the whole of it: the rows read "Case-insensitive
      // filesystems" and "Host module system", so an exact-label match would fail at baseline.
      const row = rows.find((l) => new RegExp(`\\*\\*[^|]*${area}[^|]*\\*\\*`, 'i').test(l));
      assert.ok(row,
        `"${area}" was surveyed and has no row in docs/PATTERNS.md — an unstated limit is worse `
        + 'than a stated one, because nobody knows to look for it');
      assert.match(row, STATE,
        `"${area}" has a row that states no condition — say fixed, believed, partly or unverified`);
    }
  });

  test('the surveyed list is not empty', () => {
    // Without this the loop above is vacuously green the moment somebody empties the list.
    assert.ok(SURVEYED.length >= 5);
  });
});

describe('AC6 — what repo-init writes runs where it lands', () => {
  test('the shipped CI checker runs under a CommonJS host package', (t) => {
    // This toolkit is ESM. An adopting repo may be CJS, and `repo-init` writes
    // `templates/ci/knowledge-check.mjs` into it. A `.mjs` file is ESM regardless of the host's
    // `type`, which is exactly why the template carries that extension — this asserts it, rather
    // than leaving it as a thing somebody remembered.
    const dir = mkdtempSync(join(tmpdir(), 'mlspecs-cjs-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));

    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'host', type: 'commonjs' }));
    mkdirSync(join(dir, '.github', 'scripts'), { recursive: true });
    const checker = join(dir, '.github', 'scripts', 'knowledge-check.mjs');
    writeFileSync(checker, readFileSync(join(ROOT, 'ml-specs', 'templates', 'ci', 'knowledge-check.mjs'), 'utf8'));

    const r = spawnSync(process.execPath, [checker], { cwd: dir, encoding: 'utf8' });
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, /Cannot use import statement|ERR_REQUIRE_ESM/,
      'the shipped checker will not load in a CommonJS repository');
  });

  test('and it ships as .mjs, which is what makes that true', () => {
    assert.ok(existsSync(join(ROOT, 'ml-specs', 'templates', 'ci', 'knowledge-check.mjs')),
      'the checker changed extension — a .js file in a CJS repo would be parsed as CommonJS');
  });
});
