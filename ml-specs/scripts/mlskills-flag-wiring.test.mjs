// Wiring of the `.ml-specs.json` architecture-standards opt-out — spec 0010.
//
// WHAT THIS FILE ASSERTS, AND WHAT IT DELIBERATELY DOES NOT
//
// Same trade as repo-skills-wiring.test.mjs:1-25, for the same reasons. It asserts facts that are
// mechanically true — the config parses, its value is one of the two the contract defines, the
// file is tracked, each gate site still names the file, the gated integration still exists. Every
// assertion IS the fact, with no interpretation in between.
//
// It does NOT assert what the gate prose MEANS. "Skip this step and say nothing" cannot be held by
// a regex without pinning wording, and pinning wording pressures people to write worse prose to
// appease the test. Whether each site actually honours the flag is a REVIEW obligation, recorded
// in the spec's §5, not a test.
//
// The one thing this file exists to stop: spec 0010's first draft claimed no test was possible and
// shipped none, and `spec-gate.mjs` then scraped a test filename out of the paragraph explaining
// why there was no test — passing `tests-exist` with zero coverage of AC1-AC7. A narrow honest
// test beats a gate that cannot fail.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readConfig } from './lib/config.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url))); // ml-specs/
const ROOT = dirname(PLUGIN);                                    // repo root
const FLAG = join(ROOT, '.ml-specs.json');

/** The two values the contract defines. `on` was cut at review — see spec 0010 §8, H1. */
const VALID = ['off', 'auto'];

describe('.ml-specs.json — the architecture-standards opt-out', () => {
  test('exists at the repo root and is valid JSON', () => {
    assert.ok(existsSync(FLAG), '.ml-specs.json is missing from the repo root');
    assert.doesNotThrow(() => JSON.parse(readFileSync(FLAG, 'utf8')), 'is not valid JSON');
  });

  test('mlSkills is present and is one of the defined values', () => {
    const cfg = JSON.parse(readFileSync(FLAG, 'utf8'));
    assert.ok('mlSkills' in cfg, 'mlSkills key is absent');
    assert.ok(VALID.includes(cfg.mlSkills),
      `mlSkills is ${JSON.stringify(cfg.mlSkills)}; expected one of ${VALID.join(' | ')}`);
  });

  test('hosts, if present, is an array of strings — spec 0028', () => {
    // A second key, and the reason this test rather than a new one owns it: this file is where
    // `.ml-specs.json`'s shape is pinned, and a parallel convention in `lib/config.test.mjs` would
    // let the two drift. That file owns the PARSER's behaviour; this one owns THIS repo's file.
    //
    // `if present` is deliberate. The key is written by `ml-specs install`, and this repo installs
    // no shims into itself — Claude Code is served by the plugin. Requiring it would make the
    // honest absence a failure.
    // Two failed attempts at this one are worth recording. First an early `return` on the absent
    // key — and absent is the PERMANENT state here, since this repo installs no shims into
    // itself, so the body never ran. Then an assertion in front of that return which was a
    // tautology: `!('hosts' in cfg)` already guarantees no `hosts` key is in `Object.keys(cfg)`.
    //
    // What can actually fail is what the real parser makes of this repo's real file. Both halves
    // go red on a change that matters: a stray `hosts` key, or a lost `mlSkills`.
    const cfg = readConfig(ROOT);
    assert.deepEqual(cfg.hosts, [],
      `readConfig sees hosts=${JSON.stringify(cfg.hosts)} — this repo installs no shims into itself`);
    assert.equal(cfg.mlSkills, 'off',
      'the parser no longer reads this repo\'s own mlSkills opt-out as off');
  });

  test('is tracked by git', () => {
    // Spec 0010's first draft asserted the file was tracked while it was not, and §7's only
    // stated mitigation for "a repo sets off and forgets" was that it shows up in diffs.
    const tracked = execFileSync('git', ['-C', ROOT, 'ls-files', '.ml-specs.json'], {
      encoding: 'utf8',
    }).trim();
    assert.equal(tracked, '.ml-specs.json', '.ml-specs.json is untracked');
  });
});

describe('the gate sites still name the config file', () => {
  // Existence, not semantics: catches deletion, rename and drift of the file reference.
  const SITES = [
    'ml-specs/agents/reviewer.md',
    'ml-specs/commands/spec-verify.md',
    'ml-specs/commands/spec-advance.md',
    'ml-specs/README.md',
  ];
  for (const rel of SITES) {
    test(`${rel} references .ml-specs.json`, () => {
      assert.match(readFileSync(join(ROOT, rel), 'utf8'), /\.ml-specs\.json/,
        `${rel} no longer names the config file; the gate is unreachable from it`);
    });
  }

  test('spec-advance names the flag in both the procedure and the gate table', () => {
    // The two disagreed in 0010's first draft: step 3 said the gate does not apply, the table
    // still said "refuse the transition". One mention is not enough to prove they agree, but
    // zero mentions in the table proves they cannot.
    const body = readFileSync(join(ROOT, 'ml-specs/commands/spec-advance.md'), 'utf8');
    const inTable = body.split('\n').filter((l) => l.startsWith('|') && l.includes('mlSkills'));
    assert.ok(inTable.length >= 1, 'the gate table row does not mention mlSkills');
  });
});

describe('the integration is gated, not removed', () => {
  // Spec 0010 AC8. The flag turns the check off; it does not delete the feature.
  for (const rel of [
    'ml-specs/commands/repo-skills.md',
    'ml-specs/templates/standards/.mlskills.json',
    'ml-specs/templates/docs/SKILLS.template.md',
  ]) {
    test(`${rel} still exists`, () => {
      assert.ok(existsSync(join(ROOT, rel)), `${rel} was removed; the flag should gate, not delete`);
    });
  }
});
