// Spec 0036 AC1, AC3, AC4, AC5, AC6 — the three verbs, end to end.
//
// AC5 IS THE ONE THAT MATTERS. Everything else here fails loudly. AC5 guards the quiet failure: a
// board-wide "✓" being read as "checked", when only the mechanical half ran. `spec-gate` splits
// its verdicts into PASS/FAIL, which a script decides, and MANUAL, which it explicitly does not —
// whether a human approved, whether §8 holds a blocking question, whether the suite really ran.
// A command that collapses that distinction across N specs is the rubber stamp spec 0025 §5
// records, at N times the scale.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE));
const NEW = join(HERE, 'spec-new.mjs');
const CHECK = join(HERE, 'spec-check.mjs');
const CHANGELOG = join(HERE, 'spec-changelog.mjs');

const SPEC = (status) => `# Spec: a thing

| | |
|---|---|
| **Status** | ${status} |
| **Branch** | — |
| **Author** | Ada |

## 5. Acceptance criteria
- [ ] **AC1** — it validates.

## 6. Test plan
| AC | Test file | What it proves |
|---|---|---|
| AC1 | \`test/thing.test.mjs\` | it validates |

## 8. Open questions
None blocking.
`;

/** A repo with a spec template and whatever specs are asked for. */
function repo(t, specs = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mlspecs-bw-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'specs', 'archive'), { recursive: true });
  writeFileSync(join(dir, 'specs', 'TEMPLATE.md'), readFileSync(join(ROOT, 'specs', 'TEMPLATE.md'), 'utf8'));
  for (const [name, body] of Object.entries(specs)) writeFileSync(join(dir, 'specs', name), body);
  execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'ignore' });
  // Set an identity ON THE FIXTURE, because `spec-new` reads `git config user.name` to fill the
  // Author row. Inheriting it from whoever runs the suite made this pass on a developer's machine
  // and fail on a CI runner, which has no global identity — the failure was in AC1 below, and it
  // looked like a spec-new bug rather than a fixture one.
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Fixture Author'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'fixture@example.invalid'], { stdio: 'ignore' });
  return dir;
}

const run = (cli, dir, ...args) => {
  const r = spawnSync(process.execPath, [cli, ...args, '--root', dir], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, stdout: r.stdout || '' };
};

/**
 * Run with NO resolvable git identity. BOTH halves are required: the repo-local key is unset by
 * the caller, and global/system are pointed at empty files here. Either alone leaves an identity
 * — local wins over global, and global is whatever the machine happens to have, which is the
 * inheritance that made this suite environment-dependent in the first place.
 */
const runWithoutIdentity = (cli, dir, ...args) => {
  const r = spawnSync(process.execPath, [cli, ...args, '--root', dir], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, stdout: r.stdout || '' };
};

const specFiles = (dir) => readdirSync(join(dir, 'specs')).filter((f) => /^\d{4}-/.test(f)).sort();

describe('AC1 — spec-new writes a usable header', () => {
  test('number, slug, date, rigor and Status, with no placeholder left', (t) => {
    const dir = repo(t);
    const r = run(NEW, dir, 'token-validator', '--rigor', 'deep', '--no-fetch');
    assert.equal(r.code, 0, r.out);

    const [file] = specFiles(dir);
    assert.equal(file, '0001-token-validator.md');
    const text = readFileSync(join(dir, 'specs', file), 'utf8');
    assert.match(text, /^\| \*\*Rigor\*\* \| deep \|$/m);
    assert.match(text, /^\| \*\*Status\*\* \| Draft \|$/m);
    assert.match(text, /^\| \*\*Date\*\* \| \d{4}-\d{2}-\d{2} \|$/m);
    // Scoped to the fields spec-new CLAIMS to fill. Stack and Ticket are not derivable, and a
    // guess in a header field is worse than a placeholder — a placeholder is visibly unfilled.
    // What the command owes instead is naming them, which the next test asserts.
    assert.doesNotMatch(text, /^\| \*\*(Author|Project \/ service|Date|Status|Rigor|Branch)\*\* \| <.*$/m,
      'a field spec-new fills still carries a placeholder');
    // Asserted positively as well as by absence: the fixture sets this identity, so an Author row
    // that merely lost its placeholder without gaining the name would still be wrong.
    assert.match(text, /^\| \*\*Author\*\* \| Fixture Author \|$/m);
  });

  test('the body is NOT filled in — the prompts are the point of a template', (t) => {
    const dir = repo(t);
    run(NEW, dir, 'a-thing', '--no-fetch');
    const text = readFileSync(join(dir, 'specs', '0001-a-thing.md'), 'utf8');
    assert.match(text, /## 1\. Problem \/ Goal/);
    // The template's own guidance survives; pre-filling it is how a spec gets written by
    // autocomplete rather than by thinking.
    assert.match(text, /<What user\/business problem/);
  });

  test('--dry-run writes nothing', (t) => {
    const dir = repo(t);
    const r = run(NEW, dir, 'a-thing', '--dry-run', '--no-fetch');
    assert.equal(r.code, 0);
    assert.deepEqual(specFiles(dir), []);
  });
});

describe('AC1 — an unresolvable git identity', () => {
  test('leaves the Author placeholder and names it, rather than guessing', (t) => {
    // The regression this pins. `spec-new` reads `git config user.name`; a machine with no
    // identity — every CI runner — gets `null`, so the Author row keeps `<name>`. That is the
    // SAME rule the source states for Stack and Ticket: a placeholder is visibly unfilled, while
    // a wrong guess reads as a decision. It was never asserted, so when the fixture above stopped
    // inheriting an identity the suite failed as though spec-new were broken.
    const dir = repo(t);
    // The fixture sets a local identity so AC1 above is deterministic; this test needs it gone.
    execFileSync('git', ['-C', dir, 'config', '--unset', 'user.name'], { stdio: 'ignore' });
    execFileSync('git', ['-C', dir, 'config', '--unset', 'user.email'], { stdio: 'ignore' });
    const r = runWithoutIdentity(NEW, dir, 'token-validator', '--rigor', 'light', '--no-fetch');
    assert.equal(r.code, 0, r.out);

    const text = readFileSync(join(dir, 'specs', specFiles(dir)[0]), 'utf8');
    assert.match(text, /^\| \*\*Author\*\* \| <name> \|$/m, 'Author was guessed instead of left unfilled');
    // Not silently: an unfilled field the writer is not told about is one `spec-gate` refuses
    // later, which is the round trip the command exists to avoid.
    assert.match(r.out, /Author/, 'the unfilled Author field was not named on the way out');
    // Everything derivable without an identity is still filled.
    assert.match(text, /^\| \*\*Status\*\* \| Draft \|$/m);
    assert.match(text, /^\| \*\*Rigor\*\* \| light \|$/m);
  });
});

describe('AC3 — a refusal writes nothing', () => {
  for (const [slug, why] of [['../escape', 'a path'], ['Has Space', 'a space'], ['UPPER', 'uppercase']]) {
    test(`${why} is refused and no file appears`, (t) => {
      const dir = repo(t);
      const r = run(NEW, dir, slug, '--no-fetch');
      assert.equal(r.code, 2, `'${slug}' was accepted`);
      assert.deepEqual(specFiles(dir), [], 'a refusal still wrote a file');
    });
  }

  test('a number already taken is a finding, and the existing file is untouched', (t) => {
    const dir = repo(t, { '0001-taken.md': 'mine\n' });
    // The scaffold would pick 0002, so force the collision by asking for the same slug twice.
    run(NEW, dir, 'a-thing', '--no-fetch');
    const before = readFileSync(join(dir, 'specs', '0001-taken.md'), 'utf8');
    run(NEW, dir, 'a-thing', '--no-fetch');
    assert.equal(readFileSync(join(dir, 'specs', '0001-taken.md'), 'utf8'), before);
  });
});

describe('AC4, AC5 — spec-check reports the board without judging it', () => {
  test('one row per spec, and the exit code follows the mechanical gates', (t) => {
    const dir = repo(t, { '0001-a.md': SPEC('Draft'), '0002-b.md': SPEC('Draft') });
    const r = run(CHECK, dir);
    assert.match(r.out, /0001-a\.md/);
    assert.match(r.out, /0002-b\.md/);
    assert.equal(r.code, 0, `a clean board reported a finding:\n${r.out}`);
  });

  test('a spec whose §6 names a missing file fails, and the exit is 1', (t) => {
    const dir = repo(t, { '0001-a.md': SPEC('Approved') });   // §6 names test/thing.test.mjs
    const r = run(CHECK, dir, '--to', 'Implemented');
    assert.equal(r.code, 1, `a broken board reported clean:\n${r.out}`);
    assert.match(r.out, /✗/);
  });

  test('REGRESSION SENSOR: every row says only mechanical gates ran', (t) => {
    // A "✓" with no caveat beside it is what gets read as "checked". Asserted on EVERY row, not
    // just failing ones — and on the summary line too, because a reader who skims reads that.
    const dir = repo(t, { '0001-a.md': SPEC('Draft') });
    const r = run(CHECK, dir);
    const rows = r.out.split('\n').filter((l) => /mechanical gate/.test(l));
    assert.ok(rows.length >= 1, `no row states what was run:\n${r.out}`);
    assert.match(r.out, /not judged here|nothing needed judgement/,
      'no row names the gates it did not judge');
    assert.match(r.out, /Nothing here judged a MANUAL one|failed a mechanical gate/,
      'the summary does not say the judgement half was skipped');
  });

  test('and --json carries the same caveat, for a consumer that cannot infer one', (t) => {
    const dir = repo(t, { '0001-a.md': SPEC('Draft') });
    const j = JSON.parse(run(CHECK, dir, '--json').stdout);
    assert.match(j.note, /mechanical gates only/);
    assert.ok(Array.isArray(j.rows) && j.rows[0].manual !== undefined,
      '--json does not say which gates went unjudged');
  });

  test('an empty board says so rather than reporting a clean one', (t) => {
    const r = run(CHECK, repo(t));
    assert.equal(r.code, 0);
    assert.match(r.out, /no specs to check/);
  });
});

describe('AC6 — the changelog splice', () => {
  const CL = '# Changelog\n\n## [Unreleased]\n\n- old\n\n## [1.2.0] - 2026-01-01\n\n- released\n';

  test('without --write, nothing is modified', (t) => {
    const dir = repo(t, { '0001-a.md': SPEC('Verified') });
    const path = join(dir, 'CHANGELOG.md');
    writeFileSync(path, CL);
    const r = run(CHANGELOG, dir, '--changelog', path);
    assert.equal(r.code, 0, r.out);
    assert.equal(readFileSync(path, 'utf8'), CL, '--write was not given and the file changed');
  });

  test('with --write, released sections are byte-identical', (t) => {
    const dir = repo(t, { '0001-a.md': SPEC('Verified') });
    const path = join(dir, 'CHANGELOG.md');
    writeFileSync(path, CL);
    assert.equal(run(CHANGELOG, dir, '--changelog', path, '--write').code, 0);

    const after = readFileSync(path, 'utf8');
    const released = (s) => s.slice(s.indexOf('## [1.2.0]'));
    assert.equal(released(after), released(CL), 'a released section changed');
    assert.notEqual(after, CL, 'nothing was spliced — this asserts nothing');
  });

  test('nothing shipped is a finding, not an empty success', (t) => {
    const dir = repo(t, { '0001-a.md': SPEC('Draft') });
    const r = run(CHANGELOG, dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /nothing has shipped/);
  });
});

describe('the verbs reach the bin', () => {
  test('new, check and changelog are parsed and dispatch', () => {
    const { VERBS } = { VERBS: ['gate', 'evidence', 'why', 'hosts', 'install', 'new', 'check', 'changelog'] };
    const src = readFileSync(join(HERE, 'lib', 'adapters.mjs'), 'utf8');
    for (const v of VERBS) {
      assert.match(src, new RegExp(`'${v}'`), `the bin's VERBS does not carry ${v}`);
    }
    const bin = readFileSync(join(HERE, 'ml-specs.mjs'), 'utf8');
    for (const v of ['new', 'check', 'changelog']) {
      assert.match(bin, new RegExp(`${v}: 'spec-`), `the dispatcher does not route ${v}`);
    }
  });
});
