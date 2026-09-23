// Spec 0062 AC3 — one splitter, and no parser quietly doing its own.
//
// The bug this guards is not "the file has odd line endings". It is a `Status` cell that reads
// `Approved\r` and matches no lifecycle value, and a §6 row naming a file that exists being
// reported missing because its path carries a trailing `\r`. Both present as a broken toolkit,
// which is what makes them expensive: the person hitting one has no reason to suspect the cause.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lines, normalise, unCr } from './text.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));   // ml-specs/scripts/lib/
const SCRIPTS = dirname(HERE);

/**
 * The files that parse a MARKDOWN ARTIFACT — a spec, a doc, a plan — written by somebody else's
 * editor. Command output is a different thing: `git`, `sh` and HTTP produce `\n` whatever the
 * checkout's line endings are, and splitting those on `\n` is correct. Those sites carry a
 * `command output:` comment, and this list is how the distinction stays reviewable instead of
 * living in whoever last touched a parser.
 */
const PARSERS = [
  'lib/specs.mjs', 'lib/knowledge.mjs', 'lib/nfr.mjs', 'lib/estate.mjs',
  'spec-gate.mjs', 'spec-advance.mjs', 'fix-specs.mjs',
];

describe('AC3 — no Markdown parser splits on a bare newline', () => {
  for (const rel of PARSERS) {
    test(`${rel}`, () => {
      const src = readFileSync(join(SCRIPTS, rel), 'utf8');
      const offenders = lines(src)
        .map((l, i) => ({ l, n: i + 1 }))
        .filter(({ l }) => /\.split\(['"]\\n['"]\)/.test(l));

      const all = lines(src);
      for (const { l, n } of offenders) {
        // A split is allowed only where a nearby comment says the input is command output. A
        // window rather than the line directly above, because these splits sit mid-expression —
        // the justification belongs above the statement, not wedged into it.
        const window = all.slice(Math.max(0, n - 6), n).join('\n');
        assert.match(window, /command output:/,
          `${rel}:${n} splits on a bare \\n with no "command output:" justification within 5 lines`
          + ` — ${l.trim()}`);
      }
    });
  }

  test('the parser list is not empty and every file in it exists', () => {
    // Without this the loop above is vacuously green if the list is emptied or a path rots.
    assert.ok(PARSERS.length >= 7);
    for (const rel of PARSERS) {
      assert.doesNotThrow(() => readFileSync(join(SCRIPTS, rel), 'utf8'), `${rel} has moved`);
    }
  });

  test('and every parser imports the helper', () => {
    for (const rel of PARSERS) {
      const src = readFileSync(join(SCRIPTS, rel), 'utf8');
      assert.match(src, /from '\.?\.?\/?(lib\/)?text\.mjs'/,
        `${rel} does not import the line splitter`);
    }
  });
});

describe('the splitter itself', () => {
  test('LF, CRLF and a mixed file all give the same lines', () => {
    const want = ['# Spec', '', '| **Status** |Approved|', 'done'];
    assert.deepEqual(lines('# Spec\n\n| **Status** |Approved|\ndone'), want);
    assert.deepEqual(lines('# Spec\r\n\r\n| **Status** |Approved|\r\ndone'), want);
    assert.deepEqual(lines('# Spec\r\n\n| **Status** |Approved|\r\ndone'), want,
      'a file edited by two editors is the normal case, not an exotic one');
  });

  test('a trailing CR on the last line is stripped', () => {
    // The one that bites: a §6 row's test path is the last thing on its line.
    assert.deepEqual(lines('a\r\nb\r'), ['a', 'b']);
  });

  test('a lone \\r inside a line is left alone', () => {
    // Deliberately not treated as a separator: no editor in use produces classic-Mac endings, and
    // treating it as one would split a line that legitimately contains a carriage return.
    assert.deepEqual(lines('a\rb'), ['a\rb']);
  });

  test('empty, null and undefined do not throw', () => {
    for (const v of ['', null, undefined]) assert.doesNotThrow(() => lines(v));
    assert.deepEqual(lines(''), ['']);
  });

  test('normalise round-trips a CRLF document to LF', () => {
    assert.equal(normalise('a\r\nb\r\n'), 'a\nb\n');
    assert.equal(normalise('a\nb\n'), 'a\nb\n');
  });

  test('unCr strips a trailing CR without eating indentation', () => {
    // `.trim()` is the wrong tool here — a Markdown list item's leading spaces are load-bearing.
    assert.equal(unCr('  - item\r'), '  - item');
    assert.equal(unCr('  - item'), '  - item');
  });
});
