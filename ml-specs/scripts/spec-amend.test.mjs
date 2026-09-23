// Acknowledging that a spec moved after its gate passed — deliberately, with a reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRecord, digestIntact } from './lib/evidence.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const AMEND = join(DIR, 'spec-amend.mjs');
const ADVANCE = join(DIR, 'spec-advance.mjs');
const EVIDENCE = join(DIR, 'spec-evidence.mjs');
const REASON = 'reworded AC1 for clarity; the assertion it names is unchanged';

const SPEC = (ac) => `# Spec: alpha

| | |
|---|---|
| **Status** | Implemented |
| **Branch** | feat/a |

## 5. Acceptance criteria
- [x] **AC1** — ${ac}

## 6. Test plan
| AC | Test file | What it proves |
|---|---|---|
| AC1 | \`test/a.test.mjs\` | it validates |

## 8. Open questions
None blocking.
`;

function repo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'mlspecs-amend-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  mkdirSync(join(dir, 'specs'), { recursive: true });
  mkdirSync(join(dir, 'test'), { recursive: true });
  writeFileSync(join(dir, 'specs', '0001-a.md'), SPEC('it validates the token before use.'));
  writeFileSync(join(dir, 'test', 'a.test.mjs'), '// proves AC1\n');
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Ada');
  git('config', 'user.email', 'ada@x');
  git('add', '-A');
  git('commit', '-qm', 'base');
  execFileSync(process.execPath, [ADVANCE, 'specs/0001-a.md', '--root', dir, '--to', 'Verified',
    '--attest', 'I ran the suite green and read every criterion'], { cwd: dir, encoding: 'utf8' });
  return dir;
}

// Only the criterion text. Re-rendering the whole template would reset the Status cell that
// spec-advance just wrote, and the amendment would then be looked for under the wrong record —
// which looked exactly like the feature being broken.
const reword = (dir, to) => {
  const f = join(dir, 'specs', '0001-a.md');
  writeFileSync(f, readFileSync(f, 'utf8').replace(/- \[x\] \*\*AC1\*\* — .*/, `- [x] **AC1** — ${to}`));
};
const amend = (dir, ...args) => {
  const r = spawnSync(process.execPath, [AMEND, 'specs/0001-a.md', '--root', dir, ...args], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};
const evidence = (dir) => {
  const r = spawnSync(process.execPath, [EVIDENCE, '--root', dir], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

test('SENSOR: a deliberate reword can be acknowledged, and the record stands again', (t) => {
  const dir = repo(t);
  reword(dir, 'it rejects a token that fails validation.');
  assert.equal(evidence(dir).code, 1, 'the reword should have been reported');

  // Before this existed, `amended` had no exit but re-running the whole gate — re-attesting the
  // MANUAL gates included — for a record that was never wrong. A rule with no affordance for the
  // legitimate case is one people learn to ignore, and then they ignore the real ones too.
  const r = amend(dir, '--because', REASON);
  assert.equal(r.code, 0, r.out);
  assert.equal(evidence(dir).code, 0, 'the record still reads as failing after acknowledgement');
});

test('the previous contract digest is kept — an acknowledgement is a note, not an erasure', (t) => {
  const dir = repo(t);
  const before = readRecord(dir, 'specs/0001-a.md', 'Verified').contract.digest;
  reword(dir, 'it rejects a token that fails validation.');
  amend(dir, '--because', REASON);

  const rec = readRecord(dir, 'specs/0001-a.md', 'Verified');
  assert.equal(rec.amendments.length, 1);
  assert.equal(rec.amendments[0].from, before, 'the digest it moved FROM is gone');
  assert.equal(rec.amendments[0].to, rec.contract.digest);
  assert.equal(rec.amendments[0].because, REASON);
  assert.match(rec.amendments[0].by, /ada@x/, 'who acknowledged comes from git, not a flag');
  assert.ok(rec.amendments[0].changes.length, 'what changed is recorded, not just that something did');
});

test('the acknowledgement is inside the digest — the reason cannot be rewritten after', (t) => {
  const dir = repo(t);
  reword(dir, 'it rejects a token that fails validation.');
  amend(dir, '--because', REASON);

  // The one field explaining a re-baseline must not be the one field anybody can edit afterwards.
  const rec = readRecord(dir, 'specs/0001-a.md', 'Verified');
  assert.equal(digestIntact(rec), true);
  rec.amendments[0].because = 'a reason nobody gave';
  assert.equal(digestIntact(rec), false, 'the reason was outside the digest');
});

test('SENSOR: a one-word acknowledgement is a checkbox, and is refused', (t) => {
  const dir = repo(t);
  reword(dir, 'it rejects a token that fails validation.');
  const r = amend(dir, '--because', 'ok');
  assert.equal(r.code, 1);
  assert.match(r.out, /an amendment states why/);
  assert.equal(evidence(dir).code, 1, 'the record was cleared by a refused acknowledgement');
});

test('SENSOR: stale is about the CODE moving, and cannot be acknowledged away', (t) => {
  const dir = repo(t);
  rmSync(join(dir, 'test', 'a.test.mjs'));
  const r = amend(dir, '--because', 'the test file was deleted on purpose');
  // Otherwise this becomes a way to wave away a deleted test, which is the opposite of the job.
  assert.equal(r.code, 1);
  assert.match(r.out, /reads stale, not amended/);
  assert.match(r.out, /Re-run the gate/);
});

test('an unchanged spec has nothing to acknowledge', (t) => {
  const dir = repo(t);
  const r = amend(dir, '--because', 'acknowledging something that did not happen');
  assert.equal(r.code, 1);
  assert.match(r.out, /reads fresh, not amended/);
});

test('a record that does not exist is could-not-run, not a refusal', (t) => {
  const dir = repo(t);
  const r = amend(dir, '--to', 'Archived', '--because', 'acknowledging something absent');
  assert.equal(r.code, 2, 'exit 1 would read as "I looked and it is wrong"');
});
