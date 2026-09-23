// The guard, and the fail-open behaviour that is most of its value.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), 'spec-guard.mjs');
const BLOCK = 2;

const SPEC = (touches, branch = 'feat/tax') => `# Spec: tax

| | |
|---|---|
| **Status** | Approved |
| **Branch** | ${branch} |
| **Touches** | ${touches} |

## 5. Acceptance criteria
- [ ] **AC1** — it computes VAT.
`;

function repo(t, touches = 'src/billing/, test/billing/') {
  const dir = mkdtempSync(join(tmpdir(), 'mlspecs-guard-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  for (const d of ['specs', 'src/billing', 'src/other', 'test/billing']) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, 'specs', '0001-tax.md'), SPEC(touches));
  writeFileSync(join(dir, 'src', 'billing', 'tax.ts'), 'x\n');
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 't');
  git('config', 'user.email', 't@t');
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('checkout', '-q', '-b', 'feat/tax');
  return { dir, git };
}

const guard = (dir, ...args) => {
  const r = spawnSync(process.execPath, [BIN, ...args, '--root', dir], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};
const payload = (dir, file) => {
  const r = spawnSync(process.execPath, [BIN, '--stdin', '--root', dir], {
    cwd: dir, encoding: 'utf8',
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: file } }),
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

test('SENSOR: a write outside the declared Touches is refused with exit 2', (t) => {
  const { dir } = repo(t);
  // Exit 2 and not 1: that is the host's PreToolUse contract for refusing a tool call, and it is
  // the opposite of what 2 means everywhere else in this plugin.
  const r = guard(dir, 'src/other/thing.ts');
  assert.equal(r.code, BLOCK);
  assert.match(r.out, /outside the scope 0001 declares/);
  assert.match(r.out, /Declared Touches: src\/billing, test\/billing/, 'the refusal says what IS allowed');
});

test('a write inside the declared Touches is allowed, quietly', (t) => {
  const { dir } = repo(t);
  assert.equal(guard(dir, 'src/billing/tax.ts').code, 0);
  assert.equal(guard(dir, 'test/billing/tax.test.ts').code, 0);
});

test('the same decision through a PreToolUse payload', (t) => {
  const { dir } = repo(t);
  assert.equal(payload(dir, 'src/other/thing.ts').code, BLOCK);
  assert.equal(payload(dir, 'src/billing/tax.ts').code, 0);
});

test('SENSOR: a relative .. cannot walk out of the repository', (t) => {
  const { dir } = repo(t);
  const r = guard(dir, 'src/billing/../../escape/x.ts');
  assert.equal(r.code, BLOCK, 'a path that resolves outside the repo was allowed');
  assert.match(r.out, /escape\/x\.ts/, 'and the refusal names where it lands, not how it was spelled');
});

test('the spec itself stays writable — you must be able to widen what blocks you', (t) => {
  const { dir } = repo(t);
  assert.equal(guard(dir, 'specs/0001-tax.md').code, 0);
  assert.equal(guard(dir, '.ml-specs/evidence/0001-tax-approved.json').code, 0);
});

// ── fail open: every one of these must ALLOW ────────────────────────────────────────────────

test('SENSOR: no Touches row means nothing is bounded', (t) => {
  const { dir } = repo(t, '—');
  const r = guard(dir, 'src/other/thing.ts');
  assert.equal(r.code, 0, 'an unbounded spec refused a write');
  assert.match(r.out, /declares no Touches/);
});

test('SENSOR: an unfilled template placeholder bounds nothing either', (t) => {
  const { dir } = repo(t, '<paths this spec may write>');
  // The placeholder contains no path, and reading one out of it would give every unfilled spec a
  // bogus bound and refuse every write in the repository.
  assert.equal(guard(dir, 'src/other/thing.ts').code, 0);
});

test('no spec names this branch — allow, and say so', (t) => {
  const { dir, git } = repo(t);
  git('checkout', '-q', 'main');
  const r = guard(dir, 'src/other/thing.ts');
  assert.equal(r.code, 0);
  assert.match(r.out, /no spec names branch main/);
});

test('two specs on one branch is ambiguous, and ambiguity allows', (t) => {
  const { dir } = repo(t);
  writeFileSync(join(dir, 'specs', '0002-dup.md'), SPEC('src/billing/'));
  const r = guard(dir, 'src/other/thing.ts');
  assert.equal(r.code, 0, 'the guard guessed which spec bounds the write');
  assert.match(r.out, /ambiguous/);
});

test('no file path in the call is nothing to judge', (t) => {
  const { dir } = repo(t);
  assert.equal(guard(dir).code, 0);
  const r = spawnSync(process.execPath, [BIN, '--stdin', '--root', dir], { cwd: dir, encoding: 'utf8', input: '{ not json' });
  assert.equal(r.status, 0, 'an unparseable payload is not a write we can judge');
});

test('outside a git work tree, allow — and never leak git\'s own error', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mlspecs-nogit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = guard(dir, 'src/other/thing.ts');
  assert.equal(r.code, 0);
  // This output is handed to a model as the reason a write was refused. Somebody else's error
  // text arriving in that slot reads as the guard malfunctioning.
  assert.doesNotMatch(r.out, /fatal: not a git repository/);
  assert.match(r.out, /not a git work tree/);
});

test('--json reports the same decision a reader is shown', (t) => {
  const { dir } = repo(t);
  const blocked = JSON.parse(guard(dir, 'src/other/thing.ts', '--json').out);
  assert.equal(blocked.decision, 'block');
  assert.deepEqual(blocked.stray, ['src/other/thing.ts']);

  const allowed = JSON.parse(guard(dir, 'src/billing/tax.ts', '--json').out);
  assert.equal(allowed.decision, 'allow');
});

// ── the door the matcher was not watching ───────────────────────────────────────────────────

const bash = (dir, command) => {
  const r = spawnSync(process.execPath, [BIN, '--stdin', '--root', dir], {
    cwd: dir, encoding: 'utf8',
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

test('SENSOR: a Bash redirect outside the Touches row is refused', (t) => {
  const { dir } = repo(t);
  // A Bash payload carries no file_path, so hooking the four write tools leaves this door open:
  // one `echo … > src/other/thing.ts` writes anywhere in the tree with the guard watching a
  // different one.
  assert.equal(bash(dir, 'echo hi > src/other/thing.ts').code, BLOCK);
  assert.equal(bash(dir, 'echo hi >> src/other/thing.ts').code, BLOCK, '>> is the same write');
  assert.equal(bash(dir, 'ls | tee src/other/thing.ts').code, BLOCK, 'tee is the same write');
  assert.equal(bash(dir, 'echo hi > src/billing/tax.ts').code, 0, 'an in-scope redirect was refused');
});

test('SENSOR: it does not block what it cannot read', (t) => {
  const { dir } = repo(t);
  // Every one of these must ALLOW. A guard that refuses a routine command gets switched off, and
  // a switched-off guard misses the redirect too.
  const ALLOWED = [
    'npm test > /dev/null 2>&1',              // a device
    'git diff > /tmp/ml-specs-d.patch',       // outside the repository entirely
    'echo "a > src/other/x.ts"',              // a `>` inside a quoted string
    'echo hi > "$out"',                       // a target the text does not determine
    'npm test 2>&1 | head',                   // fd duplication
    'sed -i s/a/b/ src/other/thing.ts',       // outside what this claims to parse
    'cat > src/billing/p.html <<EOF\n<div>x > src/other/y.ts</div>\nEOF',  // a heredoc body
  ];
  for (const command of ALLOWED) {
    const r = bash(dir, command);
    assert.equal(r.code, 0, `the guard blocked a command it cannot read:\n  ${command}\n${r.out}`);
  }
});

test('the hook matcher names Bash as well as the write tools', async () => {
  const { readFileSync } = await import('node:fs');
  const hooks = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'hooks.json'), 'utf8'));
  const group = hooks.hooks.PreToolUse.find((g) => g.hooks.some((h) => h.command.includes('scope-guard.sh')));
  assert.ok(group, 'no PreToolUse group runs the scope guard');
  for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash']) {
    assert.ok(group.matcher.split('|').includes(tool), `the matcher does not name ${tool}, so that tool is unguarded`);
  }
});


test('SENSOR: every decision is logged, and a log failure never changes one', (t) => {
  const { dir } = repo(t);
  assert.equal(guard(dir, 'src/billing/tax.ts').code, 0);
  assert.equal(guard(dir, 'src/other/thing.ts').code, BLOCK);

  const log = readFileSync(join(dir, '.ml-specs', 'activity.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(log.map((e) => e.decision), ['allow', 'block']);
  assert.deepEqual(log[1].files, ['src/other/thing.ts']);

  // A blocked write leaving no trace is why "is the guard helping?" had no answer but memory —
  // and memory remembers one annoying refusal over ten silent allows.
  mkdirSync(join(dir, '.ml-specs'), { recursive: true });
  chmodSync(join(dir, '.ml-specs'), 0o500);
  let allowed;
  let blocked;
  try {
    allowed = guard(dir, 'src/billing/tax.ts').code;
    blocked = guard(dir, 'src/other/thing.ts').code;
  } finally {
    // Restored here, not in `t.after`: the fixture's own cleanup is registered first and would
    // try to delete an unwritable directory before any later hook could put it back.
    chmodSync(join(dir, '.ml-specs'), 0o755);
  }
  assert.equal(allowed, 0, 'an unwritable log changed an allow');
  assert.equal(blocked, BLOCK, 'an unwritable log changed a block');
});
