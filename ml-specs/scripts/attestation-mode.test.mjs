// How a transition was attested — by a person, or by nobody.
//
// `spec-advance.mjs` takes `by` from `git config user.name`, which is the human whose machine the
// run happened on. Without a mode, an automated run signs that human's name to a judgement they
// never made, the record reads `fresh`, and every reader downstream treats a human-approval gate
// as witnessed by a human. These drive the real CLI, because the flag and the field are only
// worth anything end to end: what lands on disk, and what a reader sees.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRecord, attestMode } from './lib/evidence.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ADVANCE = join(HERE, 'spec-advance.mjs');
const EVIDENCE = join(HERE, 'spec-evidence.mjs');
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
  const dir = mkdtempSync(join(tmpdir(), 'mlspecs-attest-'));
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

const advance = (dir, ...args) => {
  const r = spawnSync(process.execPath, [ADVANCE, 'specs/0001-thing.md', '--root', dir, ...args], {
    cwd: dir, encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

const evidence = (dir, ...args) => {
  const r = spawnSync(process.execPath, [EVIDENCE, '--root', dir, ...args], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

test('AC1: a transition nobody flagged is attested by a human', (t) => {
  const dir = repo(t);
  assert.equal(advance(dir, '--to', 'Verified', '--attest', REAL).code, 0);

  const rec = readRecord(dir, 'specs/0001-thing.md', 'Verified');
  assert.equal(rec.attested.mode, 'human', 'the default must be recorded, not left to each reader to assume');
  assert.equal(attestMode(rec), 'human');
});

test('AC2: --unattended says so on the record, rather than signing a name', (t) => {
  const dir = repo(t);
  const r = advance(dir, '--to', 'Verified', '--attest', REAL, '--unattended');
  assert.equal(r.code, 0, r.out);

  const rec = readRecord(dir, 'specs/0001-thing.md', 'Verified');
  assert.equal(attestMode(rec), 'unattended');
  // `by` is unchanged on purpose — it is still true about whose machine ran this. `mode` is what
  // stops it being read as whose judgement this was.
  assert.match(rec.attested.by, /ada@example\.com/);
  assert.match(r.out, /signed by .*\(unattended\)/, 'the operator must see the mode without opening the record');
});

test('AC2: --json carries the mode through', (t) => {
  const dir = repo(t);
  const r = advance(dir, '--to', 'Verified', '--attest', REAL, '--unattended', '--json');
  assert.equal(r.code, 0, r.out);
  assert.equal(JSON.parse(r.out).attested.mode, 'unattended');
});

test('AC5: SENSOR: --unattended lowers no bar — a token attestation is still refused', (t) => {
  const dir = repo(t);
  // The tempting shortcut: treat "no human here" as "no signature needed". Then the flag is a way
  // round the gate rather than a label on it, and an unattended run is cheaper than an attended
  // one. It only labels who was there.
  const r = advance(dir, '--to', 'Verified', '--attest', 'ok', '--unattended');
  assert.equal(r.code, 1);
  assert.match(r.out, /10 characters minimum/);
  assert.equal(readRecord(dir, 'specs/0001-thing.md', 'Verified'), null, 'the Status moved on an unsigned unattended run');
});

test('AC4: spec-evidence marks an unattended record, in both its outputs', (t) => {
  const dir = repo(t);
  assert.equal(advance(dir, '--to', 'Verified', '--attest', REAL, '--unattended').code, 0);

  const human = evidence(dir);
  assert.equal(human.code, 0, human.out);
  assert.match(human.out, /attested unattended/, 'a `fresh` record otherwise reads as one a person checked');

  const json = JSON.parse(evidence(dir, '--json').out);
  assert.equal(json.records[0].mode, 'unattended');
});

test('AC4: a record a person signed is not marked, and reads human in --json', (t) => {
  const dir = repo(t);
  assert.equal(advance(dir, '--to', 'Verified', '--attest', REAL).code, 0);

  const human = evidence(dir);
  assert.doesNotMatch(human.out, /attested unattended/, 'marking every record marks nothing');

  const json = JSON.parse(evidence(dir, '--json').out);
  assert.equal(json.records[0].mode, 'human');
});
