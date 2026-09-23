// Check 15 — `ml-specs/command-contracts.json`, its shape and its join to the command files.
//
// The check is deliberately narrow, and the narrowness is the contract rather than a gap in it:
// it verifies SHAPE (non-empty arrays of non-empty strings) and THE JOIN (every entry names a
// command that exists), and nothing about whether a listed condition matches anything real. So
// these tests assert the boundary in both directions — what it catches, and what it must keep
// letting through.
//
// The fixture harness is the one `command-namespace.test.mjs:54-87` established: copy the real
// validator into a `mkdtempSync` tree with command stubs and run it there. Reusing it rather than
// inventing a second harness means check 15 is exercised by the same machinery as check 12, and a
// change to how the validator is invoked breaks both at once instead of leaving one quietly stale.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)));  // ml-specs/
const ROOT = dirname(PLUGIN);                                     // repo root
const VALIDATOR = join(ROOT, 'scripts', 'validate-plugin.mjs');
const VALIDATOR_LIB = join('ml-specs', 'scripts', 'lib', 'file-identity.mjs');
const CONTRACTS = join('ml-specs', 'command-contracts.json');

const FIXTURE_COMMANDS = ['spec', 'spec-review', 'spec-build', 'spec-verify', 'spec-advance',
  'code', 'pr'];

/** The validator, run over a throwaway tree holding `contracts` and nothing else unusual. */
function runWith(contracts, commands = FIXTURE_COMMANDS) {
  const dir = mkdtempSync(join(tmpdir(), 'ml-specs-cc-'));
  try {
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    mkdirSync(join(dir, 'ml-specs', 'commands'), { recursive: true });
    copyFileSync(VALIDATOR, join(dir, 'scripts', 'validate-plugin.mjs'));
    // The validator's `lib/` closure, whole. It was one file; spec 0051 made it three
    // (`prompt-shape.mjs` → `text.mjs`), and a per-file list breaks every harness the next time it
    // grows. Copying the directory costs nothing and cannot rot.
    mkdirSync(dirname(join(dir, VALIDATOR_LIB)), { recursive: true });
    for (const f of readdirSync(join(ROOT, dirname(VALIDATOR_LIB)))) {
      if (f.endsWith('.mjs') && !f.endsWith('.test.mjs')) {
        copyFileSync(join(ROOT, dirname(VALIDATOR_LIB), f), join(dir, dirname(VALIDATOR_LIB), f));
      }
    }
    for (const name of commands) {
      writeFileSync(join(dir, 'ml-specs', 'commands', `${name}.md`),
        `---\ndescription: fixture\nargument-hint: <arg>\n---\n\nFixture body. Delegates to no agent on purpose; next: /ml-specs:${name}\n`);
    }
    if (contracts !== undefined) {
      writeFileSync(join(dir, CONTRACTS),
        typeof contracts === 'string' ? contracts : JSON.stringify(contracts, null, 2));
    }

    try {
      return { code: 0, out: execFileSync('node', [join(dir, 'scripts', 'validate-plugin.mjs')],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (e) {
      return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Diagnostics check 15 produced, split by severity.
 *
 * The exit code is NOT what these tests assert on. A minimal fixture tree trips other checks —
 * absent manifests, missing `argument-hint` — so it exits 1 whatever check 15 decides, and an
 * `assert.equal(code, 1)` here would pass with the check deleted. Severity is the honest signal:
 * an `error` line is what makes the real validator exit 1, and `command-namespace.test.mjs`
 * narrows to its own check's lines for the same reason.
 */
function contracts(out) {
  const lines = out.split('\n').filter((l) => l.includes('command-contracts.json'));
  return {
    all: lines.map((l) => l.trim()),
    errors: lines.filter((l) => l.trimStart().startsWith('error')).map((l) => l.trim()),
    warnings: lines.filter((l) => l.trimStart().startsWith('warning')).map((l) => l.trim()),
  };
}

const VALID = { blockingConditions: ['spec-gap'], produces: ['code-change'] };

describe('AC3 — the shipped file', () => {
  test("holds an entry for spec-build.md with both fields non-empty", () => {
    const json = JSON.parse(readFileSync(join(ROOT, CONTRACTS), 'utf8'));
    const entry = json['spec-build.md'];
    assert.ok(entry, 'command-contracts.json has no entry for spec-build.md');
    for (const field of ['blockingConditions', 'produces']) {
      assert.ok(Array.isArray(entry[field]) && entry[field].length > 0,
        `${field} is not a non-empty array`);
      assert.ok(entry[field].every((s) => typeof s === 'string' && s.trim()),
        `${field} holds something that is not a non-empty string`);
    }
  });

  test('the command that owns the entry is told to read it', () => {
    // A registry no command consults is a file, not a contract. §4.1 requires spec-build to honour
    // it on the day it lands rather than waiting for the autonomy-levels spec.
    const body = readFileSync(join(PLUGIN, 'commands', 'spec-build.md'), 'utf8');
    assert.match(body, /command-contracts\.json/);
    assert.match(body, /\$\{CLAUDE_PLUGIN_ROOT\}\/command-contracts\.json/,
      'the path is not resolved through ${CLAUDE_PLUGIN_ROOT}');
    assert.match(body.replace(/\s+/g, ' '), /blockingConditions/);
  });
});

describe('AC4 — absence is not a finding', () => {
  test('a command with no entry produces neither an error nor a warning', () => {
    // The direction that matters most. Warning here would push 22 placeholder entries into the
    // file to silence it, and a file of placeholders records nothing.
    assert.deepEqual(contracts(runWith({ 'spec-build.md': VALID }).out).all, []);
  });

  test('no contracts file at all is not a finding either', () => {
    assert.deepEqual(contracts(runWith(undefined).out).all, []);
  });

  test('a `_`-prefixed key is a note to the reader, not an entry', () => {
    // JSON has no comments, so the file explains itself in a `_README` key. Treating that as an
    // entry would make the file's own documentation a validation error.
    assert.deepEqual(contracts(runWith({ _README: ['why this file exists'], 'spec-build.md': VALID }).out).all, []);
  });
});

describe('AC5 — an entry naming a command that does not exist', () => {
  test('is an error — not a warning — naming the entry', () => {
    const { errors, warnings } = contracts(runWith({ 'spec-teleport.md': VALID }).out);
    assert.equal(warnings.length, 0, 'a dangling entry is an error, not a warning');
    assert.equal(errors.length, 1, `expected one error, got: ${errors.join(' | ')}`);
    assert.match(errors[0], /spec-teleport\.md/, 'the error does not name the offending entry');
  });

  test('a renamed command takes its conditions with it — which is the failure this catches', () => {
    // The concrete scenario: `spec-build.md` is renamed and the registry keeps the old key. Every
    // other check still reports the package well-formed, and the conditions now describe nothing.
    const { errors } = contracts(runWith({ 'spec-build.md': VALID }, FIXTURE_COMMANDS.filter((c) => c !== 'spec-build')).out);
    assert.match(errors.join(' '), /spec-build\.md/);
  });
});

describe('AC5b — a malformed entry', () => {
  for (const [label, blockingConditions] of [
    ['absent', undefined],
    ['empty', []],
    ['not an array', 'spec-gap'],
    ['an array of non-strings', [{ name: 'spec-gap' }]],
    ['an array holding an empty string', ['spec-gap', '']],
    ['an array holding whitespace', ['   ']],
  ]) {
    test(`is an error when blockingConditions is ${label}`, () => {
      const entry = { produces: ['code-change'] };
      if (blockingConditions !== undefined) entry.blockingConditions = blockingConditions;
      const { errors } = contracts(runWith({ 'spec-build.md': entry }).out);
      assert.ok(errors.length >= 1, 'no error was produced');
      assert.match(errors.join(' '), /spec-build\.md/);
      assert.match(errors.join(' '), /blockingConditions/);
    });
  }

  test('`produces` is held to the same shape', () => {
    const { errors } = contracts(runWith({ 'spec-build.md': { blockingConditions: ['spec-gap'], produces: [] } }).out);
    assert.match(errors.join(' '), /produces/);
  });

  test('an entry that is not an object is one diagnostic, not four', () => {
    // Reporting "blockingConditions is missing" and "produces is missing" about a string would be
    // two answers to a question nobody asked; the entry is the thing that is wrong.
    const { errors } = contracts(runWith({ 'spec-build.md': 'blocks on everything' }).out);
    assert.equal(errors.length, 1, errors.join(' | '));
    assert.match(errors[0], /not an object/);
  });

  test('a file that is not JSON is reported as such, not silently skipped', () => {
    assert.match(contracts(runWith('{ this is not json').out).errors.join(' '), /invalid JSON|unreadable/);
  });

  test('a top-level array is rejected — the file is keyed by command name', () => {
    assert.match(contracts(runWith([{ 'spec-build.md': VALID }]).out).errors.join(' '), /object keyed by command filename/);
  });
});

describe('the boundary the check deliberately does not cross', () => {
  test('a blockingCondition matching nothing is NOT a validation error', () => {
    // Stated in §4.1 and inherited from SAF, whose own checker verifies presence and never content:
    // "runtime evidence validation is the invoking agent's responsibility". If this ever starts
    // failing, someone has taught the validator to judge meaning, and the file's whole cost/benefit
    // argument — cheap because it checks shape — has changed.
    assert.deepEqual(contracts(runWith({ 'spec-build.md': { blockingConditions: ['no-such-condition-anywhere'], produces: ['nothing-real'] } }).out).all, []);
  });

  test('the file is plugin-only and stays out of the published package', () => {
    // `files[]` is a disclosure boundary per docs/PATTERNS.md, not a packaging detail, and the MCP
    // server has no use for this file. Widening it to carry the registry would be the easy wrong fix.
    const pkg = JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8'));
    assert.ok(!(pkg.files ?? []).some((f) => f.includes('command-contracts')),
      "package.json's files[] was widened to publish command-contracts.json");
  });
});
