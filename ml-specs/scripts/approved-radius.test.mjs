// Spec 0024 — an approval's radius is its contract, not the branch underneath it.
//
// `spec-gate.mjs` recorded the branch diff on every transition, so a `Draft → Approved` record
// fingerprinted files no code had touched yet and read `stale` the moment implementation began.
// Measured before the fix: `0022 → Approved` held 46 files, `0023 → Approved` held 48, and both
// went stale for doing exactly what was supposed to happen next.
//
// The fix is one conditional, and the DANGEROUS version of it is one line shorter — deleting the
// `changed` line entirely satisfies the headline criterion and silently empties the radius for
// `Implemented` and `Verified` too. AC2 exists for that, and it is the assertion to keep if this
// file is ever trimmed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GATE = join(dirname(fileURLToPath(import.meta.url)), 'spec-gate.mjs');

const SPEC = (status) => `# Spec: a thing

| | |
|---|---|
| **Status** | ${status} |
| **Branch** | feat/thing |
| **Author** | Ada |

## 5. Acceptance criteria
- [x] **AC1** — it validates the token.

## 6. Test plan
| AC | Test file | What it proves |
|---|---|---|
| AC1 | \`test/thing.test.mjs\` | it validates |

## 8. Open questions
None blocking.
`;

/**
 * A repo whose branch genuinely differs from its base, so `changedFiles()` has something real to
 * return. Without the second commit the radius would be empty for every target and every assertion
 * below would pass vacuously.
 */
function repo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'mlspecs-radius-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });

  mkdirSync(join(dir, 'specs'), { recursive: true });
  mkdirSync(join(dir, 'test'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'test', 'thing.test.mjs'), '// proves AC1\n');
  writeFileSync(join(dir, 'src', 'thing.mjs'), 'export const f = 1;\n');
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Ada Lovelace');
  git('config', 'user.email', 'ada@example.com');
  git('add', '-A');
  git('commit', '-qm', 'base');

  // The branch, with real work on it — this is what an Approved record was wrongly fingerprinting.
  git('checkout', '-q', '-b', 'feat/thing');
  writeFileSync(join(dir, 'specs', '0001-thing.md'), SPEC('Draft'));
  writeFileSync(join(dir, 'src', 'thing.mjs'), 'export const f = 2;\n');
  writeFileSync(join(dir, 'src', 'other.mjs'), 'export const g = 3;\n');
  git('add', '-A');
  git('commit', '-qm', 'work');
  return dir;
}

const gate = (dir, to) => {
  const args = [GATE, 'specs/0001-thing.md', '--root', dir, '--json', '--to', to];
  try {
    return JSON.parse(execFileSync(process.execPath, args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch (e) {
    // A gate with a FAIL exits non-zero; its stdout is still the answer we are asking for.
    return JSON.parse(e.stdout || '{}');
  }
};

describe('spec 0024 — the Approved radius', () => {
  test('AC1: an Approved gate records no files', (t) => {
    const dir = repo(t);
    assert.deepEqual(gate(dir, 'Approved').changed, [],
      'an Approved record still fingerprints the branch — it will go stale the moment work starts');
  });

  test('AC2: Implemented and Verified still record the branch diff', (t) => {
    // THE REGRESSION GUARD. Deleting the `changed` line instead of conditioning it passes AC1 and
    // turns the freshness check off for the two transitions that are actually about code. That
    // failure is silent: nothing goes red, records simply stop being able to say `stale`.
    const dir = repo(t);
    for (const to of ['Implemented', 'Verified']) {
      const changed = gate(dir, to).changed;
      assert.ok(Array.isArray(changed) && changed.length > 0,
        `the ${to} gate recorded ${changed?.length ?? 'no'} file(s); its radius is the branch diff and must stay`);
      assert.ok(changed.includes('src/thing.mjs'),
        `the ${to} radius does not name the file the branch actually changed: ${changed.join(', ')}`);
    }
  });

  test('AC1: the WHOLE radius is empty for Approved, tests included', (t) => {
    // AC3's no-stale promise rests on `tests` being empty too, not just `changed`. Today that holds
    // because `resolvedTests` is only populated inside the Implemented/Verified branch
    // (`spec-gate.mjs:324,345`) — an implementation detail of a different gate, not something this
    // spec's change controls. If §6 resolution ever became unconditional, Approved records would
    // carry test hashes, go stale the moment the named test file is written, and nothing else here
    // would go red.
    const dir = repo(t);
    const approved = gate(dir, 'Approved');
    assert.deepEqual(approved.tests, [], 'an Approved gate resolved §6 tests into its radius');
    assert.deepEqual(approved.changed, []);

    // And the same tree DOES resolve them one transition later, so the assertion above is about
    // the target rather than about a fixture with no test plan.
    assert.ok(gate(dir, 'Implemented').tests.length > 0,
      'the fixture resolves no tests at all — the assertion above proves nothing');
  });

  test('AC1/AC2: the two targets genuinely disagree, on one tree', (t) => {
    // Stated as its own case because AC1 and AC2 passing separately is also what a gate that
    // ignores `--to` entirely would look like if the fixture happened to be empty.
    const dir = repo(t);
    assert.equal(gate(dir, 'Approved').changed.length, 0);
    assert.ok(gate(dir, 'Implemented').changed.length > 0);
  });
});
