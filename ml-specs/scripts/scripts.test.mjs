// Script-level behaviour: what each CLI does at its boundaries.
//
// The lib tests cover the logic; these cover the decision a script makes about
// whether to act at all. That is where the interesting bugs live — a script that
// notices a precondition is violated, says so in prose, and proceeds anyway
// passes every unit test its lib has.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));

function repo(specs = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sdd-scripts-'));
  mkdirSync(join(dir, 'specs'), { recursive: true });
  mkdirSync(join(dir, 'docs'), { recursive: true });
  for (const [name, body] of Object.entries(specs)) writeFileSync(join(dir, 'specs', name), body);
  return dir;
}

/** Run a script; return { code, stdout, stderr } instead of throwing on non-zero. */
function run(script, args, cwd) {
  try {
    const stdout = execFileSync('node', [join(SCRIPTS, script), ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

const spec = ({ status = 'Approved', criteria = '- [ ] **AC1** — Given x, when y, then z.' }) =>
  `# Spec: Fixture\n\n| | |\n|---|---|\n| **Ticket** | PAY-1 |\n| **Status** | ${status} |\n\n## 5. Acceptance criteria\n\n${criteria}\n`;

describe('spec-brief refuses rather than warns', () => {
  test('an approved spec with NO criteria is refused', () => {
    // A brief exists to state the definition of done. Without criteria there is
    // none, so emitting one under a heading that claims to supply it is worse
    // than refusing. spec-gate.mjs fails this spec; the two must agree.
    const dir = repo({ '0200-none.md': spec({ criteria: '' }) });
    const r = run('spec-brief.mjs', ['0200'], dir);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /no acceptance criteria/);
    assert.doesNotMatch(r.stdout, /Definition of done/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('spec-gate and spec-brief agree on that spec', () => {
    const dir = repo({ '0200-none.md': spec({ criteria: '' }) });
    assert.equal(run('spec-gate.mjs', ['specs/0200-none.md'], dir).code,
                 run('spec-brief.mjs', ['0200'], dir).code);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a Draft spec is refused — the contract is still being negotiated', () => {
    const dir = repo({ '0201-draft.md': spec({ status: 'Draft' }) });
    const r = run('spec-brief.mjs', ['0201'], dir);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /before the approval gate/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('an approved spec with criteria produces a brief pairing each with its test case', () => {
    const dir = repo({ '0202-ok.md': spec({}) });
    const r = run('spec-brief.mjs', ['0202'], dir);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /\*\*AC-1\*\* \(TC-0202\.1\)/);
    assert.match(r.stdout, /Definition of done/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('spec-trace', () => {
  test('a suffixed spec id is a distinct spec, not a clash', () => {
    const dir = repo({ '0165b-follow-up.md': spec({}) });
    const r = run('spec-trace.mjs', ['0165b'], dir);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /SPEC-0165b/);
    assert.match(r.stdout, /TC-0165b\.1/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a hand-typed ticket is reported unverifiable, not counted as passing', () => {
    const dir = repo({ '0203-x.md': spec({}) });
    const r = run('spec-trace.mjs', ['0203'], dir);
    assert.match(r.stdout, /cannot be verified from the repo/);
    assert.match(r.stdout, /chain intact/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('no matching spec is an error, not an empty pass', () => {
    const dir = repo({ '0204-x.md': spec({}) });
    assert.equal(run('spec-trace.mjs', ['9999'], dir).code, 1);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('spec-fanout never gives a false all-clear', () => {
  const estate = `| Event / queue / topic | Producer | Consumer | Notes | Evidence |
|---|---|---|---|---|
| \`payment.captured\` | svc-a | svc-b (\`Listener\`) | n | e |`;

  test('asked who breaks with no estate index, it refuses rather than reporting none', () => {
    // An empty list plus a zero exit reads as "nothing else is affected". That is
    // the most expensive wrong answer this script can give.
    const dir = repo({ '0001-x.md': spec({}) });
    const r = run('spec-fanout.mjs', ['0001', 'payment.captured', '--plan'], dir);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /cannot say who else breaks/);
    assert.match(r.stderr, /indistinguishable from "nothing is affected"/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a spec that fans out to nothing says which reason, not an empty plan', () => {
    const dir = repo({ '0001-x.md': spec({}) });
    const r = run('spec-fanout.mjs', ['0001', '--plan'], dir);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /fans out to nothing/);
    assert.doesNotMatch(r.stdout, /would open/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('with an index present it plans normally', () => {
    const dir = repo({ '0001-x.md': spec({}) });
    writeFileSync(join(dir, 'docs', 'ESTATE.md'), estate);
    const r = run('spec-fanout.mjs', ['0001', 'payment.captured', '--plan'], dir);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /svc-b/);
    assert.match(r.stdout, /consumes payment\.captured/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('every target shares one branch name', () => {
    const dir = repo({ '0001-x.md': spec({}) });
    writeFileSync(join(dir, 'docs', 'ESTATE.md'), estate);
    const out = run('spec-fanout.mjs', ['0001', 'payment.captured', '--plan'], dir).stdout;
    const branches = [...out.matchAll(/feat\/0001-[a-z-]+/g)].map((m) => m[0]);
    assert.ok(branches.length > 0);
    assert.equal(new Set(branches).size, 1);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('nfr-compile', () => {
  const NFRS = `| NFR | Kind | Statement | Metric | Op | Value | Unit | Applies to |
|-----|------|-----------|--------|----|-------|------|------------|
| NFR-01 | performance | responsive | p95 | < | 300 | ms | svc-a |
| NFR-02 | security | no findings |  |  |  |  | * |`;

  test('an NFR with no measurable threshold makes the run fail', () => {
    const dir = repo({});
    writeFileSync(join(dir, 'docs', 'NFRS.md'), NFRS);
    const r = run('nfr-compile.mjs', [], dir);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /NFR-02[\s\S]*refused/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('dry run writes nothing', () => {
    const dir = repo({});
    writeFileSync(join(dir, 'docs', 'NFRS.md'),
      NFRS.split('\n').filter((l) => !l.includes('NFR-02')).join('\n'));
    run('nfr-compile.mjs', [], dir);
    assert.throws(() => execFileSync('cat', [join(dir, 'docs', 'CONSTRAINTS.md')], { stdio: 'ignore' }));
    rmSync(dir, { recursive: true, force: true });
  });

  test('--apply writes the constraint and reports what changed', () => {
    const dir = repo({});
    writeFileSync(join(dir, 'docs', 'NFRS.md'),
      NFRS.split('\n').filter((l) => !l.includes('NFR-02')).join('\n'));
    const r = run('nfr-compile.mjs', ['--apply'], dir);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /knowledge layer updated/);
    // second run is a no-op and must say so rather than claiming a write
    assert.match(run('nfr-compile.mjs', ['--apply'], dir).stdout, /already current/);
    rmSync(dir, { recursive: true, force: true });
  });
});
