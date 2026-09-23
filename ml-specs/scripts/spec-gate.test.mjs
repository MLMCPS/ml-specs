// The placeholder gate in spec-gate.mjs — spec 0017's approval exposed it.
//
// WHY THIS FILE EXISTS AT ALL
//
// `spec-gate.mjs` is one of the four *mechanical* invariants docs/PATTERNS.md lists — the half of
// every /ml-specs:spec-advance transition a script decides rather than a model — and it shipped
// with no test of its own. The gap surfaced the way gaps do: the placeholder scanner refused spec
// 0017 seventeen times over its own accurate documentation (`git diff <default>...<branch>`,
// `feat/<id>-<slug>`, a worked example of a bad `<TBD>` cell), because it matched angle brackets
// anywhere on a line including inside code.
//
// WHAT THIS FILE ASSERTS, AND WHY THE SECOND HALF MATTERS MOST
//
// Loosening a gate is easy to get wrong in the direction nobody notices: it still passes the thing
// you were trying to unblock, and quietly stops catching the thing it was built for. So every
// "should now pass" case below is paired with a "must still fail" case. If someone widens the strip
// further, the non-vacuity tests are what go red.
//
// The load-bearing fact behind the fix: **a real unfilled placeholder is never inside backticks.**
// Every one in specs/TEMPLATE.md is bare prose (`<short title>`, `<bullet>`, `<name>`), and
// TEMPLATE-BARE below pins that so the assumption cannot rot silently.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));      // ml-specs/scripts/
const GATE = join(HERE, 'spec-gate.mjs');
const REPO = dirname(dirname(HERE));                        // repo root

/** Run the gate over one spec body in a throwaway repo. Returns its stdout + exit code. */
function gate(body, { name = '0099-fixture.md' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'spec-gate-'));
  mkdirSync(join(root, 'specs'), { recursive: true });
  writeFileSync(join(root, 'specs', name), body, 'utf8');
  try {
    const stdout = execFileSync(
      process.execPath,
      [GATE, join('specs', name), '--to', 'Approved', '--root', root],
      { encoding: 'utf8', cwd: root },
    );
    return { stdout, code: 0 };
  } catch (e) {
    // exit 1 = a gate FAILed, which is an expected outcome here, not an error.
    return { stdout: `${e.stdout ?? ''}${e.stderr ?? ''}`, code: e.status };
  }
}

const header = (title) => `# Spec: ${title}

| | |
|---|---|
| **Ticket** | — (no tracker) |
| **Status** | Draft |
| **Date** | 2026-09-17 |

`;

/** Did the placeholders gate pass? Read from the gate's own rendered line, not inferred. */
const placeholdersPassed = (out) => /✓ PASS\s+placeholders/.test(out);
const placeholdersFailed = (out) => /✗ FAIL\s+placeholders/.test(out);

describe('spec-gate placeholders — angle brackets inside code are syntax, not blanks', () => {
  test('an inline code span carrying <default>...<branch> passes', () => {
    const { stdout } = gate(header('inline code') +
      'The set `git diff --name-only <default>...<branch>` will contain once built.\n');
    assert.ok(placeholdersPassed(stdout), `expected PASS, got:\n${stdout}`);
  });

  test('a naming template inside code passes', () => {
    const { stdout } = gate(header('naming template') +
      '- **Branch:** `feat/<id>-<slug>`, and the directory `../<repo-basename>-<id>`.\n');
    assert.ok(placeholdersPassed(stdout), `expected PASS, got:\n${stdout}`);
  });

  test('a fenced block is skipped entirely', () => {
    const { stdout } = gate(header('fenced') +
      '```\n| **Rigor** | light | standard | deep |\n<anything at all>\n```\n');
    assert.ok(placeholdersPassed(stdout), `expected PASS, got:\n${stdout}`);
  });

  test('a worked example of a bad cell passes — the spec is DESCRIBING a placeholder', () => {
    // 0017 §4.2 documents that `<TBD>` in a Touches cell poisons the row. Describing the token
    // must not be mistaken for leaving one behind.
    const { stdout } = gate(header('worked example') +
      'So `| **Touches** | a/b.mjs, <TBD> |` yields `[]` rather than a partial list.\n');
    assert.ok(placeholdersPassed(stdout), `expected PASS, got:\n${stdout}`);
  });
});

describe('spec-gate placeholders — NON-VACUITY: real blanks must still fail', () => {
  test('a bare prose placeholder still fails', () => {
    const { stdout, code } = gate(header('bare prose') + 'The service is <repo or service name>.\n');
    assert.ok(placeholdersFailed(stdout), `expected FAIL, got:\n${stdout}`);
    assert.equal(code, 1, 'a failed mechanical gate must exit 1');
  });

  test('a bare placeholder in a table cell still fails', () => {
    const { stdout } = gate(header('bare cell') + '| **Author** | <name> |\n');
    assert.ok(placeholdersFailed(stdout), `expected FAIL, got:\n${stdout}`);
  });

  test('code on the same line does not launder a bare placeholder elsewhere on it', () => {
    // The strip removes the code span, not the line. A blank outside the backticks must survive.
    const { stdout } = gate(header('mixed line') +
      'Run `git diff <default>...<branch>` against <repo or service name>.\n');
    assert.ok(placeholdersFailed(stdout), `expected FAIL, got:\n${stdout}`);
  });

  test('TEMPLATE-BARE — no real placeholder in specs/TEMPLATE.md is inside backticks', () => {
    // The fix rests entirely on this. If someone adds a backticked placeholder to the template,
    // the scanner would stop seeing it and this test is the only thing that would say so.
    const tpl = readFileSync(join(REPO, 'specs', 'TEMPLATE.md'), 'utf8');
    const inCode = [];
    for (const span of tpl.match(/`[^`\n]*`/g) ?? []) {
      for (const m of span.matchAll(/<([a-z][a-z0-9 _/-]{2,40})>/gi)) inCode.push(`${span} → <${m[1]}>`);
    }
    assert.deepEqual(inCode, [],
      'specs/TEMPLATE.md now has a placeholder inside a code span; the placeholder gate cannot see it');
  });

  test('the unfilled template itself fails the gate', () => {
    // The end-to-end statement of the whole point: an untouched TEMPLATE.md is not approvable.
    const tpl = readFileSync(join(REPO, 'specs', 'TEMPLATE.md'), 'utf8')
      .replace(/^\| \*\*Status\*\* \|.*$/m, '| **Status** | Draft |');
    const { stdout } = gate(tpl);
    assert.ok(placeholdersFailed(stdout), `an unfilled TEMPLATE.md must fail, got:\n${stdout}`);
  });
});
