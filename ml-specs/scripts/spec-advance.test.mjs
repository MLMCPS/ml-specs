// The script that writes a Status — and the refusals that are the point of it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshness, readRecord, STALE, FRESH } from './lib/evidence.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), 'spec-advance.mjs');
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

function repo(t, status = 'Implemented') {
  const dir = mkdtempSync(join(tmpdir(), 'mlspecs-adv-'));
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
  const r = spawnSync(process.execPath, [BIN, 'specs/0001-thing.md', '--root', dir, ...args], {
    cwd: dir, encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};
const statusOf = (dir) =>
  /\|\s*\*\*Status\*\*\s*\|\s*([A-Za-z]+)/.exec(readFileSync(join(dir, 'specs', '0001-thing.md'), 'utf8'))[1];

test('SENSOR: an unsigned human judgement refuses, and the Status does not move', (t) => {
  const dir = repo(t);
  // The gap this closes. `commands/spec-advance.md` already claimed to be "the only command that
  // writes a spec's Status" while the MODEL did the writing — a rule in a prompt is advice, and
  // the same model on the same repo can decide differently twice with no way to tell afterwards.
  const r = run(dir, '--to', 'Verified');
  assert.equal(r.code, 1);
  assert.match(r.out, /need a human judgement/);
  assert.equal(statusOf(dir), 'Implemented', 'the Status moved on an unsigned judgement');
});

test('a token attestation is not an attestation', (t) => {
  const dir = repo(t);
  const r = run(dir, '--to', 'Verified', '--attest', 'ok');
  assert.equal(r.code, 1);
  assert.match(r.out, /10 characters minimum/);
  assert.equal(statusOf(dir), 'Implemented');
});

test('SENSOR: a FAILing gate refuses — the gate is not an opinion', (t) => {
  const dir = repo(t);
  rmSync(join(dir, 'test', 'thing.test.mjs'));   // tests-exist now fails
  const r = run(dir, '--to', 'Verified', '--attest', REAL);
  assert.equal(r.code, 1);
  assert.match(r.out, /gate\(s\) failed — Status not written/);
  assert.equal(statusOf(dir), 'Implemented');
});

test('signed and clear: the Status is written and a record is left behind', (t) => {
  const dir = repo(t);
  const r = run(dir, '--to', 'Verified', '--attest', REAL);
  assert.equal(r.code, 0, r.out);
  assert.equal(statusOf(dir), 'Verified');

  const rec = readRecord(dir, 'specs/0001-thing.md', 'Verified');
  assert.ok(rec, 'no evidence record was written');
  assert.match(rec.attested.by, /ada@example\.com/, 'who signed comes from git, not from a flag');
  assert.equal(rec.attested.text, REAL);
  assert.equal(freshness(dir, rec).verdict, FRESH);
});

test('SENSOR: the record goes stale when the test it rested on is deleted', (t) => {
  const dir = repo(t);
  assert.equal(run(dir, '--to', 'Verified', '--attest', REAL).code, 0);

  // The whole point. Before this, a status stayed `Verified` after the test that proved it was
  // deleted, and nothing in the toolkit could notice.
  rmSync(join(dir, 'test', 'thing.test.mjs'));
  const v = freshness(dir, readRecord(dir, 'specs/0001-thing.md', 'Verified'));
  assert.equal(v.verdict, STALE);
  assert.match(v.reason, /test\/thing\.test\.mjs/);
});

test('only the Status cell changes, byte for byte', (t) => {
  const dir = repo(t);
  const before = readFileSync(join(dir, 'specs', '0001-thing.md'), 'utf8');
  assert.equal(run(dir, '--to', 'Verified', '--attest', REAL).code, 0);
  const after = readFileSync(join(dir, 'specs', '0001-thing.md'), 'utf8');

  // A status write that reflows a table makes the diff unreviewable, and a diff nobody reads is
  // how a status write hides something else.
  assert.equal(after.replace('| **Status** | Verified |', '| **Status** | Implemented |'), before);
});

test('--dry-run decides and writes nothing', (t) => {
  const dir = repo(t);
  const r = run(dir, '--to', 'Verified', '--attest', REAL, '--dry-run');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /would write Implemented → Verified/);
  assert.equal(statusOf(dir), 'Implemented');
  assert.equal(existsSync(join(dir, '.ml-specs', 'evidence', '0001-thing-verified.json')), false);
});

test('a missing spec is could-not-run, not a failed gate', (t) => {
  const dir = repo(t);
  const r = spawnSync(process.execPath, [BIN, 'specs/0404-nope.md', '--root', dir], { cwd: dir, encoding: 'utf8' });
  // Exit 1 is a verdict about this repository; exit 2 is a fact about the machine. Collapsing
  // them would make "I could not look" read as "I looked and it is wrong".
  assert.equal(r.status, 2);
});

test('--json reports the same decision a reader is shown', (t) => {
  const dir = repo(t);
  const r = run(dir, '--to', 'Verified', '--attest', REAL, '--json');
  assert.equal(r.code, 0);
  const j = JSON.parse(r.out);
  assert.equal(j.ok, true);
  assert.equal(j.from, 'Implemented');
  assert.equal(j.to, 'Verified');
  assert.match(j.record, /\.ml-specs[/\\]evidence/);

  const refused = run(dir, '--to', 'Archived', '--json');
  assert.equal(JSON.parse(refused.out).ok, false, 'a refusal must be machine-readable too');
});
