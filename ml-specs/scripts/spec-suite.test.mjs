// `--run-suite`: the one MANUAL gate a script can settle.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const GATE = join(DIR, 'spec-gate.mjs');

const TICK = String.fromCharCode(96);
const suiteLine = (suite) => (suite === null
  ? `- Full suite: ${TICK}<e.g. npm test / mvn verify>${TICK}`
  : `- Full suite: ${TICK}${suite}${TICK}`);

const SPEC = (suite) => [
  '# Spec: alpha',
  '',
  '| | |',
  '|---|---|',
  '| **Status** | Implemented |',
  '| **Branch** | main |',
  '',
  '## 5. Acceptance criteria',
  '- [x] **AC1** — it validates.',
  '',
  '## 6. Test plan',
  '| AC | Test file | What it proves |',
  '|---|---|---|',
  `| AC1 | ${TICK}test/a.test.mjs${TICK} | it validates |`,
  '',
  `### 6.1 Final acceptance (gate before ${TICK}Verified${TICK})`,
  suiteLine(suite),
  `- Preconditions: ${TICK}none${TICK}`,
  '',
  '## 8. Open questions',
  'None blocking.',
  '',
].join('\n');

function repo(t, suite) {
  const dir = mkdtempSync(join(tmpdir(), 'mlspecs-suite-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'specs'), { recursive: true });
  mkdirSync(join(dir, 'test'), { recursive: true });
  writeFileSync(join(dir, 'specs', '0001-a.md'), SPEC(suite));
  writeFileSync(join(dir, 'test', 'a.test.mjs'), '// proves AC1\n');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

const suiteVerdict = (dir, ...extra) => {
  const r = spawnSync(process.execPath, [GATE, 'specs/0001-a.md', '--root', dir, '--to', 'Verified', '--json', ...extra],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, ...(extra.includes('--timeout') ? {} : {}) } });
  return JSON.parse(r.stdout).gates.find((g) => g.name === 'suite-green');
};

test('without the flag the gate does not run anything — that is the default, deliberately', (t) => {
  const dir = repo(t, "node -e 'process.exit(1)'");
  // A gate that always costs minutes is a gate people route around, after which nothing is
  // checked at all. The red suite here proves it was not run: the verdict is still MANUAL.
  const g = suiteVerdict(dir);
  assert.equal(g.verdict, 'MANUAL');
  assert.match(g.detail, /--run-suite/, 'the default should say the option exists');
});

test('SENSOR: a green suite becomes a real PASS, not a promise', (t) => {
  const dir = repo(t, "node -e 'process.exit(0)'");
  const g = suiteVerdict(dir, '--run-suite');
  assert.equal(g.verdict, 'PASS');
  assert.match(g.detail, /ran green/);
});

test('SENSOR: a red suite is a FAIL, and spec-advance then refuses', (t) => {
  const dir = repo(t, "node -e 'process.exit(1)'");
  assert.equal(suiteVerdict(dir, '--run-suite').verdict, 'FAIL');

  const r = spawnSync(process.execPath, [join(DIR, 'spec-advance.mjs'), 'specs/0001-a.md', '--root', dir,
    '--to', 'Verified', '--run-suite', '--attest', 'I read every criterion against the diff'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 1, 'a red suite advanced the status');
  assert.match(`${r.stdout}${r.stderr}`, /gate\(s\) failed/);
});

test('SENSOR: a command that does not exist is could-not-run, not a red suite', (t) => {
  const dir = repo(t, 'definitely-not-a-real-tool-xyz');
  // The shell exits 127 for a command it cannot find. Reporting that as a red suite sends
  // somebody to debug tests that never ran — and it is the same trap 126 sets for a file that
  // is present but not executable.
  const g = suiteVerdict(dir, '--run-suite');
  assert.equal(g.verdict, 'MANUAL');
  assert.match(g.detail, /command not found/);
  assert.match(g.detail, /not a red suite/);
});

test('a hung suite ends as could-not-run rather than never returning', (t) => {
  const dir = repo(t, 'sleep 30');
  const r = spawnSync(process.execPath, [GATE, 'specs/0001-a.md', '--root', dir, '--to', 'Verified', '--json', '--run-suite'],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, SDD_SUITE_TIMEOUT_MS: '2000' } });
  const g = JSON.parse(r.stdout).gates.find((x) => x.name === 'suite-green');
  assert.equal(g.verdict, 'MANUAL');
  assert.match(g.detail, /timed out/);
});

test('the template placeholder is not a command', (t) => {
  const dir = repo(t, null);
  // Running `<e.g. npm test / mvn verify>` would fail and report the suite red, which is a worse
  // answer than saying nobody wrote one down.
  const g = suiteVerdict(dir, '--run-suite');
  assert.equal(g.verdict, 'MANUAL');
  assert.match(g.detail, /names no full-suite command/);
});

test('the verdict names the command that ran, so a reader knows what was executed', (t) => {
  const dir = repo(t, "node -e 'process.exit(0)'");
  // It runs a command out of a committed file. Anyone who can edit the spec chooses what this
  // executes, which is why it never runs unsolicited and why the command is in the verdict.
  assert.match(suiteVerdict(dir, '--run-suite').detail, /node -e/);
});
