// Spec 0037 — the wiring report.
//
// TWO CRITERIA CARRY THIS. AC2: a remedy names something that exists — a row saying "run
// /ml-specs:repo-wire" when no such command exists is the `--all`-flag defect specs 0025 and 0026
// both record. AC5: the surface list is derived from the shipped template set, so a template
// directory added to the toolkit and not covered fails here rather than leaving a report that is
// quietly narrower while still reading complete.
//
// Everything else fails loudly. Those two are the silent ones.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SURFACES, survey, uncovered, emitTarget, fixes } from './lib/wiring.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = dirname(HERE);
const ROOT = dirname(PLUGIN);
const CLI = join(HERE, 'spec-wiring.mjs');
const TEMPLATES = join(PLUGIN, 'templates');

const run = (root, ...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args, '--root', root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, stdout: r.stdout || '' };
};

function repo(t, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mlspecs-wiring-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

describe('AC1 — present and absent, each with where it looked', () => {
  test('a repo with a CI gate and no hooks marks one of each', (t) => {
    const dir = repo(t, { '.github/workflows/spec-gate.yml': 'on: [pull_request]\n' });
    const j = JSON.parse(run(dir, '--json').stdout);
    const ci = j.rows.find((r) => r.id === 'ci-gate');
    const hooks = j.rows.find((r) => r.id === 'hooks');

    assert.equal(ci.present, true);
    assert.deepEqual(ci.found, ['.github/workflows/spec-gate.yml'], 'the row does not name what it found');
    assert.equal(hooks.present, false);
    assert.ok(hooks.look.length, 'an absent row does not say where it looked');
  });

  test('an empty repo marks every required surface absent', (t) => {
    const j = JSON.parse(run(repo(t), '--json').stdout);
    assert.ok(j.missing.length >= 4, `only ${j.missing.length} marked missing`);
  });
});

describe('AC2 — a remedy names something that exists', () => {
  test('every fix is a real command, a real script, or an instruction with no target', () => {
    // The `--all`-flag defect: output describing a capability that is not there. A reader who
    // follows the instruction runs something that does nothing and believes they acted.
    const commands = new Set(readdirSync(join(PLUGIN, 'commands')).map((f) => `/ml-specs:${f.slice(0, -3)}`));

    for (const { id, fix } of fixes()) {
      const slash = fix.match(/\/ml-specs:[\w-]+/);
      if (slash) {
        assert.ok(commands.has(slash[0]), `${id}'s fix names ${slash[0]}, which is not a command`);
        continue;
      }
      const script = fix.match(/ml-specs\/scripts\/([\w-]+\.mjs)/);
      if (script) {
        assert.ok(existsSync(join(HERE, script[1])), `${id}'s fix names ${script[1]}, which does not exist`);
        continue;
      }
      const npx = fix.match(/npx @mlmcps\/ml-specs@\d+ (\w+)/);
      if (npx) {
        const bin = readFileSync(join(HERE, 'ml-specs.mjs'), 'utf8');
        assert.match(bin, new RegExp(`'${npx[1]}'|${npx[1]}:`), `${id}'s fix names the verb ${npx[1]}, which the bin does not parse`);
        continue;
      }
      // Prose remedies ("set mlSkills in .ml-specs.json") name no runnable thing, which is fine —
      // but they must at least say something.
      assert.ok(fix.length > 20, `${id}'s fix is too short to act on: ${JSON.stringify(fix)}`);
    }
  });

  test('every emittable surface resolves to a template that ships', () => {
    for (const s of SURFACES) {
      for (const [provider, rel] of Object.entries(s.emit)) {
        assert.ok(existsSync(join(TEMPLATES, rel)),
          `${s.id}/${provider} emits ${rel}, which is not in the template set`);
      }
    }
  });
});

describe('AC3 — emitting a template', () => {
  test('to stdout, byte-identical to the shipped file', (t) => {
    const r = run(repo(t), '--emit', 'ci-gate', '--provider', 'azure');
    assert.equal(r.code, 0, r.out);
    assert.equal(r.stdout, readFileSync(join(TEMPLATES, 'ci/azure-pipelines-spec-gate.yml'), 'utf8'));
  });

  test('without --write nothing is created', (t) => {
    const dir = repo(t);
    run(dir, '--emit', 'ci-gate');
    assert.deepEqual(readdirSync(dir), [], 'emitting to stdout wrote a file');
  });

  test('with --write it lands, byte-identical', (t) => {
    const dir = repo(t);
    assert.equal(run(dir, '--emit', 'hooks', '--write', '.claude/settings.json').code, 0);
    assert.equal(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'),
      readFileSync(join(TEMPLATES, 'hooks/settings.hooks.example.json'), 'utf8'));
  });

  test('and it REFUSES to overwrite, leaving the file byte-identical', (t) => {
    const mine = '{ "mine": true }\n';
    const dir = repo(t, { '.mcp.json': mine });
    const r = run(dir, '--emit', 'mcp', '--write', '.mcp.json');
    assert.equal(readFileSync(join(dir, '.mcp.json'), 'utf8'), mine, 'a user file was overwritten');
    assert.equal(r.code, 1);
  });

  test('an unknown surface is could-not-run, naming what can be emitted', (t) => {
    const r = run(repo(t), '--emit', 'nonsense');
    assert.equal(r.code, 2);
    assert.match(r.out, /emittable:/);
  });
});

describe('AC4 — the exit code follows the required surfaces', () => {
  test('1 when a required one is absent', (t) => {
    assert.equal(run(repo(t)).code, 1);
  });

  test('0 when they are all present, and an optional absence does not fail it', (t) => {
    const dir = repo(t, {
      '.github/workflows/spec-gate.yml': 'x\n',
      '.github/scripts/knowledge-check.mjs': 'x\n',
      '.claude/settings.json': '{}\n',
      '.mcp.json': '{}\n',
      'CLAUDE.md': 'x\n',
      'specs/README.md': 'x\n',
      '.gitattributes': 'x\n',
    });
    const r = run(dir);
    assert.equal(r.code, 0, r.out);
    // `standards` and `handoff` are absent and optional. A run that failed on those would be one
    // people stop reading.
    assert.match(r.out, /every required surface is present/);
  });
});

describe('AC5 — the surface list is derived from the template set', () => {
  test('no shipped template directory is uncovered', () => {
    const gaps = uncovered(TEMPLATES);
    assert.deepEqual(gaps, [],
      `template director(ies) no surface reports on: ${gaps.join(', ')} — the report has quietly `
      + 'narrowed while still reading complete');
  });

  test('and adding one is detected, rather than silently ignored', (t) => {
    // The mutation this criterion exists for, run directly: a new template directory that no
    // surface covers.
    const fake = mkdtempSync(join(tmpdir(), 'mlspecs-tpl-'));
    t.after(() => rmSync(fake, { recursive: true, force: true }));
    for (const d of ['ci', 'hooks', 'mcp', 'docs', 'specs', 'standards', 'handoff', 'brand-new']) {
      mkdirSync(join(fake, d), { recursive: true });
    }
    assert.deepEqual(uncovered(fake), ['brand-new']);
  });

  test('the runtime report surfaces it too, not only the test', (t) => {
    // AC5's other half: a reader running the command sees the gap, not just CI.
    const j = JSON.parse(run(repo(t), '--json').stdout);
    assert.ok(Array.isArray(j.uncoveredTemplateDirs), '--json does not report uncovered dirs');
  });
});

describe('AC6 — presence is never reported as function', () => {
  test('every present row says what it checked', (t) => {
    const dir = repo(t, { '.github/workflows/spec-gate.yml': 'x\n' });
    const r = run(dir);
    const line = r.out.split('\n').find((l) => l.includes('found .github/workflows/spec-gate.yml'));
    assert.ok(line, `no row reported the CI gate:\n${r.out}`);
    assert.match(line, /not whether it runs/,
      'a present row does not say it checked presence — "present" will be read as "running"');
  });

  test('the summary says so as well, because that is what a skim reads', (t) => {
    assert.match(run(repo(t)).out, /Presence only/);
  });

  test('and --json carries the caveat for a consumer that cannot infer one', (t) => {
    const j = JSON.parse(run(repo(t), '--json').stdout);
    assert.match(j.note, /PRESENT, never whether it runs/);
    assert.ok(j.rows.every((r) => r.checks), 'a row does not say what it checked');
  });
});

describe('it writes nothing without --write', () => {
  test('the report leaves the tree untouched', (t) => {
    const dir = repo(t, { 'CLAUDE.md': 'x\n' });
    const before = readdirSync(dir).sort();
    run(dir);
    run(dir, '--json');
    assert.deepEqual(readdirSync(dir).sort(), before);
  });
});
