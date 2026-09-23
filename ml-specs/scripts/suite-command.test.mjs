// The §6.1 command, and the shell it used to reach unseen.
//
// WHY THIS FILE EXISTS
//
// `spec-gate.mjs --run-suite` runs `$SHELL -c <cmd>` where `<cmd>` is the first backticked span on
// a `/full suite\s*:/i` line in a spec — a Markdown file a contributor writes. Security review
// reproduced the consequence: a §6.1 reading ``Full suite: `true; echo pwned > …/pwned.txt` ``
// executed the chained command and the gate reported `✓ PASS suite-green`. The code above the
// call already claimed two controls, and one of them — "the command is printed in the verdict
// rather than run silently" — described nothing that existed: the string reached the reader in the
// verdict, after it had run.
//
// WHAT THESE TESTS ASSERT, AND THE TWO PLACES THE OBVIOUS TEST IS WORTHLESS
//
// 1. **A refusal is proved by a SIDE EFFECT, not by a verdict string.** Asserting that a dangerous
//    §6.1 reads MANUAL passes just as happily against a gate that runs the command and then reports
//    MANUAL anyway. So the refusal fixtures point at commands whose only job is to create a file,
//    and the assertion is that no file exists.
// 2. **The printing is about ORDERING, not presence.** A line emitted after the suite finishes is
//    the bug. So the gate's stderr and the suite's own output are appended to one shared log and
//    the assertion is on their positions in it.
//
// And the third, which is not about the attack at all: the allowlist has to accept every command
// this repo's own specs already name, including the parenthesised one. A guard that refuses a real
// suite command is a guard people route around, after which nothing is checked.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, openSync, closeSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));   // ml-specs/scripts/
const GATE = join(HERE, 'spec-gate.mjs');
const ADVANCE = join(HERE, 'spec-advance.mjs');
const REPO = dirname(dirname(HERE));                    // the repo root
const SRC = readFileSync(GATE, 'utf8');
const TICK = String.fromCharCode(96);

// ---------------------------------------------------------------------------- the predicate

/**
 * The source of `suiteShellSafe`, lifted out of the CLI it lives in — const and function, as
 * written.
 *
 * `spec-gate.mjs` is a script, not a module: importing it gates a spec and calls `process.exit`,
 * so the predicate cannot be imported. The alternative to lifting the real source is restating the
 * character class here in the test's own words, and a second copy would keep passing while the
 * shipped one was wrong — the failure `lib/comment-text.mjs:87-105` records. If the names below
 * move, this throws, which is a red test rather than a silent one.
 */
function liftedSource() {
  const start = SRC.indexOf('const SUITE_FORBIDDEN');
  const decl = SRC.indexOf('function suiteShellSafe', start);
  assert.ok(start !== -1 && decl !== -1, 'spec-gate.mjs no longer declares SUITE_FORBIDDEN / suiteShellSafe');
  const end = SRC.indexOf('\n}\n', decl);
  assert.ok(end !== -1, 'could not find the end of suiteShellSafe');
  return SRC.slice(start, end + 2);
}

// eslint-disable-next-line no-new-func -- the real source, evaluated; see liftedSource() above
const safe = new Function(`${liftedSource()}\nreturn suiteShellSafe;`)();

/** Every §6.1 command this repo's specs name today, read the way `suiteCommand()` reads them. */
function repoSuiteCommands() {
  const out = new Map();
  for (const dir of ['specs', 'specs/archive']) {
    const abs = join(REPO, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      if (!name.endsWith('.md')) continue;
      const body = readFileSync(join(abs, name), 'utf8');
      const line = body.split('\n').find((l) => /^\s*[-*]?\s*full suite\s*:/i.test(l));
      if (!line) continue;
      const cmd = (line.match(/`([^`]+)`/) ?? [])[1];
      if (!cmd) continue;
      const clean = cmd.trim();
      // The template's own placeholder is not a command, and the gate does not run it either.
      if (clean.startsWith('<') || /^e\.g\./i.test(clean)) continue;
      out.set(`${dir}/${name}`, clean);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------- the fixture

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
  `- Full suite: ${TICK}${suite}${TICK}`,
  '',
  '## 8. Open questions',
  'None blocking.',
  '',
].join('\n');

/** A throwaway repo whose §6.1 names `suite`. */
function repo(t, suite) {
  const dir = mkdtempSync(join(tmpdir(), 'mlspecs-0027-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'specs'), { recursive: true });
  mkdirSync(join(dir, 'test'), { recursive: true });
  writeFileSync(join(dir, 'specs', '0001-a.md'), SPEC(suite));
  writeFileSync(join(dir, 'test', 'a.test.mjs'), '// proves AC1\n');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

/** Run the real gate over that repo, keeping stdout and stderr apart. */
function gate(dir, { stderrTo = null } = {}) {
  const r = spawnSync(
    process.execPath,
    [GATE, 'specs/0001-a.md', '--root', dir, '--to', 'Verified', '--json', '--run-suite'],
    { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', stderrTo ?? 'pipe'] },
  );
  const report = JSON.parse(r.stdout);
  return { report, stderr: r.stderr, suite: report.gates.find((g) => g.name === 'suite-green') };
}

// ---------------------------------------------------------------------------- AC5

describe('AC5 — the predicate executes nothing', () => {
  test('suiteShellSafe holds no way to run a process', () => {
    const src = liftedSource();
    // Structural, and deliberately so: a predicate that can run a command is the bug wearing the
    // fix's clothes. Nothing about the function's answers would notice.
    for (const forbidden of ['execFileSync', 'execSync', 'spawnSync', 'spawn(', 'exec(', 'child_process']) {
      assert.ok(!src.includes(forbidden), `suiteShellSafe reaches for ${forbidden}`);
    }
  });

  test('it answers with a verdict and nothing else', () => {
    assert.deepEqual(safe('npm test'), { ok: true });
    assert.deepEqual(safe('true; echo x'), { ok: false, found: ';' });
  });
});

// ---------------------------------------------------------------------------- AC1, AC2

describe('AC1, AC2 — the metacharacters that refuse a command', () => {
  const REFUSED = [
    // A glob is the one exclusion a review had to find, and it was unguarded for a full round:
    // re-adding `*` to the class left 640/640 green. The capability it grants is different in
    // kind from the accepted `&&` residual — a FILENAME becomes an argv option, so the string the
    // operator reads (`node *`) does not contain what runs.
    ['a glob turns a filename into an argument', 'node *', '*'],
    ['a semicolon chains a second command', 'true; echo pwned', ';'],
    ['a pipe', 'npm test | tee log', '|'],
    ['command substitution', 'npm test $(whoami)', '$'],
    ['a braced variable', 'npm test ${HOME}', '$'],
    ['a bare variable', 'npm test $HOME', '$'],
    ['a backtick', `npm test ${TICK}whoami${TICK}`, TICK],
    ['output redirection', 'npm test > /tmp/out', '>'],
    ['input redirection', 'npm test < /tmp/in', '<'],
    ['a single & backgrounds the suite instead of waiting for it', 'npm test & echo done', '&'],
    ['a trailing single &', 'npm test &', '&'],
    ['a newline is not whitespace here', 'npm test\necho pwned', '\n'],
    ['a carriage return', 'npm test\recho pwned', '\r'],
    ['a backslash escape', 'npm test \\; echo x', '\\'],
    ['brace expansion', 'npm test {a,b}', '{'],
    ['a bang', 'npm test !!', '!'],
    ['a hash', 'npm test # comment', '#'],
  ];

  for (const [why, cmd, found] of REFUSED) {
    test(`refused — ${why}`, () => {
      assert.deepEqual(safe(cmd), { ok: false, found }, `${JSON.stringify(cmd)} was not refused`);
    });
  }

  test('&& is sequencing and survives; &&& does not', () => {
    assert.deepEqual(safe('a && b'), { ok: true });
    assert.deepEqual(safe('a &&& b'), { ok: false, found: '&' });
  });

  test('THE FINDING — a refused command leaves no trace, which is the only proof that counts', (t) => {
    // Asserting the MANUAL verdict alone would pass against a gate that ran this and then reported
    // MANUAL anyway. The file is the assertion.
    const dir = repo(t, 'true; echo pwned');
    const pwned = join(dir, 'pwned.txt');
    writeFileSync(join(dir, 'specs', '0001-a.md'), SPEC(`true; echo pwned > ${pwned}`));
    const { suite } = gate(dir);
    assert.equal(existsSync(pwned), false, 'the gate executed a §6.1 it was supposed to refuse');
    assert.equal(suite.verdict, 'MANUAL');
    assert.match(suite.detail, /was not run/);
    assert.match(suite.detail, /";"/, 'the verdict should name the character that refused it');
  });

  test('THE FINDING, by substitution — `$(…)` never reaches a shell either', (t) => {
    const dir = repo(t, 'x');
    const pwned = join(dir, 'pwned.txt');
    writeFileSync(join(dir, 'specs', '0001-a.md'), SPEC(`echo $(touch ${pwned})`));
    const { suite } = gate(dir);
    assert.equal(existsSync(pwned), false, 'command substitution was executed');
    assert.equal(suite.verdict, 'MANUAL');
    assert.match(suite.detail, /"\$"/);
  });
});

// ---------------------------------------------------------------------------- AC3

describe('AC3 — every suite command this repo already names still runs', () => {
  // A fix that makes existing specs unrunnable is one people route around. These are literal
  // because they are the regression: the allowlist as first drafted refused the fourth.
  const ACCEPTED = [
    'npm test',
    'cd ml-specs && npm test',
    'npm test && npm run test:e2e',
    'node scripts/validate-plugin.mjs && cd ml-specs && npm test',
    'node scripts/validate-plugin.mjs && (cd ml-specs && npm test)',
    'pytest && pytest -m e2e',
    'mvn verify',
    'go test ./...',
    "node -e 'process.exit(0)'",
  ];

  for (const cmd of ACCEPTED) {
    test(`accepted — ${cmd}`, () => {
      assert.deepEqual(safe(cmd), { ok: true }, `${JSON.stringify(cmd)} would be refused`);
    });
  }

  test('and every §6.1 on disk in this repo today', () => {
    const found = repoSuiteCommands();
    assert.ok(found.size >= 10, `only ${found.size} §6.1 command(s) found — the scan has stopped seeing them`);
    for (const [file, cmd] of found) {
      assert.deepEqual(safe(cmd), { ok: true }, `${file} names a §6.1 this gate would refuse: ${cmd}`);
    }
  });

  test('an accepted parenthesised command really does reach the shell', (t) => {
    // The predicate saying yes is not the same as the gate running it. Grouping is the case
    // revision 3 exists for, so it is proved end to end and not by the character class alone.
    const dir = repo(t, '(cd test && node -e 0)');
    const { suite, stderr } = gate(dir);
    assert.match(stderr, /\(cd test && node -e 0\)/, 'the gate refused a grouped command');
    assert.equal(suite.verdict, 'PASS', suite.detail);
  });
});

// ---------------------------------------------------------------------------- AC4

describe('AC4 — the command is on stderr before it runs', () => {
  test('ORDERING — the gate says what it is about to run before the suite says anything', (t) => {
    const dir = repo(t, 'x');
    const log = join(dir, 'log.txt');
    // One log, two writers, both appending: the gate's stderr by file descriptor, the suite by its
    // own hand. Positions in that file are the ordering, and a line printed after the run — the
    // behaviour this spec replaces — lands the wrong way round.
    const cmd = `node -e "require('fs').appendFileSync('${log}', 'SUITE-RAN')"`;
    assert.deepEqual(safe(cmd), { ok: true }, 'the fixture path itself trips the allowlist');
    writeFileSync(join(dir, 'specs', '0001-a.md'), SPEC(cmd));

    const fd = openSync(log, 'a');
    let out;
    try {
      out = gate(dir, { stderrTo: fd });
    } finally {
      closeSync(fd);
    }
    const text = readFileSync(log, 'utf8');
    const announced = text.indexOf('running the §6.1 full suite');
    const ran = text.indexOf('SUITE-RAN');
    assert.notEqual(announced, -1, 'the gate never said what it was about to run');
    assert.notEqual(ran, -1, 'the suite never ran');
    assert.ok(announced < ran, `the command was announced after the suite ran:\n${text}`);
    assert.equal(out.suite.verdict, 'PASS', out.suite.detail);
  });

  test('the line carries the command verbatim, so the reader sees what the shell will see', (t) => {
    const dir = repo(t, "node -e 'process.exit(0)'");
    const { stderr } = gate(dir);
    assert.match(stderr, /spec-gate: running the §6\.1 full suite — node -e 'process\.exit\(0\)'/);
  });

  test('and stdout stays machine-readable — --json is still JSON', (t) => {
    // Forced, not chosen. `spec-advance.mjs` runs JSON.parse over this gate's stdout, so a line
    // printed there instead would break `spec-advance --run-suite`: the path this spec protects.
    const dir = repo(t, "node -e 'process.exit(0)'");
    const r = spawnSync(process.execPath,
      [GATE, 'specs/0001-a.md', '--root', dir, '--to', 'Verified', '--json', '--run-suite'],
      { cwd: dir, encoding: 'utf8' });
    const parsed = JSON.parse(r.stdout);            // throws if the announcement leaked to stdout
    assert.equal(parsed.spec, 'specs/0001-a.md');
    assert.doesNotMatch(r.stdout, /running the §6\.1 full suite/);
    assert.match(r.stderr, /running the §6\.1 full suite/);
  });

  test('a refused command announces nothing, because nothing is about to run', (t) => {
    const dir = repo(t, 'true; echo x');
    const { stderr } = gate(dir);
    assert.doesNotMatch(stderr, /running the §6\.1 full suite/);
  });
});

// ---------------------------------------------------------------------------- AC6

describe('AC6 — refused is MANUAL, and no record claims the suite passed', () => {
  test('MANUAL, not FAIL — nobody ran it, so it did not fail', (t) => {
    const dir = repo(t, 'true; echo pwned');
    const { suite, report } = gate(dir);
    assert.equal(suite.verdict, 'MANUAL');
    assert.notEqual(suite.verdict, 'FAIL', 'a command nobody ran cannot be a red suite');
    assert.equal(report.ok, true, 'a refusal is a judgement to make, not a mechanical failure');
  });

  test('the evidence record records the refusal, never a pass', (t) => {
    const dir = repo(t, 'true; echo pwned');
    // Read the gate's own wording BEFORE advancing: afterwards the spec holds Verified, so the gate
    // refuses on lifecycle and never reaches suite-green at all.
    const detail = gate(dir).suite.detail;
    const r = spawnSync(process.execPath,
      [ADVANCE, 'specs/0001-a.md', '--root', dir, '--to', 'Verified', '--run-suite', '--json',
        '--attest', 'I ran the suite myself and read every criterion against the diff'],
      { cwd: dir, encoding: 'utf8' });
    const out = JSON.parse(r.stdout);
    assert.ok(out.record, `the transition wrote no record: ${r.stdout}${r.stderr}`);
    const rec = JSON.parse(readFileSync(join(dir, out.record), 'utf8'));
    const suite = rec.gates.find((g) => g.name === 'suite-green');
    assert.equal(suite.verdict, 'MANUAL', 'the record claims a suite verdict nobody produced');
    // The record carries `{name, verdict}` and nothing else — `lib/evidence.mjs` drops `detail` on
    // purpose, because those strings hold counts and paths that move for reasons that are not
    // tampering. So the "was not run" wording is asserted on the GATE, which is where it is said.
    assert.ok(!('detail' in suite), 'records are id-and-verdict only; detail belongs to the gate');
    assert.match(detail, /was not run/);
  });

  test('and without an attestation the transition is refused outright', (t) => {
    const dir = repo(t, 'true; echo pwned');
    const r = spawnSync(process.execPath,
      [ADVANCE, 'specs/0001-a.md', '--root', dir, '--to', 'Verified', '--run-suite'],
      { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(`${r.stdout}${r.stderr}`, /need a human judgement/);
    assert.equal(existsSync(join(dir, '.ml-specs')), false, 'a refused transition wrote a record');
  });
});

// ---------------------------------------------------------------------------- AC7

describe('AC7 — the comment describes controls the code actually has', () => {
  const block = SRC.slice(SRC.indexOf('// `--run-suite` turns the one MANUAL gate'), SRC.indexOf('const cmd = RUN_SUITE'));

  test('it no longer claims the command is printed in the verdict', () => {
    assert.notEqual(block, '', 'the --run-suite comment block has moved');
    assert.doesNotMatch(block, /printed in the verdict/,
      'the comment claims a control that never existed — the string reached the reader after the run');
  });

  test('and every control it names is in the code below it', () => {
    // Whitespace-collapsed and comment markers stripped: this is wrapped prose, and a claim that
    // survives re-wrapping at a different column is the only kind worth asserting on. The first
    // version matched the raw slice and failed on "It never runs unless the\n  // flag is typed".
    const flat = block.replace(/^\s*\/\/ ?/gm, '').replace(/\s+/g, ' ');
    assert.match(flat, /never runs unless the flag is typed/);
    assert.match(flat, /suiteShellSafe/);
    assert.match(flat, /stderr/);
    const announce = SRC.indexOf('console.error(`spec-gate: running the §6.1 full suite');
    // Anchored on the shell invocation itself rather than on which shell. The first version
    // searched for `process.env.SHELL`, and pinning the shell to /bin/sh moved the anchor —
    // indexOf returned -1 and the ordering check silently compared against it.
    // Pinned to `/bin/sh` SPECIFICALLY. An earlier version of this line matched either shell, so
    // reverting the pin stayed green — and the pin is the only thing stopping zsh `=(…)` process
    // substitution, which uses nothing but allowlisted characters. Demonstrated in review.
    assert.doesNotMatch(SRC, /execFileSync\(\s*process\.env\.SHELL/,
      'the suite runs under $SHELL again — zsh =(…) substitutes using only allowlisted characters');
    const run = SRC.search(/execFileSync\(\s*['"`]\/bin\/sh/);
    assert.notEqual(run, -1, 'the suite is no longer run through a shell — this check has moved');
    assert.ok(announce !== -1 && run !== -1 && announce < run,
      'the gate does not write the command to stderr before running it');
  });
});

describe('AC4 — the disclosure survives the path the toolkit recommends', () => {
  test('spec-advance --run-suite shows the command, not just spec-gate', (t) => {
    // Revision 4's headline fix, and it had no coverage: `spec-advance.mjs` spawned the gate with
    // stderr PIPED and dropped it on success, so the one control that lets an operator see the
    // command reached nobody on exactly the path `commands/spec-advance.md` recommends and
    // `spec-why.mjs` instructs. Reverting `'inherit'` to `'pipe'` left the whole suite green.
    //
    // Asserted through spec-advance rather than the gate, because the gate was never the broken
    // half — testing it again would have passed while the real path stayed dark.
    const dir = repo(t, 'true');
    const r = spawnSync(process.execPath,
      [ADVANCE, 'specs/0001-a.md', '--root', dir, '--to', 'Verified', '--run-suite',
        '--attest', 'I ran the suite myself and read every criterion against the diff'],
      { cwd: dir, encoding: 'utf8' });

    assert.equal(r.status, 0, `the transition failed: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /running the §6\.1 full suite — true/,
      'spec-advance swallowed the gate stderr — the operator never sees what is about to run');
    // And stdout stays parseable, which is why the line went to stderr in the first place.
    assert.doesNotMatch(r.stdout, /running the §6\.1 full suite/,
      'the disclosure leaked into stdout, where --json would corrupt the payload spec-advance parses');
  });
});

describe('AC1 — the glob bypass, proved by side effect', () => {
  test('a filename cannot become an argv option', (t) => {
    // The bypass a review demonstrated, pinned the way it was found rather than the way it is
    // spelled. `node *` in a tree holding a file named `--eval=require("fs").writeFileSync(…)`
    // ran arbitrary JS and the gate reported PASS, while the operator had been shown `node *`.
    //
    // A predicate test would not have caught what made this different from `&&`: the capability
    // comes from the FILENAME, so nothing in the string the operator reads discloses it. Both
    // halves are attacker-controlled — the same branch supplies the spec and the tree.
    const dir = repo(t, 'node *');
    const bomb = '--eval=require("fs").writeFileSync("GLOBBED.txt","owned")';
    writeFileSync(join(dir, bomb), '');

    const { suite } = gate(dir);
    // The side effect is asserted FIRST. Both assertions fire on a regression, and whichever runs
    // first is the one whose message a reader sees; `'PASS' !== 'MANUAL'` says a verdict is wrong,
    // while this one says arbitrary JS ran. The header above argues the file is the only proof
    // that counts, so it should also be the sentence the failure prints.
    assert.ok(!existsSync(join(dir, 'GLOBBED.txt')),
      'the glob expanded and a filename executed as an argument — the operator saw only `node *`');
    assert.equal(suite.verdict, 'MANUAL', `the gate ran a glob: ${suite.detail}`);
  });
});

describe('the refusal names what the gate accepts, and is derived from it', () => {
  test('every character the refusal advertises is one the predicate takes', (t) => {
    // The message listed `*` among the characters the gate accepts, inside the message refusing
    // `*`: the character left the class and the hand-written sentence beside it did not. That fix
    // shipped with no guard, so it could drift back the same way — the `--all` flag defect, which
    // is the same class, has had a test since spec 0025.
    //
    // Read out of the RUNNING gate, not out of the source, so re-introducing a literal list is
    // caught too: what is asserted is the sentence an operator is actually shown.
    const dir = repo(t, 'npm test; echo pwned');
    const { suite } = gate(dir);
    assert.equal(suite.verdict, 'MANUAL', `the fixture was not refused, so this asserts nothing: ${suite.detail}`);

    const spans = [...suite.detail.matchAll(new RegExp(`${TICK}([^${TICK}]*)${TICK}`, 'g'))].map((m) => m[1]);
    const advertised = (spans[1] ?? '').split(' ').filter(Boolean);
    assert.ok(advertised.length > 3, `the refusal no longer says what it accepts: ${suite.detail}`);

    for (const c of advertised) {
      // `&` is the one character legal only in a pair, and the message says so; probe it as `&&`
      // rather than alone, or this would assert the opposite of the lone-`&` rule.
      const probe = c === '&' ? 'a && b' : `npm test ${c}`;
      assert.deepEqual(safe(probe), { ok: true },
        `the refusal offers ${JSON.stringify(c)} as accepted, and the gate refuses it`);
    }
    assert.ok(!advertised.includes('*'),
      'the refusal is back to offering a glob — the character the gate stopped accepting');
  });
});

describe('AC9 — the flag is documented where it is recommended', () => {
  test('commands/spec-advance.md says the command is shown and a metacharacter is refused', () => {
    // AC9 exists because §2 listed this bullet and it shipped undone — nothing checked it. A
    // criterion with no test is the same bullet one level up, so this is the test that stops the
    // paragraph being deleted silently.
    const doc = readFileSync(join(HERE, '..', 'commands', 'spec-advance.md'), 'utf8').replace(/\s+/g, ' ');
    const section = doc.slice(doc.indexOf('`--run-suite` turns'), doc.indexOf('`--attest` is where'));
    assert.ok(section.length > 0, 'the --run-suite section of spec-advance.md has moved');
    assert.match(section, /printed to stderr before it runs/i,
      'the doc does not tell the operator the command is shown before it runs');
    // Anchored to the clause, not to the word. `MANUAL` also appears two paragraphs up in the
    // unrelated exit-127 note, inside this same slice — so a bare /MANUAL/ stayed green with the
    // refusal's own "reports MANUAL" clause deleted. Measured, in the round that added this test:
    // 45/45 with the sentence rewritten to "and declines it".
    assert.match(section, /refuses anything carrying a shell metacharacter[\s\S]{0,200}?MANUAL/i,
      'the doc no longer says a refused command reports MANUAL — an operator would expect a red suite');
    // The control a security review accepted in place of an env opt-in for `--run-suite`. Every
    // control in this spec assumes a human reading a terminal, and CI has no such reader; the
    // warning was the whole basis of the `clear` verdict and it had no test either.
    assert.match(section, /untrusted branches/i,
      'the doc no longer warns against wiring --run-suite into CI on untrusted branches');
  });
});
