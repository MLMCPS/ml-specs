// Spec 0031 AC4, AC5 — the two criteria that fail silently.
//
// `lib/route.test.mjs` holds the answers. These two are about the verb's relationship to the rest
// of the toolkit, and neither shows up in an answer that looks right:
//
// AC4 — a table naming a command nobody shipped. The reader follows the suggestion, gets nothing,
// and believes they acted. That is the `--all`-flag defect specs 0025 and 0026 both record.
//
// AC5 — REGRESSION SENSOR. Routing is navigation, never consent. A verb that quietly wrote a file
// would look identical from the outside, which is exactly why this is asserted by SNAPSHOT rather
// than by reading the source: the snapshot also covers whatever the verb spawns.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { namedCommands, ROUTES, BY_STATUS, DEFAULT_ROUTE } from './lib/route.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = dirname(HERE);
const COMMANDS = join(PLUGIN, 'commands');
const CLI = join(HERE, 'spec-next.mjs');

const run = (root, ...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args, '--root', root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, stdout: r.stdout || '' };
};

const HEADER = (status) => `| **Status** | ${status} |\n| **Branch** | feat/x |\n`;
const specFile = (status, title = 'a spec') =>
  `# Spec: ${title}\n\n| | |\n|---|---|\n${HEADER(status)}\n## 5. Acceptance criteria\n\n- [ ] **AC1** — something\n`;

/** A throwaway repo with a board. */
function repo(t, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mlspecs-next-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

/** Every file under `dir`, by path, with a content hash — so a rewrite counts as a change. */
function snapshot(dir) {
  const out = {};
  const walk = (abs) => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const p = join(abs, e.name);
      if (e.isDirectory()) walk(p);
      else out[relative(dir, p)] = createHash('sha256').update(readFileSync(p)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

describe('AC4 — every command either table names exists', () => {
  test('the route table, the status table, and both fallbacks', () => {
    const shipped = new Set(readdirSync(COMMANDS).filter((f) => f.endsWith('.md')).map((f) => `/ml-specs:${f.slice(0, -3)}`));
    for (const c of namedCommands()) {
      assert.ok(shipped.has(c), `${c} is named by a table but there is no commands/${c.split(':')[1]}.md`);
    }
  });

  test('and the list being checked covers both tables, so it cannot narrow silently', () => {
    // The vacuous pass: `namedCommands()` returning `[]` — or returning only the route table —
    // satisfies the assertion above while checking nothing. AC4's own test has to be able to see
    // its input shrink, or the criterion moves to whichever file happens to still look.
    const named = namedCommands();
    for (const c of ROUTES.map((r) => r.command)) assert.ok(named.includes(c), `${c} unchecked`);
    for (const c of Object.values(BY_STATUS).filter(Boolean).map((r) => r.command)) {
      assert.ok(named.includes(c), `${c} unchecked — a nextFor suggestion goes unverified`);
    }
    assert.ok(named.includes(DEFAULT_ROUTE.command), 'the default route is unchecked');
    assert.ok(named.includes('/ml-specs:repo-doctor'), 'the off-lifecycle suggestion is unchecked');
    assert.ok(named.includes('/ml-specs:spec-advance'), 'the failing-record suggestion is unchecked');
  });

  test('the sensor — a made-up command would be caught', () => {
    const shipped = new Set(readdirSync(COMMANDS).filter((f) => f.endsWith('.md')).map((f) => `/ml-specs:${f.slice(0, -3)}`));
    assert.equal(shipped.has('/ml-specs:repo-wire'), false,
      'the check cannot fail — it accepts a command that does not exist');
  });

  test('this spec shipped its own command', () => {
    assert.ok(existsSync(join(COMMANDS, 'next.md')), 'commands/next.md is missing');
  });
});

describe('AC5 — REGRESSION SENSOR: neither verb writes anything', () => {
  const board = {
    'specs/0001-alpha.md': specFile('Draft', 'alpha'),
    'specs/0002-beta.md': specFile('Approved', 'beta'),
    'specs/0003-gamma.md': specFile('Implemented', 'gamma'),
    'specs/0004-delta.md': specFile('Verified', 'delta'),
    'specs/archive/0005-epsilon.md': specFile('Archived', 'epsilon'),
    // A record on disk so the evidence path — and the process it spawns — actually runs. A
    // snapshot taken over a code path that never executed proves nothing about it.
    '.ml-specs/evidence/0003-gamma-implemented.json':
      `${JSON.stringify({ spec: 'specs/0003-gamma.md', to: 'Implemented', at: '2026-01-01T00:00:00.000Z', tests: [], changed: [] }, null, 2)}\n`,
  };

  test('the board mode leaves the tree byte-identical', (t) => {
    const dir = repo(t, board);
    const before = snapshot(dir);
    assert.equal(run(dir).code, 0);
    assert.equal(run(dir, '--json').code, 0);
    assert.deepEqual(snapshot(dir), before, 'something under the repo changed');
  });

  test('so do the single-spec and route modes', (t) => {
    const dir = repo(t, board);
    const before = snapshot(dir);
    run(dir, 'specs/0002-beta.md');
    run(dir, 'specs/0003-gamma.md', '--json');
    run(dir, '--route', 'the importer crashes on empty files');
    run(dir, '--route', 'something nothing matches at all');
    assert.deepEqual(snapshot(dir), before, 'something under the repo changed');
  });

  test('the snapshot can actually see a write', (t) => {
    // Without this the two tests above pass against a `snapshot()` that returns a constant —
    // which is the vacuous assertion this repo keeps finding. The write is made by the test, not
    // by the verb, so it proves the instrument rather than the subject.
    const dir = repo(t, board);
    const before = snapshot(dir);
    writeFileSync(join(dir, 'specs', 'planted.txt'), 'x\n');
    assert.notDeepEqual(snapshot(dir), before, 'the snapshot is blind to a new file');

    writeFileSync(join(dir, 'specs', 'planted.txt'), 'different\n');
    const after = snapshot(dir);
    writeFileSync(join(dir, 'specs', 'planted.txt'), 'x\n');
    assert.notDeepEqual(after, snapshot(dir), 'the snapshot is blind to a changed file — it compares names only');
  });

  test('neither source file contains a write call', (t) => {
    // The structural half. The snapshots above are the real sensor; this stops a future edit from
    // putting a write INTO these two files, where a passing snapshot on today's fixture would not
    // necessarily catch it.
    for (const f of [CLI, join(HERE, 'lib', 'route.mjs')]) {
      const src = readFileSync(f, 'utf8');
      for (const call of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'unlinkSync', 'renameSync', 'createWriteStream']) {
        assert.doesNotMatch(src, new RegExp(`\\b${call}\\s*\\(`), `${relative(PLUGIN, f)} calls ${call}`);
      }
    }
  });

  test('and it spawns exactly one script, which is the read-only reader', () => {
    // AC5's other clause: "nor spawns anything that could". Module-level containment is the wrong
    // granularity to assert — `spec-evidence.mjs` imports `lib/evidence.mjs`, which exports a
    // writer it never calls. So the spawn SET is pinned instead: widening it fails here and forces
    // somebody to look, rather than riding in under a snapshot that happens not to notice.
    const src = readFileSync(CLI, 'utf8');
    const spawned = [...src.matchAll(/join\(HERE,\s*'([^']+)'\)/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(spawned)], ['spec-evidence.mjs']);

    const reader = readFileSync(join(HERE, 'spec-evidence.mjs'), 'utf8');
    for (const call of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'unlinkSync']) {
      assert.doesNotMatch(reader, new RegExp(`\\b${call}\\s*\\(`), `spec-evidence.mjs calls ${call}`);
    }
  });
});

describe('the verb answers, and says what it read', () => {
  test('the board picks one spec and names it, with the count it considered', (t) => {
    const dir = repo(t, {
      'specs/0001-alpha.md': specFile('Draft', 'alpha'),
      'specs/0004-delta.md': specFile('Verified', 'delta'),
    });
    const j = JSON.parse(run(dir, '--json').stdout);
    // Furthest along first: finishing what is started beats starting something else.
    assert.equal(j.spec, 'specs/0004-delta.md');
    assert.match(j.command, /^\/ml-specs:pr /);
    assert.ok(j.why, 'no reason');
    assert.equal(j.considered, 2);
  });

  test('two specs at the same stage are reported as a tie, not silently picked from', (t) => {
    const dir = repo(t, {
      'specs/0001-alpha.md': specFile('Approved', 'alpha'),
      'specs/0002-beta.md': specFile('Approved', 'beta'),
    });
    const j = JSON.parse(run(dir, '--json').stdout);
    assert.equal(j.spec, 'specs/0001-alpha.md');
    assert.deepEqual(j.alsoReady, ['specs/0002-beta.md'],
      'a six-way tie would have been a coin flip wearing a reason');
  });

  test('an empty board is an answer, at exit 0', (t) => {
    const r = run(repo(t));
    assert.equal(r.code, 0, 'an empty board was treated as a failure');
    assert.match(r.out, /no specs yet/);
  });

  test('a board of nothing but Archived says so rather than inventing work', (t) => {
    const r = run(repo(t, { 'specs/archive/0005-epsilon.md': specFile('Archived', 'e') }));
    assert.equal(r.code, 0);
    assert.match(r.out, /Archived/);
  });

  test('--route prints the command and its reason', (t) => {
    const r = run(repo(t), '--route', 'the checkout page is broken on mobile');
    assert.equal(r.code, 0);
    assert.match(r.out, /\/ml-specs:fix/);
    assert.match(r.out, /because /, 'the answer arrived with no derivation');
  });

  test('a spec that is not on the board is could-not-run, not a guess', (t) => {
    const dir = repo(t, { 'specs/0001-alpha.md': specFile('Draft') });
    const r = run(dir, 'specs/0099-nope.md');
    assert.equal(r.code, 2);
    assert.match(r.out, /no spec at/);
  });

  test('exit is never 1 — there is no finding here, only a suggestion', (t) => {
    const dir = repo(t, {
      'specs/0003-gamma.md': specFile('Implemented', 'gamma'),
      '.ml-specs/evidence/0003-gamma-implemented.json':
        `${JSON.stringify({ spec: 'specs/0003-gamma.md', to: 'Implemented', at: '2026-01-01T00:00:00.000Z' }, null, 2)}\n`,
    });
    for (const args of [[], ['--json'], ['specs/0003-gamma.md'], ['--route', 'anything at all']]) {
      assert.notEqual(run(dir, ...args).code, 1, `\`${args.join(' ')}\` exited 1`);
    }
  });

  test('--root is not read as the spec to look at', (t) => {
    // The argv bug 0059 shipped with: a flag's VALUE taken as a positional.
    const dir = repo(t, { 'specs/0002-beta.md': specFile('Approved', 'beta') });
    const j = JSON.parse(run(dir, '--json').stdout);
    assert.equal(j.spec, 'specs/0002-beta.md');
  });
});
