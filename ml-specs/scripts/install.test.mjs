// Spec 0028 — the install, driven end to end through the real bin.
//
// EVERY TEST HERE SPAWNS THE BIN over a mkdtemp repo and asserts on FILES ON DISK, never on a
// returned plan. Two of them matter more than the rest for that reason:
//
//   AC5 compares BYTES before and after. Asserting the report says "skipped" passes just as
//   happily against an installer that overwrites the file and then reports skipped — the rule
//   `suite-command.test.mjs:14-18` already records for this repo.
//   AC9 snapshots the whole tree. Same reason: "would write" is a string.
//
// HOME is injected on every spawn. Nothing in this file may read the developer's real home — a
// test that writes there is a test nobody can run twice.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, rmSync,
  symlinkSync, lstatSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOSTS, installableIds, hostIds } from './lib/hosts.mjs';
import { pointers, buildCanonical } from './lib/adapters.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, 'ml-specs.mjs');
const GATE = join(HERE, 'spec-gate.mjs');

/** A throwaway repo plus a throwaway home, and never the real one. */
function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'mlspecs-install-'));
  const home = mkdtempSync(join(tmpdir(), 'mlspecs-home-'));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); });
  return { dir, home };
}

const run = (dir, home, ...args) => {
  // `env` may carry ML_SPECS_TEMPLATE — the refusal path's test seam. It is an env var rather
  // than a `--template` flag because a flag in a PUBLISHED bin is an undocumented arbitrary-file
  // read: any path, written into ML-SPECS.md.
  let env = { ...process.env, HOME: home };
  if (args[0] && typeof args[0] === 'object') { env = { ...env, ...args.shift() }; }
  const r = spawnSync(process.execPath, [BIN, ...args, '--root', dir], { cwd: dir, encoding: 'utf8', env });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, stdout: r.stdout || '' };
};

/** Every file under a root, as relative paths, sorted. The snapshot AC9 compares. */
function tree(root) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p); else out.push(relative(root, p));
    }
  };
  if (existsSync(root)) walk(root);
  return out.sort();
}

describe('AC4 — install --host all', () => {
  test('a file lands at every installable host target, and nothing for claude-code', (t) => {
    const { dir, home } = sandbox(t);
    const r = run(dir, home, 'install', '--host', 'all');
    assert.equal(r.code, 0, r.out);

    for (const id of installableIds()) {
      const target = join(dir, HOSTS[id].project);
      assert.ok(existsSync(target), `${id}: nothing at ${HOSTS[id].project}`);
    }
    assert.ok(!existsSync(join(dir, '.claude')),
      'a shim was written for claude-code, which the plugin serves — spec 0028 §2, first non-goal');
    assert.match(r.out, /claude-code: served by the plugin/);
  });

  test('the shared target is written once, and its sharers are derived from the registry', (t) => {
    const { dir, home } = sandbox(t);
    const r = run(dir, home, 'install', '--host', 'all');

    const sharers = installableIds().filter((id) => HOSTS[id].project === 'AGENTS.md');
    assert.ok(sharers.length > 1, 'no shared target in the registry — this asserts nothing');
    // Derived, not "five": adding a host that reads AGENTS.md should be a registry edit, not a
    // test failure.
    for (const id of sharers) assert.match(r.out, new RegExp(`shared by[^\\n]*${id}`));

    const files = tree(dir).filter((f) => f.toUpperCase().endsWith('AGENTS.MD'));
    assert.deepEqual(files, ['AGENTS.md'], 'the shared target was written more than once');
  });

  test('the host count counts hosts, not files', (t) => {
    // Five hosts collapse into one AGENTS.md. An earlier pass deduped by skipping the later ones,
    // which reported 11 hosts where there are 15 and recorded only 11 in .ml-specs.json.
    const { dir, home } = sandbox(t);
    const r = run(dir, home, 'install', '--host', 'all');
    assert.match(r.out, new RegExp(`for ${installableIds().length} host\\(s\\)`), r.out);

    const cfg = JSON.parse(readFileSync(join(dir, '.ml-specs.json'), 'utf8'));
    assert.deepEqual([...cfg.hosts].sort(), [...installableIds()].sort(),
      'the config under-records the hosts that share a file');
  });
});

describe('AC5 — a file we did not write is not ours to rewrite', () => {
  test('a foreign target is left byte-identical and the run reports a finding', (t) => {
    const { dir, home } = sandbox(t);
    const mine = '# My own AGENTS.md\n\nHand-written. Do not touch.\n';
    writeFileSync(join(dir, 'AGENTS.md'), mine);

    const r = run(dir, home, 'install', '--host', 'all');

    // Bytes, not the report. The report is a string an overwriting installer can also print.
    assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), mine, 'a user file was overwritten');
    assert.equal(r.code, 1, 'a refusal is a finding, per docs/PATTERNS.md:95-102');
    assert.match(r.out, /left alone/);
  });

  test('a banner from a NEWER contract version is also foreign', (t) => {
    const { dir, home } = sandbox(t);
    const future = '<!-- ml-specs install v99 — do not edit; edit ML-SPECS.md -->\nfrom the future\n';
    writeFileSync(join(dir, 'AGENTS.md'), future);
    const r = run(dir, home, 'install', '--host', 'all');
    assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), future,
      'a file from a contract version this build does not understand was rewritten anyway');
    assert.equal(r.code, 1);
  });

  test('but our own current file is rewritten in place, and the run is clean', (t) => {
    const { dir, home } = sandbox(t);
    assert.equal(run(dir, home, 'install', '--host', 'all').code, 0);
    const second = run(dir, home, 'install', '--host', 'all');
    assert.equal(second.code, 0, `a second install reported a finding:\n${second.out}`);
  });
});

describe('AC6 — detection is an OR of two signals, so each gets its own control', () => {
  test('config directory only → detected', (t) => {
    const { dir, home } = sandbox(t);
    mkdirSync(join(dir, '.cursor'), { recursive: true });
    const j = JSON.parse(run(dir, home, 'hosts', '--json').stdout);
    const cursor = j.hosts.find((h) => h.id === 'cursor');
    assert.equal(cursor.signals.dirs, true);
    assert.equal(cursor.detected, true, 'a project configured for a host whose binary is elsewhere');
  });

  test('binary on PATH only → detected', (t) => {
    const { dir, home } = sandbox(t);
    const bin = mkdtempSync(join(tmpdir(), 'mlspecs-path-'));
    t.after(() => rmSync(bin, { recursive: true, force: true }));
    writeFileSync(join(bin, 'cursor-agent'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

    const r = spawnSync(process.execPath, [BIN, 'hosts', '--json', '--root', dir], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: home, PATH: bin },
    });
    const cursor = JSON.parse(r.stdout).hosts.find((h) => h.id === 'cursor');
    assert.equal(cursor.signals.binary, true);
    assert.equal(cursor.detected, true);
    // And the other signal really is off, or this test is passing for the wrong reason.
    assert.equal(cursor.signals.dirs, false);
  });

  test('neither signal → not detected', (t) => {
    const { dir, home } = sandbox(t);
    const empty = mkdtempSync(join(tmpdir(), 'mlspecs-empty-'));
    t.after(() => rmSync(empty, { recursive: true, force: true }));
    const r = spawnSync(process.execPath, [BIN, 'hosts', '--json', '--root', dir], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: home, PATH: empty },
    });
    const cursor = JSON.parse(r.stdout).hosts.find((h) => h.id === 'cursor');
    assert.equal(cursor.detected, false, 'a detector that returns a constant passes the other two');
  });
});

describe('AC9 — --dry-run writes nothing', () => {
  test('the tree is identical before and after', (t) => {
    const { dir, home } = sandbox(t);
    writeFileSync(join(dir, 'README.md'), '# hi\n');
    const before = tree(dir);

    const r = run(dir, home, 'install', '--host', 'all', '--dry-run');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(tree(dir), before, '--dry-run touched the tree');
    assert.deepEqual(tree(home), [], '--dry-run touched the home directory');
    assert.match(r.out, /would write \d+ file\(s\)/);
  });
});

describe('AC11 — every shim points at a document that is there', () => {
  test('one pointer per shim, and the path it names exists', (t) => {
    const { dir, home } = sandbox(t);
    assert.equal(run(dir, home, 'install', '--host', 'all').code, 0);

    let checked = 0;
    for (const rel of tree(dir)) {
      if (rel === '.ml-specs.json' || rel.startsWith('.ml-specs/')) continue;
      const found = pointers(readFileSync(join(dir, rel), 'utf8'));
      assert.equal(found.length, 1, `${rel}: ${found.length} pointer(s), want exactly 1`);
      assert.ok(existsSync(join(dir, found[0])), `${rel} points at ${found[0]}, which does not exist`);
      checked++;
    }
    assert.ok(checked > 0, 'no shims were examined — this asserts nothing');
  });

  test('and it is the canonical document that was written, not some other file', (t) => {
    const { dir, home } = sandbox(t);
    run(dir, home, 'install', '--host', 'all');
    const doc = readFileSync(join(dir, '.ml-specs', 'ML-SPECS.md'), 'utf8');
    const target = pointers(readFileSync(join(dir, 'AGENTS.md'), 'utf8'))[0];
    assert.equal(readFileSync(join(dir, target), 'utf8'), doc);
    assert.match(doc, /Draft.*Approved.*Implemented.*Verified.*Archived/s);
  });
});

describe('AC13 — an unverified host says so', () => {
  test('the warning names the host and its vendor; a verified one is silent', (t) => {
    const { dir, home } = sandbox(t);
    const r = run(dir, home, 'install', '--host', 'cursor');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /cursor: unverified/);
    assert.match(r.out, /Anysphere/, 'the warning does not say whose documentation it came from');
    // The negative half: the one verified row is also the one that is never installed, so the
    // absence has to be checked somewhere the warning could have appeared.
    assert.doesNotMatch(r.out, /claude-code: unverified/);
  });
});

describe('AC15 — user scope is self-contained, and stays inside the injected home', () => {
  test('shims and their own document land under HOME, and nothing lands outside it', (t) => {
    const { dir, home } = sandbox(t);
    const before = tree(dir);

    const r = run(dir, home, 'install', '--host', 'cursor', '--scope', 'user');
    assert.equal(r.code, 0, r.out);

    assert.ok(existsSync(join(home, '.cursor', 'rules', 'ml-specs.mdc')), 'no shim under the home');
    assert.ok(existsSync(join(home, '.ml-specs', 'ML-SPECS.md')),
      'user scope wrote no document of its own — its pointer would dangle in every other directory');
    assert.deepEqual(tree(dir), before, 'a user-scope install wrote into the repository');
  });

  test('the pointer is absolute and resolves', (t) => {
    const { dir, home } = sandbox(t);
    run(dir, home, 'install', '--host', 'cursor', '--scope', 'user');
    const p = pointers(readFileSync(join(home, '.cursor', 'rules', 'ml-specs.mdc'), 'utf8'))[0];
    assert.ok(p.startsWith('/'), `user-scope pointer is relative: ${p}`);
    assert.ok(existsSync(p));
  });

  test('a host with no user scope is refused, naming the host — could-not-run, not a finding', (t) => {
    const { dir, home } = sandbox(t);
    const r = run(dir, home, 'install', '--host', 'zed', '--scope', 'user');
    assert.equal(r.code, 2, 'there is no user scope to evaluate, so the question could not be put');
    assert.match(r.out, /zed has no user scope/);
  });

  test('an unrecognised scope is could-not-run', (t) => {
    const { dir, home } = sandbox(t);
    const r = run(dir, home, 'install', '--host', 'cursor', '--scope', 'global');
    assert.equal(r.code, 2);
    assert.match(r.out, /--scope must be project or user/);
  });
});

describe('AC17 — the report', () => {
  test('claude-code is reported as served by the plugin, every other row carries detection', (t) => {
    const { dir, home } = sandbox(t);
    const j = JSON.parse(run(dir, home, 'hosts', '--json').stdout);
    assert.equal(j.hosts.length, hostIds().length);

    const claude = j.hosts.find((h) => h.id === 'claude-code');
    assert.equal(claude.servedBy, 'plugin');
    assert.ok(claude.verifiedBy, 'the one verified row does not say how');

    for (const row of j.hosts) {
      assert.equal(typeof row.detected, 'boolean');
      assert.equal(typeof row.verified, 'boolean');
      assert.equal(row.verified, Boolean(row.verifiedBy), `${row.id}: verified and verifiedBy disagree`);
    }
  });

  test('installed is recorded, not guessed', (t) => {
    const { dir, home } = sandbox(t);
    const before = JSON.parse(run(dir, home, 'hosts', '--json').stdout);
    assert.equal(before.hosts.find((h) => h.id === 'cursor').installed, false);

    run(dir, home, 'install', '--host', 'cursor');
    const after = JSON.parse(run(dir, home, 'hosts', '--json').stdout);
    assert.equal(after.hosts.find((h) => h.id === 'cursor').installed, true);
    assert.equal(after.hosts.find((h) => h.id === 'roo').installed, false);
  });

  test('drift between a project and a user document is reported', (t) => {
    const { dir, home } = sandbox(t);
    // Asserted, not discarded: a child that failed for an environmental reason used to surface
    // as a confusing drift assertion instead of as a failed install.
    assert.equal(run(dir, home, 'install', '--host', 'cursor').code, 0);
    assert.equal(run(dir, home, 'install', '--host', 'cursor', '--scope', 'user').code, 0);

    let j = JSON.parse(run(dir, home, 'hosts', '--json').stdout);
    assert.equal(j.drift, null, 'two identical documents were reported as drift');

    writeFileSync(join(home, '.ml-specs', 'ML-SPECS.md'), 'edited by hand\n');
    j = JSON.parse(run(dir, home, 'hosts', '--json').stdout);
    assert.ok(j.drift, 'the two documents differ and nothing said so');
    assert.match(run(dir, home, 'hosts').out, /drift:/);
  });
});

describe('AC8 — the bin runs the same gate the plugin does', () => {
  const SPEC = `# Spec: a thing

| | |
|---|---|
| **Status** |Draft|
| **Branch** | feat/thing |
| **Author** | Ada |

## 5. Acceptance criteria
- [x] **AC1** — it validates.

## 6. Test plan
| AC | Test file | What it proves |
|---|---|---|
| AC1 | \`test/thing.test.mjs\` | it validates |

## 8. Open questions
None blocking.
`;

  test('same spec, same report', (t) => {
    const { dir, home } = sandbox(t);
    mkdirSync(join(dir, 'specs'), { recursive: true });
    mkdirSync(join(dir, 'test'), { recursive: true });
    writeFileSync(join(dir, 'specs', '0001-thing.md'), SPEC);
    writeFileSync(join(dir, 'test', 'thing.test.mjs'), '// proves AC1\n');

    const env = { ...process.env, HOME: home, NO_COLOR: '1' };
    const viaBin = spawnSync(process.execPath, [BIN, 'gate', 'specs/0001-thing.md', '--to', 'Approved', '--root', dir], { cwd: dir, encoding: 'utf8', env });
    const direct = spawnSync(process.execPath, [GATE, 'specs/0001-thing.md', '--to', 'Approved', '--root', dir], { cwd: dir, encoding: 'utf8', env });

    // ANSI normalised away: `lib/cli.mjs:13` is `colours(enabled)`, a boolean parameter, so the
    // two call sites may legitimately differ in escape codes and in nothing else.
    const strip = (s) => (s || '').replace(/\x1b\[[0-9;]*m/g, '');
    assert.equal(strip(viaBin.stdout), strip(direct.stdout));
    assert.equal(viaBin.status, direct.status);
    assert.ok(strip(viaBin.stdout).length > 0, 'the gate printed nothing — this asserts nothing');
  });

  test('a delegated verb is spawned via node, so a 644 script still runs', (t) => {
    // `spec-evidence.mjs` is committed 100644. Executing it directly would fail on a fresh clone.
    const { dir, home } = sandbox(t);
    assert.ok(!(statSync(join(HERE, 'spec-evidence.mjs')).mode & 0o111),
      'spec-evidence.mjs became executable — this test no longer proves anything');
    const r = run(dir, home, 'evidence');
    assert.notEqual(r.code, 126, 'the dispatcher executed the script instead of spawning node');
  });
});

describe('usage', () => {
  test('no verb is could-not-run, and the message lists the verbs', (t) => {
    const { dir, home } = sandbox(t);
    const r = run(dir, home);
    assert.equal(r.code, 2);
    for (const v of ['gate', 'evidence', 'why', 'hosts', 'install']) assert.match(r.out, new RegExp(v));
  });

  test('install without --host is could-not-run', (t) => {
    const { dir, home } = sandbox(t);
    const r = run(dir, home, 'install');
    assert.equal(r.code, 2);
    assert.match(r.out, /needs --host/);
  });

  test('install --host claude-code is a refusal, not a crash', (t) => {
    const { dir, home } = sandbox(t);
    const r = run(dir, home, 'install', '--host', 'claude-code');
    assert.equal(r.code, 1, 'asking for something we decline by design is a finding, not could-not-run');
    assert.match(r.out, /served by the plugin/);
    assert.deepEqual(tree(dir), [], 'a refusal still wrote something');
  });
});

// ── the controls the first VERIFY pass found untested ────────────────────────────────────────
//
// Each of the four below measured ZERO net failures when its control was deleted. The refusal
// scan, in particular, could be removed entirely and the suite stayed green: the 15 failures a
// poisoned template produced were COLLATERAL — install exits 1 and every unrelated
// `assert.equal(r.code, 0)` breaks — which vanishes the moment the refusal is what regressed.
// That is the difference between a test that notices and a test that happens to be downstream.

describe('AC7 — the refusal, end to end', () => {
  /** A template with one poisoned line, and an injection point to reach it. */
  function poisoned(t, line) {
    const dir = mkdtempSync(join(tmpdir(), 'mlspecs-poison-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'bad.template.md');
    writeFileSync(path, `---\nname: ml-specs\n---\n\n## Loop\n\nWrite the spec first.\n\n${line}\n`);
    return path;
  }

  const CASES = [
    ['a subagent dispatch', 'When it is ready, hand it to the reviewer agent.', 'subagent-dispatch'],
    ['a slash command', 'Then run /ml-specs:spec-build to implement it.', 'slash-command'],
    ['the plugin root', 'Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-gate.mjs`.', 'plugin-root'],
    ['an argument substitution', 'The spec is $ARGUMENTS.', 'arguments'],
    ['a hook instruction', 'The SessionStart hook resumes you.', 'hook'],
  ];

  for (const [what, line, rule] of CASES) {
    test(`${what}: exit 1, nothing written, and the message names the line`, (t) => {
      const { dir, home } = sandbox(t);
      const r = run(dir, home, { ML_SPECS_TEMPLATE: poisoned(t, line) }, 'install', '--host', 'all');

      assert.equal(r.code, 1, `expected a refusal (1), got ${r.code}:\n${r.out}`);
      assert.deepEqual(tree(dir), [], 'the install refused and wrote files anyway');
      assert.deepEqual(tree(home), [], 'the install refused and wrote into the home directory');
      assert.match(r.out, new RegExp(rule), `the message does not name the rule:\n${r.out}`);
      assert.match(r.out, /ML-SPECS\.md:\d+/, `the message does not name the line:\n${r.out}`);
      assert.match(r.out, /nothing was written/);
    });
  }

  test('a clean template through the same flag still installs — or the above proves nothing', (t) => {
    const { dir, home } = sandbox(t);
    const clean = join(HERE, '..', 'templates', 'ML-SPECS.template.md');
    const r = run(dir, home, { ML_SPECS_TEMPLATE: clean }, 'install', '--host', 'cursor');
    assert.equal(r.code, 0, r.out);
    assert.ok(tree(dir).length > 0);
  });
});

describe('AC3 — the document is written byte-identically', () => {
  test('what lands on disk is exactly what buildCanonical produced', (t) => {
    // The only guard here was a regex for the lifecycle string, which catches a stub and misses
    // truncation, corruption and anything appended.
    const { dir, home } = sandbox(t);
    assert.equal(run(dir, home, 'install', '--host', 'all').code, 0);

    const template = readFileSync(join(HERE, '..', 'templates', 'ML-SPECS.template.md'), 'utf8');
    const expected = buildCanonical(template);
    const actual = readFileSync(join(dir, '.ml-specs', 'ML-SPECS.md'), 'utf8');
    assert.equal(actual, expected, 'the written document is not byte-identical to the built one');
  });
});

describe('a symlink cannot carry a write out of the tree', () => {
  /** An outside directory the fixture must never reach. */
  function outside(t) {
    const d = mkdtempSync(join(tmpdir(), 'mlspecs-outside-'));
    t.after(() => rmSync(d, { recursive: true, force: true }));
    return d;
  }

  test('a symlinked host directory is refused, and the outside stays empty', (t) => {
    const { dir, home } = sandbox(t);
    const out = outside(t);
    mkdirSync(join(dir, '.cursor'), { recursive: true });
    symlinkSync(out, join(dir, '.cursor', 'rules'));

    const r = run(dir, home, 'install', '--host', 'cursor');
    assert.deepEqual(tree(out), [], 'a file was written outside the repository');
    assert.equal(r.code, 1, 'the escape was not reported as a finding');
    assert.match(r.out, /resolves outside the repository/);
  });

  test('a symlinked .ml-specs cannot place the canonical document outside', (t) => {
    // The document had no guard at all — every shim got `foreign` and containment, and the one
    // file all of them point at was written unconditionally.
    const { dir, home } = sandbox(t);
    const out = outside(t);
    symlinkSync(out, join(dir, '.ml-specs'));

    const r = run(dir, home, 'install', '--host', 'cursor');
    assert.deepEqual(tree(out), [], 'the canonical document was written outside the repository');
    assert.equal(r.code, 1);
    assert.match(r.out, /ML-SPECS\.md would land outside the repository/);
  });

  test('a DANGLING symlink is foreign, not absent', (t) => {
    // `classify` read content, so a dangling link looked like `absent` and the write followed it.
    const { dir, home } = sandbox(t);
    const out = outside(t);
    symlinkSync(join(out, 'AGENTS.md'), join(dir, 'AGENTS.md'));

    const r = run(dir, home, 'install', '--host', 'zed');
    assert.deepEqual(tree(out), [], 'a dangling symlink was followed out of the repository');
    assert.equal(r.code, 1);
    assert.ok(lstatSync(join(dir, 'AGENTS.md')).isSymbolicLink(), 'the symlink itself was replaced');
  });
});

describe('an unusable argument is could-not-run, not a crash', () => {
  for (const key of ['__proto__', 'constructor', 'toString']) {
    test(`--host ${key} exits 2 with a sentence`, (t) => {
      // These are truthy through the prototype chain, so the lookup guard passed them and
      // `join()` was handed a function — a raw ERR_INVALID_ARG_TYPE stack on exit 1.
      const { dir, home } = sandbox(t);
      const r = run(dir, home, 'install', '--host', key);
      assert.equal(r.code, 2, `expected could-not-run, got ${r.code}:\n${r.out}`);
      assert.match(r.out, /unknown host/);
      assert.doesNotMatch(r.out, /ERR_INVALID_ARG_TYPE|at Object\./, 'a stack trace reached the operator');
    });

    test(`a verb of ${key} exits 2 with a sentence`, (t) => {
      const { dir, home } = sandbox(t);
      const r = run(dir, home, key);
      assert.equal(r.code, 2);
      assert.doesNotMatch(r.out, /ERR_INVALID_ARG_TYPE|at Object\./);
    });
  }
});

describe('the config writer refuses rather than destroys', () => {
  test('an unparseable .ml-specs.json is left alone, mlSkills intact', (t) => {
    // CLAUDE.md: never silently overwrite a user's file. A trailing comma made JSON.parse fail,
    // the writer read that as "nothing here", and replaced the file — dropping the mlSkills
    // opt-out and returning the gate to its fail-open default with no message.
    const { dir, home } = sandbox(t);
    const original = '{\n  "//": "why",\n  "mlSkills": "off",\n}\n';   // trailing comma
    writeFileSync(join(dir, '.ml-specs.json'), original);

    const r = run(dir, home, 'install', '--host', 'cursor');
    assert.equal(readFileSync(join(dir, '.ml-specs.json'), 'utf8'), original,
      'an unparseable config was replaced, taking mlSkills with it');
    assert.match(r.out, /could not be read as JSON/);
    assert.equal(r.code, 1, 'the refusal was not reported as a finding');
  });

  test('a directory where the config should be does not abandon the install mid-way', (t) => {
    // The shims are already on disk by the time the config is written, so throwing here would
    // leave a half-installed tree behind a stack trace.
    const { dir, home } = sandbox(t);
    mkdirSync(join(dir, '.ml-specs.json'), { recursive: true });
    const r = run(dir, home, 'install', '--host', 'cursor');
    assert.doesNotMatch(r.out, /EISDIR|at Object\./, 'the install crashed with a stack trace');
    assert.ok(existsSync(join(dir, '.cursor', 'rules', 'ml-specs.mdc')), 'the shim was not written');
    assert.match(r.out, /could not be read as JSON/);
    assert.equal(r.code, 1, 'an unrecorded install is a finding');
  });
});

// ── VERIFY round 2: the third write target, and two refusals that reached the operator raw ────

describe('AC19 — the config file is a write target too', () => {
  function outsideDir(t) {
    const d = mkdtempSync(join(tmpdir(), 'mlspecs-victim-'));
    t.after(() => rmSync(d, { recursive: true, force: true }));
    return d;
  }

  test('a DANGLING .ml-specs.json symlink plants nothing outside the repo', (t) => {
    // `install` writes three things: the shims, the document, and this. The first two were
    // guarded and this one was not — `existsSync`, `readFileSync` and `writeFileSync` all follow
    // a link, so a cloned repo could have a config symlinked anywhere and the writer created the
    // file at that absolute path, at exit 0, with a clean report.
    const { dir, home } = sandbox(t);
    const victim = outsideDir(t);
    symlinkSync(join(victim, 'planted.json'), join(dir, '.ml-specs.json'));

    const r = run(dir, home, 'install', '--host', 'cursor');
    assert.deepEqual(tree(victim), [], 'a file was created outside the repository');
    assert.equal(r.code, 1, 'the escape was not reported as a finding');
    assert.match(r.out, /could not be read as JSON/);
  });

  test('a .ml-specs.json symlinked ONTO an existing file leaves it byte-identical', (t) => {
    const { dir, home } = sandbox(t);
    const victim = outsideDir(t);
    const target = join(victim, 'settings.json');
    const original = '{"important":"keep","apiUrl":"https://example.test"}\n';
    writeFileSync(target, original);
    symlinkSync(target, join(dir, '.ml-specs.json'));

    const r = run(dir, home, 'install', '--host', 'cursor');
    assert.equal(readFileSync(target, 'utf8'), original,
      "a file outside the repository was rewritten through a symlinked config");
    assert.equal(r.code, 1);
  });

  test('a parseable but wrong-shaped hosts is refused, not silently replaced', (t) => {
    // `{"cursor": {"pinned": true}}` is data somebody put there on purpose. Treating it as absent
    // let the writer overwrite it — and with it any valid entries sitting alongside.
    const { dir, home } = sandbox(t);
    const original = '{"mlSkills":"off","hosts":{"cursor":{"pinned":true,"note":"do not touch"}}}';
    writeFileSync(join(dir, '.ml-specs.json'), original);

    const r = run(dir, home, 'install', '--host', 'cursor');
    assert.equal(readFileSync(join(dir, '.ml-specs.json'), 'utf8'), original,
      'a hosts value nobody could parse was replaced anyway');
    assert.equal(r.code, 1);
  });

  test('no .tmp file is left behind by a successful write', (t) => {
    // The write is a sibling + rename, because writeFileSync opens with O_TRUNC: a failure after
    // the truncate would leave an empty file and then report a refusal for a file already gone.
    const { dir, home } = sandbox(t);
    assert.equal(run(dir, home, 'install', '--host', 'cursor').code, 0);
    assert.deepEqual(tree(dir).filter((f) => f.includes('.tmp-')), []);
  });
});

describe('AC22 — a pointer the tool cannot build is could-not-run, not a stack trace', () => {
  test('a HOME containing a newline refuses with a sentence and writes nothing', (t) => {
    // The one value reaching a generated file from outside the package. The library refused
    // correctly and the CLI did not carry the refusal: a raw V8 stack at exit 1, which is the
    // shape AC21 exists to eliminate and the wrong code besides.
    const { dir } = sandbox(t);
    const base = mkdtempSync(join(tmpdir(), 'mlspecs-evilhome-'));
    t.after(() => rmSync(base, { recursive: true, force: true }));
    const evil = join(base, 'ho\nme');
    mkdirSync(evil, { recursive: true });

    const r = run(dir, evil, 'install', '--host', 'cursor', '--scope', 'user');
    assert.equal(r.code, 2, `expected could-not-run, got ${r.code}:\n${r.out}`);
    assert.doesNotMatch(r.out, /at render|at pointerLine|node:internal/, 'a stack trace reached the operator');
    assert.match(r.out, /newline or backtick/);
    assert.deepEqual(tree(evil), [], 'the refusal still wrote into the home directory');
  });
});

describe('a refused document stops the install before any shim is written', () => {
  test('nothing lands when the canonical document cannot be written', (t) => {
    // The document used to be decided AFTER the shims, so a refusal left shims on disk pointing
    // at a file that was never written. Reported honestly, and still a half-install.
    const { dir, home } = sandbox(t);
    const victim = mkdtempSync(join(tmpdir(), 'mlspecs-victim-'));
    t.after(() => rmSync(victim, { recursive: true, force: true }));
    symlinkSync(victim, join(dir, '.ml-specs'));

    const r = run(dir, home, 'install', '--host', 'cursor');
    assert.equal(r.code, 1);
    assert.deepEqual(tree(victim), [], 'the document was written outside the repository');
    assert.ok(!existsSync(join(dir, '.cursor', 'rules', 'ml-specs.mdc')),
      'a shim was written pointing at a document the install then refused to write');
    assert.match(r.out, /nothing was written/);
  });
});
