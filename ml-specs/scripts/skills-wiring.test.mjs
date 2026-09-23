// Spec 0059 AC5, AC6, AC7 — the catalogue driven end to end, and the command that surfaces it.
//
// AC5 is the one with teeth. `--new` refuses without a `standard`, and the refusal is proved by
// the absence of a file — not by the message. A scaffold that writes a hole and trusts somebody to
// fill it is a hole that ships, and asserting on the refusal text passes just as happily against a
// scaffold that writes the file and then prints a refusal.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITIES, REQUIRED_FIELDS } from './lib/skills.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = dirname(HERE);
const ROOT = dirname(PLUGIN);
const CLI = join(HERE, 'spec-skills.mjs');

/** A throwaway skills root, so nothing here touches the shipped set. */
function root(t) {
  const d = mkdtempSync(join(tmpdir(), 'mlspecs-skillroot-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

const run = (dir, ...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args, '--root', dir], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, stdout: r.stdout || '' };
};

const tree = (d) => (existsSync(d) ? readdirSync(d) : []);

describe('AC5 — --new refuses without a citation', () => {
  test('no --standard writes nothing and exits 1', (t) => {
    const d = root(t);
    const r = run(d, '--new', 'write-tests', '--capability', 'testing');
    assert.deepEqual(tree(d), [], 'a skill directory was created despite the refusal');
    assert.equal(r.code, 1, 'a refusal is a finding, per docs/PATTERNS.md:95-102');
    assert.match(r.out, /body of practice/);
  });

  test('a one-word --standard writes nothing either', (t) => {
    const d = root(t);
    const r = run(d, '--new', 'write-tests', '--capability', 'testing', '--standard', 'TDD');
    assert.deepEqual(tree(d), [], 'a gesture passed as a citation and a file was written');
    assert.equal(r.code, 1);
  });

  test('a capability outside the vocabulary writes nothing, and names what is known', (t) => {
    const d = root(t);
    const r = run(d, '--new', 'x', '--capability', 'vibes', '--standard', 'TDD (Beck) + xUnit');
    assert.deepEqual(tree(d), []);
    assert.equal(r.code, 1);
    assert.match(r.out, /testing/, 'the refusal does not say what IS known');
  });

  test('a real citation scaffolds a file carrying all six fields', (t) => {
    const d = root(t);
    const r = run(d, '--new', 'write-tests', '--capability', 'testing',
      '--standard', 'TDD (Beck) + xUnit Test Patterns');
    assert.equal(r.code, 0, r.out);

    const text = readFileSync(join(d, 'write-tests', 'SKILL.md'), 'utf8');
    for (const f of REQUIRED_FIELDS) {
      assert.match(text, new RegExp(`^${f}:`, 'm'), `the scaffold declares no ${f}`);
    }
    assert.match(text, /standard: TDD \(Beck\)/, 'the citation given was not carried through');
  });

  test('and it refuses to overwrite one that exists', (t) => {
    const d = root(t);
    mkdirSync(join(d, 'taken'), { recursive: true });
    writeFileSync(join(d, 'taken', 'SKILL.md'), 'mine\n');
    const r = run(d, '--new', 'taken', '--capability', 'testing', '--standard', 'TDD (Beck) + xUnit');
    assert.equal(readFileSync(join(d, 'taken', 'SKILL.md'), 'utf8'), 'mine\n',
      'an existing skill was overwritten');
    assert.equal(r.code, 1);
  });
});

describe('AC6 — the catalogue', () => {
  test('lists the shipped skills and reports uncovered capabilities', () => {
    const r = run(PLUGIN + '/skills');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /knowledge-retrieval/);
    assert.match(r.out, /capability\(ies\) no skill implements yet/,
      'a capability nothing implements is a gap worth seeing, and it is not reported');
  });

  test('--json carries the same data a consumer needs', () => {
    const j = JSON.parse(run(PLUGIN + '/skills', '--json').stdout);
    assert.ok(Array.isArray(j.skills) && j.skills.length >= 1);
    assert.deepEqual(j.capabilities, [...CAPABILITIES]);
    assert.ok(Array.isArray(j.uncovered));
    for (const s of j.skills) for (const f of REQUIRED_FIELDS) assert.ok(f in s, `--json omits ${f}`);
  });

  test('an unknown name is could-not-run, not a crash', (t) => {
    const r = run(root(t), 'nosuchskill');
    assert.equal(r.code, 2);
    assert.doesNotMatch(r.out, /at Object\.|node:internal/, 'a stack trace reached the operator');
  });

  test('an empty catalogue says so rather than printing nothing', (t) => {
    const r = run(root(t));
    assert.equal(r.code, 0);
    assert.match(r.out, /no skills yet/);
  });
});

describe('AC7 — the command and the counts', () => {
  const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

  test('repo-skill.md exists and names the script it runs', () => {
    const body = read('ml-specs/commands/repo-skill.md');
    assert.match(body, /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/spec-skills\.mjs/);
    assert.match(body, /^description:/m);
    assert.match(body, /^argument-hint:/m);
  });

  test('it ends by naming a next command', () => {
    const body = read('ml-specs/commands/repo-skill.md').trimEnd().split('\n');
    assert.match(body[body.length - 1], /\/ml-specs:[a-z-]+/);
  });

  test('and it explains the field the layer rests on', () => {
    // Not wording-pinning: `standard` is the one field that separates a procedure from advice, and
    // a command that lists skills without explaining it leaves a reader unable to judge the list.
    const body = read('ml-specs/commands/repo-skill.md');
    assert.match(body, /standard/);
    assert.match(body, /best practices/, 'the command does not say what a bad citation looks like');
  });

  test('both manifests list it — validate-plugin.mjs hard-errors otherwise', () => {
    const plugin = JSON.parse(read('ml-specs/.claude-plugin/plugin.json'));
    const market = JSON.parse(read('.claude-plugin/marketplace.json')).plugins.find((p) => p.name === 'ml-specs');
    for (const [what, desc] of [['plugin.json', plugin.description], ['marketplace.json', market.description]]) {
      assert.match(desc, /\/ml-specs:repo-skill(?![\w-])/, `${what} does not list /ml-specs:repo-skill`);
    }
  });

  test('the prompt-surface shard counts the skills on disk', () => {
    const shard = read('docs/architecture/prompt-surface.md');
    const onDisk = readdirSync(join(PLUGIN, 'skills'), { withFileTypes: true })
      .filter((e) => e.isDirectory()).length;
    assert.match(shard, new RegExp(`${onDisk} skill`),
      `the shard's skill count disagrees with the ${onDisk} on disk`);
  });
});
