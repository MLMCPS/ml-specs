// The reader. A verdict nobody can see is worth what no verdict is worth.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const READ = join(DIR, 'spec-evidence.mjs');
const ADVANCE = join(DIR, 'spec-advance.mjs');
const ATTEST = 'I ran the suite green and read every criterion against the diff';

const SPEC = (id, test_) => `# Spec: thing ${id}

| | |
|---|---|
| **Status** | Implemented |
| **Branch** | feat/${id} |
| **Touches** | src/, test/ |

## 5. Acceptance criteria
- [x] **AC1** — it validates the token.

## 6. Test plan
| AC | Test file | What it proves |
|---|---|---|
| AC1 | \`${test_}\` | it validates |

## 8. Open questions
None blocking.
`;

function repo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'mlspecs-read-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  for (const d of ['specs', 'test', 'src']) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, 'specs', '0001-a.md'), SPEC('0001', 'test/a.test.mjs'));
  writeFileSync(join(dir, 'test', 'a.test.mjs'), '// proves AC1\n');
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 't');
  git('config', 'user.email', 't@t');
  git('add', '-A');
  git('commit', '-qm', 'base');
  return dir;
}

const read = (dir, ...args) => {
  const r = spawnSync(process.execPath, [READ, '--root', dir, ...args], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};
const gate = (dir, spec = 'specs/0001-a.md') =>
  spawnSync(process.execPath, [ADVANCE, spec, '--root', dir, '--to', 'Verified', '--attest', ATTEST], { cwd: dir, encoding: 'utf8' });

test('with no records it says so, and does not fail', (t) => {
  const dir = repo(t);
  const r = read(dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /no evidence records yet/);
});

test('SENSOR: a freshly gated record reads fresh — the reader agrees with the writer', (t) => {
  const dir = repo(t);
  assert.equal(gate(dir).status, 0);

  // This failed when it was written. `claimed` was only populated when the tests-exist gate ran,
  // which depends on the TARGET — so a reader asking about a Verified record gated toward
  // Archived, found no such block, and was handed an empty list. Against a record that named a
  // test, that reads as "§6 no longer names it": an amendment nobody made, on every record, the
  // moment it was written. §6's contents are a property of the document, not of the transition.
  const r = read(dir);
  assert.equal(r.code, 0, `a record read as failing the moment it was written:\n${r.out}`);
  assert.match(r.out, /fresh/);
});

test('SENSOR: each failing verdict surfaces, with its own remedy', (t) => {
  const dir = repo(t);
  gate(dir);

  rmSync(join(dir, 'test', 'a.test.mjs'));
  const stale = read(dir);
  assert.equal(stale.code, 1, 'a stale record exited 0');
  assert.match(stale.out, /stale/);
  assert.match(stale.out, /Re-run the gate/, 'stale has a remedy that fits stale');

  // An amendment is a different problem and needs a different instruction: re-running a gate is
  // not what somebody needs when the question is whether the spec should have moved at all.
  writeFileSync(join(dir, 'test', 'a.test.mjs'), '// proves AC1\n');
  const spec = join(dir, 'specs', '0001-a.md');
  writeFileSync(spec, readFileSync(spec, 'utf8').replace('it validates the token.', 'it handles tokens.'));
  const amended = read(dir);
  assert.equal(amended.code, 1);
  assert.match(amended.out, /amended/);
  assert.match(amended.out, /whether that was intended/);
});

test('SENSOR: a hand-edited record is reported, not quietly believed', (t) => {
  const dir = repo(t);
  gate(dir);
  const path = join(dir, '.ml-specs', 'evidence', '0001-a-verified.json');
  const rec = JSON.parse(readFileSync(path, 'utf8'));
  // The attestation, because it is the field with the most to gain from being rewritten: it is
  // the one thing in the record a person signed. (A first version of this set a gate verdict to
  // the value it already held — a no-op edit, which correctly read as intact and proved nothing.)
  rec.attested.text = 'somebody else checked all of this, honestly';
  writeFileSync(path, JSON.stringify(rec, null, 2));

  const r = read(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /unsound/);
  assert.match(r.out, /Do not edit records/);
});

test('--failing shows only what no longer stands', (t) => {
  const dir = repo(t);
  gate(dir);
  // Was `/every record still stands/`. That sentence counted superseded records as confirmation
  // when they are records deliberately NOT judged, and supersession rests on a digest the
  // silencer can recompute — so it asserted more than the layer can back. The honest claim is
  // about what was judged.
  assert.match(read(dir, '--failing').out, /no record is failing/);
  rmSync(join(dir, 'test', 'a.test.mjs'));
  const r = read(dir, '--failing');
  assert.equal(r.code, 1);
  assert.match(r.out, /specs\/0001-a\.md/);
});

test('--json carries the same verdicts and the same exit code', (t) => {
  const dir = repo(t);
  gate(dir);
  const ok = read(dir, '--json');
  assert.equal(ok.code, 0);
  const j = JSON.parse(ok.out);
  assert.equal(j.total, 1);
  assert.equal(j.failing, 0);
  assert.equal(j.records[0].verdict, 'fresh');

  rmSync(join(dir, 'test', 'a.test.mjs'));
  const bad = read(dir, '--json');
  assert.equal(bad.code, 1);
  assert.equal(JSON.parse(bad.out).failing, 1);
});

test('a record whose spec has been archived is not accused', (t) => {
  const dir = repo(t);
  gate(dir);
  // `archive` moves a spec out from under its own record on purpose, so a missing document means
  // the check cannot run — not that something is wrong.
  rmSync(join(dir, 'specs', '0001-a.md'));
  const r = read(dir);
  assert.equal(r.code, 0, `an archived spec's record was reported as failing:\n${r.out}`);
});
