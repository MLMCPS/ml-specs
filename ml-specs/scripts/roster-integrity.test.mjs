// Spec 0051 AC1, AC4, AC5, AC6 — the real roster, against the real standard.
//
// `prompt-shape.test.mjs` tests the checker with fixtures. This runs it over the 34 files that
// actually ship, which is the only thing that can tell you the standard is satisfiable rather than
// merely coherent.
//
// Required rules hold on all 34 today, and that is deliberate: a standard whose first run is a
// wall of errors is one somebody turns off. The 17 warnings are the backlog, visible and not
// blocking.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, frontmatter, IMPLEMENTERS } from './lib/prompt-shape.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));   // ml-specs/scripts/
const PLUGIN = dirname(HERE);                            // ml-specs/
const ROOT = dirname(PLUGIN);

const md = (dir) => readdirSync(join(PLUGIN, dir)).filter((f) => f.endsWith('.md'));
const read = (dir, f) => readFileSync(join(PLUGIN, dir, f), 'utf8');
const AGENT_NAMES = md('agents').map((f) => f.slice(0, -3));
const COMMAND_NAMES = md('commands').map((f) => f.slice(0, -3));

describe('AC1 — every shipped file satisfies the required rules', () => {
  test('no agent raises an error', () => {
    for (const f of md('agents')) {
      const errs = check('agent', f.slice(0, -3), read('agents', f), AGENT_NAMES)
        .filter((x) => x.level === 'error');
      assert.deepEqual(errs, [], `ml-specs/agents/${f}: ${errs.map((e) => e.message).join('; ')}`);
    }
  });

  test('no command raises an error', () => {
    for (const f of md('commands')) {
      const errs = check('command', f.slice(0, -3), read('commands', f), AGENT_NAMES)
        .filter((x) => x.level === 'error');
      assert.deepEqual(errs, [], `ml-specs/commands/${f}: ${errs.map((e) => e.message).join('; ')}`);
    }
  });

  test('and the roster is the size the docs claim — or the loops above check almost nothing', () => {
    assert.ok(AGENT_NAMES.length >= 10, `only ${AGENT_NAMES.length} agents found`);
    assert.ok(COMMAND_NAMES.length >= 24, `only ${COMMAND_NAMES.length} commands found`);
  });
});

describe('AC4 — the tool grants on disk', () => {
  test('exactly the implementers hold Write or Edit', () => {
    const holders = [];
    for (const f of md('agents')) {
      const { meta } = frontmatter(read('agents', f));
      const grants = (meta.tools ?? '').split(',').map((t) => t.trim());
      if (grants.includes('Write') || grants.includes('Edit')) holders.push(f.slice(0, -3));
    }
    assert.deepEqual(holders.sort(), Object.keys(IMPLEMENTERS).sort(),
      'the agents holding Write/Edit are not the ones docs/PROMPTS.md says may');
  });
});

describe('AC5 — roster integrity', () => {
  test('every agent a command names exists', () => {
    // Dispatch is by prose name and nothing mechanically breaks on a rename
    // (`docs/ARCHITECTURE.md:43-44`). This is the check that does.
    const body = md('commands').map((f) => read('commands', f)).join('\n');
    const named = new Set();
    for (const a of AGENT_NAMES) if (new RegExp(`\\b${a}\\b`).test(body)) named.add(a);
    for (const a of named) {
      assert.ok(existsSync(join(PLUGIN, 'agents', `${a}.md`)), `a command names ${a}, which is gone`);
    }
    assert.ok(named.size >= 5, `only ${named.size} agents are named by any command`);
  });

  test('every agent is reachable from a command, or declares its own entry point', () => {
    const body = md('commands').map((f) => read('commands', f)).join('\n');
    for (const a of AGENT_NAMES) {
      if (new RegExp(`\\b${a}\\b`).test(body)) continue;
      // `spec-author` is the standing exception and says so in its own file — batch authoring,
      // deliberately not `/ml-specs:spec`. An unreachable agent with no such statement is a file
      // nothing can invoke.
      const text = read('agents', `${a}.md`);
      assert.match(text, /entry point|deliberately NOT|standalone/i,
        `ml-specs/agents/${a}.md is invoked by no command and declares no entry point`);
    }
  });
});

describe('AC6 — the standard is registered where it will be loaded', () => {
  test('docs/PROMPTS.md exists', () => {
    assert.ok(existsSync(join(ROOT, 'docs', 'PROMPTS.md')));
  });

  test('CLAUDE.md names it in the knowledge-layer order', () => {
    // A standard nobody loads is a standard nobody follows. `CLAUDE.md` is the always-in-context
    // index, and its ordered list is how anything else gets read at the right moment.
    const claude = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
    const order = claude.slice(claude.indexOf('## Knowledge layer'), claude.indexOf('## Working agreement'));
    assert.ok(order.length > 0, 'the knowledge-layer section of CLAUDE.md has moved');
    assert.match(order, /docs\/PROMPTS\.md/,
      'docs/PROMPTS.md is not in the knowledge-layer order — it will be loaded by accident or not at all');
  });

  test('and it points at the skill contract rather than restating it', () => {
    // Spec 0059 owns the skill contract. Two statements of it would drift.
    const prompts = readFileSync(join(ROOT, 'docs', 'PROMPTS.md'), 'utf8');
    assert.match(prompts, /0059/, 'PROMPTS.md does not say where the skill contract lives');
  });
});
