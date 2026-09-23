// Spec 0028 AC18 — `/ml-specs:repo-hosts` is wired, not just written.
//
// The genre this repo already uses for every new command (`repo-skills-wiring`, `explain-wiring`,
// `handoff-wiring`, `spec-explore-wiring`, `pr-address-wiring`), and it exists because a command
// file on disk is the easy half. The half that goes undone is the manifest descriptions — which
// `validate-plugin.mjs:146-162` hard-errors on, so a half-done command is a build break rather
// than a quiet gap — and the closing line, which is how a user finds the next step.
//
// Every assertion here is scoped to a construct rather than a file-global literal. `repo-hosts`
// appears in both manifests and in this file's own path; a bare `includes('repo-hosts')` would
// pass with the command deleted.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE));
const COMMAND = join(HERE, '..', 'commands', 'repo-hosts.md');

const read = (p) => readFileSync(p, 'utf8');
const json = (p) => JSON.parse(read(join(ROOT, p)));

describe('AC18 — the command exists and is shaped like the others', () => {
  test('it is there, with frontmatter', () => {
    assert.ok(existsSync(COMMAND), 'ml-specs/commands/repo-hosts.md is missing');
    const body = read(COMMAND);
    assert.match(body, /^---\n[\s\S]*?\n---\n/, 'no frontmatter — it will not appear in the menu');
    assert.match(body, /^description:/m);
    assert.match(body, /^argument-hint:/m);
  });

  test('it names the script it runs, through the plugin root', () => {
    // A command that reimplements a script's job instead of calling it is the drift
    // `docs/PATTERNS.md` warns about; a command with a literal absolute path breaks on every
    // machine but its author's.
    const body = read(COMMAND);
    assert.match(body, /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/ml-specs\.mjs hosts/,
      'the command does not run the hosts report, or hardcodes a path');
  });

  test('it is read-only, and says so', () => {
    const body = read(COMMAND);
    assert.match(body, /read-only|Do NOT install/i,
      'nothing stops this command from installing, which is a deliberate act a user runs themselves');
  });

  test('it ends by naming the next command', () => {
    // docs/PATTERNS.md:85-87. Scoped to the LAST non-empty line, not a file-global match: every
    // command mentions other commands in passing, and a global regex passes with the closing line
    // deleted.
    const lines = read(COMMAND).trimEnd().split('\n').filter((l) => l.trim());
    const last = lines[lines.length - 1];
    assert.match(last, /\/ml-specs:[a-z-]+/, `the closing line names no next command: ${JSON.stringify(last)}`);
  });

  test('it explains the three rows a reader will misread', () => {
    // Not wording-pinning: these are the three states the report emits that mean something other
    // than what they look like, and a command that prints them without explaining them sends
    // someone to "fix" a row that is correct.
    const body = read(COMMAND);
    for (const [what, re] of [
      ['served by the plugin', /served by the plugin/],
      ['unverified means unrun', /unverified.*(nobody has run|not exercised)/is],
      ['detected vs installed', /detected.*installed|installed.*detected/is],
    ]) {
      assert.match(body, re, `the command does not explain "${what}"`);
    }
  });
});

describe('AC18 — both manifests list it, or the build breaks', () => {
  const mentions = (desc) => new RegExp('(?:/|/ml-specs:)repo-hosts(?![\\w-])').test(desc);

  test('plugin.json description', () => {
    assert.ok(mentions(json('ml-specs/.claude-plugin/plugin.json').description),
      'plugin.json does not list /ml-specs:repo-hosts — validate-plugin.mjs:146-162 hard-errors on this');
  });

  test('marketplace.json description', () => {
    const entry = json('.claude-plugin/marketplace.json').plugins.find((p) => p.name === 'ml-specs');
    assert.ok(mentions(entry.description),
      'marketplace.json does not list /ml-specs:repo-hosts — this is the list users see in /plugin');
  });

  test('the two descriptions agree', () => {
    // They are byte-identical today and the validator checks each separately, so drift between
    // them would satisfy both checks and still show two different command lists to two audiences.
    const a = json('ml-specs/.claude-plugin/plugin.json').description;
    const b = json('.claude-plugin/marketplace.json').plugins.find((p) => p.name === 'ml-specs').description;
    assert.equal(a, b);
  });
});
