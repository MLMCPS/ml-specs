// The smallest next action.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const WHY = join(DIR, 'spec-why.mjs');
const ADVANCE = join(DIR, 'spec-advance.mjs');
const T = String.fromCharCode(96);

const SPEC = ({ ticked = true, testFile = 'test/a.test.mjs', ac = 'it validates.' } = {}) => [
  '# Spec: alpha', '',
  '| | |', '|---|---|',
  '| **Status** | Approved |',
  '| **Branch** | main |', '',
  '## 5. Acceptance criteria',
  `- [${ticked ? 'x' : ' '}] **AC1** — ${ac}`, '',
  '## 6. Test plan',
  '| AC | Test file | What it proves |', '|---|---|---|',
  `| AC1 | ${T}${testFile}${T} | it validates |`, '',
  `### 6.1 Final acceptance (gate before ${T}Verified${T})`,
  `- Full suite: ${T}node -e 'process.exit(0)'${T}`, '',
  '## 8. Open questions', 'None blocking.', '',
].join('\n');

function repo(t, opts) {
  const dir = mkdtempSync(join(tmpdir(), 'mlspecs-why-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'specs'), { recursive: true });
  mkdirSync(join(dir, 'test'), { recursive: true });
  writeFileSync(join(dir, 'specs', '0001-a.md'), SPEC(opts));
  writeFileSync(join(dir, 'test', 'a.test.mjs'), '// proves AC1\n');
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 't');
  git('config', 'user.email', 't@t');
  git('add', '-A');
  git('commit', '-qm', 'base');
  return dir;
}
const why = (dir, ...extra) => {
  const r = spawnSync(process.execPath, [WHY, 'specs/0001-a.md', '--root', dir, ...extra], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

test('SENSOR: it answers in a sentence, not a page', (t) => {
  const dir = repo(t, { ticked: false });
  const r = why(dir);
  // The gate lists nine verdicts, which is right for deciding a transition and wrong for an agent
  // mid-task: a page to re-read and reason about every turn, and reasoning is where a model
  // drifts. warrant answers this in 232 bytes; anything over a few hundred defeats the purpose.
  assert.ok(r.out.length < 400, `answer was ${r.out.length} bytes:\n${r.out}`);
  assert.equal(r.out.trim().split('\n').length, 2, 'one line of why, one of what to do');
});

test('a failing gate is named with the remedy that fits IT', (t) => {
  const dir = repo(t, { testFile: 'test/missing.test.mjs' });
  const r = why(dir);
  // "re-run the gate" is useless for a missing test file and actively wrong for a blocking §8
  // question. The gate knows what is wrong; this is the only place that knows what to do.
  assert.match(r.out, /named test\(s\) do not exist/);
  assert.match(r.out, /write the test §6 names/);
});

test('an unticked criterion asks for the work, not for a re-run', (t) => {
  const dir = repo(t, { ticked: false });
  assert.match(why(dir).out, /finish the work, then tick/);
});

test('SENSOR: a failing record outranks a remaining judgement', (t) => {
  const dir = repo(t);
  execFileSync(process.execPath, [ADVANCE, 'specs/0001-a.md', '--root', dir, '--to', 'Implemented'], { cwd: dir, encoding: 'utf8' });
  const spec = join(dir, 'specs', '0001-a.md');
  writeFileSync(spec, readFileSync(spec, 'utf8').replace('it validates.', 'it rejects an invalid token.'));

  // A spec whose CURRENT status no longer stands should not be advanced past it — reporting the
  // next judgement first would walk somebody straight over the thing that broke.
  const r = why(dir);
  assert.match(r.out, /no longer stands/);
  assert.match(r.out, /spec-amend\.mjs/, 'an amendment has its own remedy, not "re-run the gate"');
});

test('a clear spec says what to run next', (t) => {
  const dir = repo(t);
  const r = why(dir);
  assert.match(r.out, /nothing outstanding/);
  assert.match(r.out, /spec-advance\.mjs .* --attest/);
});

test('it decides nothing — exit 0 even when the spec is blocked', (t) => {
  const dir = repo(t, { ticked: false });
  // "Nothing is blocking it" is an answer, not a success code, and the inverse is also true.
  assert.equal(why(dir).code, 0);
});

test('a missing spec is could-not-run', (t) => {
  const dir = repo(t);
  const r = spawnSync(process.execPath, [WHY, 'specs/0404-nope.md', '--root', dir], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 2);
});

test('--json carries the same answer', (t) => {
  const dir = repo(t, { ticked: false });
  const j = JSON.parse(why(dir, '--json').out);
  assert.ok(j.why && j.next);
  assert.equal(j.gate, 'criteria');
});
