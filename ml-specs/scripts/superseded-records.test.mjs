// Spec 0025 — a record for a status you have moved past is history, not drift.
//
// Two halves, both driven through the real CLIs over a throwaway git repo: `superseded` as
// `spec-evidence.mjs` reports it, and `--re-record` as `spec-advance.mjs` and `spec-gate.mjs`
// jointly implement it. Driven end to end rather than unit-tested because the refusal lives in
// one script and the flag is typed at the other — a seam a unit test cannot cross.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const ADVANCE = join(DIR, 'spec-advance.mjs');
const GATE = join(DIR, 'spec-gate.mjs');
const EVIDENCE = join(DIR, 'spec-evidence.mjs');
const DOCTOR = join(DIR, '..', 'commands', 'repo-doctor.md');
const REAL = 'I ran the suite green and read every criterion against the diff';

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

function repo(t, status = 'Approved') {
  const dir = mkdtempSync(join(tmpdir(), 'mlspecs-sup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  mkdirSync(join(dir, 'specs'), { recursive: true });
  mkdirSync(join(dir, 'test'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'specs', '0001-thing.md'), SPEC(status));
  writeFileSync(join(dir, 'test', 'thing.test.mjs'), '// proves AC1\n');
  writeFileSync(join(dir, 'src', 'thing.mjs'), 'export const f = 1;\n');
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Ada Lovelace');
  git('config', 'user.email', 'ada@example.com');
  git('add', '-A');
  git('commit', '-qm', 'base');
  return dir;
}

const run = (dir, ...args) => {
  const r = spawnSync(process.execPath, [ADVANCE, 'specs/0001-thing.md', '--root', dir, ...args], {
    cwd: dir, encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};
const evidence = (dir, ...args) => {
  const r = spawnSync(process.execPath, [EVIDENCE, '--root', dir, ...args], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};
const statusOf = (dir) =>
  /\|\s*\*\*Status\*\*\s*\|\s*([A-Za-z]+)/.exec(readFileSync(join(dir, 'specs', '0001-thing.md'), 'utf8'))[1];
const recordPath = (dir, to) => join(dir, '.ml-specs', 'evidence', `0001-thing-${to.toLowerCase()}.json`);

/** The review finding being acted on: the test the gate read now asserts more than it did. */
const editTheTest = (dir) =>
  writeFileSync(join(dir, 'test', 'thing.test.mjs'), '// proves AC1, and now AC16 too\n');

// ── the verdict ─────────────────────────────────────────────────────────────────────────────

test('AC2: a superseded record is not counted as failing and does not exit non-zero', (t) => {
  const dir = repo(t);
  assert.equal(run(dir, '--attest', REAL).code, 0);       // Approved → Implemented

  // Exactly the sequence this spec exists for: the review edits a file the Implemented gate read,
  // then the spec is verified against the tree that edit produced.
  editTheTest(dir);
  assert.equal(run(dir, '--to', 'Verified', '--attest', REAL).code, 0);

  const r = evidence(dir, '--json');
  const j = JSON.parse(r.out);
  const impl = j.records.find((x) => x.to === 'Implemented');
  assert.equal(impl.verdict, 'superseded', `the Implemented record read ${impl.verdict}:\n${r.out}`);
  assert.equal(impl.failing, false, 'a status the spec has moved past is being counted as drift');
  assert.equal(j.failing, 0, `superseded counted toward the failing total:\n${r.out}`);
  assert.equal(r.code, 0, `spec-evidence exited non-zero over a superseded record:\n${r.out}`);
  assert.equal(j.records.find((x) => x.to === 'Verified').verdict, 'fresh');
});

test('AC4: SENSOR — tampering with a superseded record still reads unsound, and still fails', (t) => {
  const dir = repo(t);
  assert.equal(run(dir, '--attest', REAL).code, 0);
  editTheTest(dir);
  assert.equal(run(dir, '--to', 'Verified', '--attest', REAL).code, 0);

  // The one way this change can be wrong: advancing a spec must never launder a doctored record.
  const path = recordPath(dir, 'Implemented');
  const doctored = JSON.parse(readFileSync(path, 'utf8'));
  doctored.attested.text = 'somebody else checked all of this, honestly';
  writeFileSync(path, JSON.stringify(doctored, null, 2));

  const r = evidence(dir, '--json');
  const impl = JSON.parse(r.out).records.find((x) => x.to === 'Implemented');
  assert.equal(impl.verdict, 'unsound', `a hand-edited record read ${impl.verdict} — advancing buried it`);
  assert.equal(impl.failing, true);
  assert.equal(r.code, 1, 'a doctored record stopped failing the moment its spec moved on');
});

// ── --re-record ─────────────────────────────────────────────────────────────────────────────

test('AC5: --re-record refreshes the record for the status the spec holds, and moves no Status', (t) => {
  const dir = repo(t);
  assert.equal(run(dir, '--attest', REAL).code, 0);
  const first = readFileSync(recordPath(dir, 'Implemented'), 'utf8');

  // Acting on a review finding turns the record stale for having done the right thing.
  editTheTest(dir);
  assert.equal(evidence(dir).code, 1, 'the fixture no longer reproduces the stale record');

  const r = run(dir, '--re-record', '--attest', REAL);
  assert.equal(r.code, 0, `--re-record was refused:\n${r.out}`);
  assert.equal(statusOf(dir), 'Implemented', 'a re-record moved the Status cell');

  const after = readFileSync(recordPath(dir, 'Implemented'), 'utf8');
  assert.notEqual(after, first, 'the record was not rewritten against the current tree');
  assert.equal(JSON.parse(after).to, 'Implemented');
  const e = evidence(dir);
  assert.equal(e.code, 0, `the refreshed record still does not describe this tree:\n${e.out}`);
  assert.match(e.out, /fresh/);
});

test('AC6: --re-record refuses a status the spec does not hold — history is not rewritten', (t) => {
  const dir = repo(t);
  assert.equal(run(dir, '--attest', REAL).code, 0);       // now Implemented

  const r = run(dir, '--re-record', '--to', 'Verified', '--attest', REAL);
  assert.equal(r.code, 1, `--re-record wrote a record for a status the spec does not hold:\n${r.out}`);
  assert.match(r.out, /holds Implemented, not Verified/);
  assert.equal(statusOf(dir), 'Implemented');
  assert.equal(existsSync(recordPath(dir, 'Verified')), false, 'a Verified record was written anyway');
});

test('AC7: SENSOR — --re-record on a failing gate refuses and writes nothing. Not a rubber stamp', (t) => {
  const dir = repo(t);
  assert.equal(run(dir, '--attest', REAL).code, 0);
  const before = readFileSync(recordPath(dir, 'Implemented'), 'utf8');

  // The gate that a re-record must still have to pass. Relaxing `already <status>` must not
  // relax the gates for that status, or --re-record becomes a way to make a red record green.
  rmSync(join(dir, 'test', 'thing.test.mjs'));
  const r = run(dir, '--re-record', '--attest', REAL);
  assert.equal(r.code, 1, `a re-record passed with the test it rests on deleted:\n${r.out}`);
  assert.match(r.out, /gate\(s\) failed — Status not written/);
  assert.equal(readFileSync(recordPath(dir, 'Implemented'), 'utf8'), before,
    'a refused re-record still rewrote the record');
});

test('AC7: an unchanged tree re-records to the same verdict — the flag re-gates, it does not excuse', (t) => {
  const dir = repo(t);
  assert.equal(run(dir, '--attest', REAL).code, 0);
  const first = JSON.parse(readFileSync(recordPath(dir, 'Implemented'), 'utf8'));

  const r = run(dir, '--re-record', '--attest', REAL);
  assert.equal(r.code, 0, r.out);
  const second = JSON.parse(readFileSync(recordPath(dir, 'Implemented'), 'utf8'));
  assert.deepEqual(second.tests, first.tests, 'the re-gate read a different radius than the gate did');
  assert.deepEqual(second.gates, first.gates, 'the re-gate reached different verdicts on an unchanged tree');
});

// ── the printed remedy ──────────────────────────────────────────────────────────────────────

test('AC8: repo-doctor names an action that exists, and that action works', (t) => {
  const doc = readFileSync(DOCTOR, 'utf8');
  const stale = doc.split('\n').find((l) => /^\s*-\s*\*\*stale\*\*/.test(l));
  assert.ok(stale, 'repo-doctor.md no longer lists a `stale` remedy');

  // The whole of AC8: the remedy used to say "Re-run the gate for that spec", which the gate
  // refuses with `already <status>`. An instruction naming an action that does not exist is worse
  // than none — so take the flag FROM the doc and prove the CLI accepts it.
  const bullet = doc.slice(doc.indexOf(stale), doc.indexOf('- **amended**'));
  const flag = (bullet.match(/--[a-z][a-z-]+/g) ?? []).find((f) => f === '--re-record');
  assert.ok(flag, `the stale remedy names no runnable flag:\n${bullet}`);

  const dir = repo(t);
  assert.equal(run(dir, '--attest', REAL).code, 0);
  editTheTest(dir);
  const r = run(dir, flag, '--attest', REAL);
  assert.equal(r.code, 0, `repo-doctor tells people to run \`${flag}\`, and it fails:\n${r.out}`);
  assert.doesNotMatch(r.out, /already Implemented/);
});

test('AC5: a re-recorded record does not name the evidence directory, so it is not stale on arrival', (t) => {
  // Found by USING the feature, not by reading it. Records are tracked, so writing one puts it in
  // the branch diff — and every record fingerprinted `.ml-specs/`, which meant writing a record
  // made records stale, itself included. A real `--re-record` run produced a record whose only
  // complaint was the file it had just written, which re-recording can never fix.
  //
  // This fixture builds its own branch: the shared `repo()` above leaves everything on `main`, so
  // `changedFiles()` returns [] there and the assertion would pass having measured nothing.
  const dir = mkdtempSync(join(tmpdir(), 'mlspecs-radius-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  mkdirSync(join(dir, 'specs'), { recursive: true });
  mkdirSync(join(dir, 'test'), { recursive: true });
  mkdirSync(join(dir, '.ml-specs', 'evidence'), { recursive: true });
  writeFileSync(join(dir, 'test', 'thing.test.mjs'), '// proves AC1\n');
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Ada');
  git('config', 'user.email', 'a@b.c');
  git('add', '-A'); git('commit', '-qm', 'base');

  git('checkout', '-q', '-b', 'feat/thing');
  writeFileSync(join(dir, 'specs', '0001-thing.md'), SPEC('Implemented'));
  writeFileSync(join(dir, 'test', 'thing.test.mjs'), '// proves AC1, more\n');
  writeFileSync(join(dir, '.ml-specs', 'evidence', 'noise.json'), '{"spec":"specs/0001-thing.md"}\n');
  git('add', '-A'); git('commit', '-qm', 'work');

  let gate;
  const args = [GATE, 'specs/0001-thing.md', '--root', dir, '--json', '--to', 'Verified'];
  try {
    gate = JSON.parse(execFileSync(process.execPath, args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch (e) { gate = JSON.parse(e.stdout || '{}'); }

  const changed = gate.changed ?? [];
  assert.ok(changed.includes('test/thing.test.mjs'),
    `the fixture produced no real radius, so this asserts nothing: ${changed.join(', ')}`);
  assert.deepEqual(changed.filter((f) => f.startsWith('.ml-specs/')), [],
    `the radius names the evidence directory, so writing a record makes records stale: ${changed.join(', ')}`);
});
