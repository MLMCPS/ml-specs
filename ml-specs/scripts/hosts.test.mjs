// Spec 0028 AC1, AC2 — the registry.
//
// Both criteria here were VACUOUS in an earlier draft of the spec and were rewritten before any
// code existed. Worth recording what they used to say, because the rewrite is the point:
//
//   AC2 was "exactly one row is `verified: true`" plus "every row marked false carries either
//   notes or nothing". The second half is a tautology — every field is present or absent. The
//   first half hardcodes today's count into a test, so §8's plan to verify hosts one at a time
//   would have been broken by its own first success. What the registry actually promises is a
//   BICONDITIONAL, and that is count-free.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOSTS, FORMATS, hostIds, installableIds, resolveHost, installTarget, sharedTargets, needsVerificationWarning } from './lib/hosts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, 'ml-specs.mjs');

/** The sixteen §2 names. Pinned, because a three-host registry would pass every other assertion. */
const IDS = [
  'claude-code', 'codex', 'cursor', 'copilot', 'antigravity', 'windsurf', 'cline', 'roo',
  'kilo', 'gemini-cli', 'continue', 'zed', 'amp', 'opencode', 'aider', 'generic',
];

describe('AC1 — resolving a host', () => {
  test('a known id returns the row, carrying its own id', () => {
    const host = resolveHost('cursor');
    assert.equal(host.id, 'cursor');
    assert.equal(host.format, FORMATS.RULES_DIR);
    assert.equal(host.ext, '.mdc');
  });

  test('an unknown id raises ENOHOST and names what is known — a lib never exits', () => {
    // `lib/` hands the problem back; the CLI turns it into exit 2 with a sentence. A module that
    // calls process.exit cannot be unit-tested and cannot be reused.
    assert.throws(() => resolveHost('emacs'), (e) => {
      assert.equal(e.code, 'ENOHOST');
      assert.match(e.message, /unknown host 'emacs'/);
      assert.match(e.message, /cursor/, 'the refusal does not say what IS known');
      return true;
    });
  });

  test('the CLI turns that into exit 2, not a stack trace', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'mlspecs-hosts-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const r = spawnSync(process.execPath, [BIN, 'install', '--host', 'emacs', '--root', dir], { encoding: 'utf8' });
    assert.equal(r.status, 2, 'an unknown host is "could not run", per docs/PATTERNS.md:95-102');
    assert.match(r.stderr, /unknown host 'emacs'/);
    assert.doesNotMatch(r.stderr, /at Object\.|at Module\./, 'a typo printed a stack trace');
  });
});

describe('AC2 — the honesty flag', () => {
  test('verified is true if and only if verifiedBy is a non-empty string', () => {
    for (const [id, host] of Object.entries(HOSTS)) {
      const claimed = host.verified === true;
      const evidence = typeof host.verifiedBy === 'string' && host.verifiedBy.trim().length > 0;
      assert.equal(claimed, evidence,
        `${id}: verified=${host.verified} but verifiedBy=${JSON.stringify(host.verifiedBy)} — `
        + 'a boolean nobody can audit is the claim this registry exists to refuse');
    }
  });

  test('every verifiedBy is a sentence, not a word', () => {
    // 40 characters. "yes" satisfies a biconditional and tells a reader nothing, so flipping all
    // sixteen rows to true with one-word evidence has to fail — that is §2's non-goal, made
    // testable without asserting a count.
    for (const [id, host] of Object.entries(HOSTS)) {
      if (!host.verified) continue;
      assert.ok(host.verifiedBy.length >= 40,
        `${id}: verifiedBy is ${host.verifiedBy.length} chars — say HOW it was exercised`);
    }
  });

  test('at least one row is unverified — the flag has to be capable of being false', () => {
    assert.ok(Object.values(HOSTS).some((h) => h.verified === false),
      'every row claims to be verified; the flag has stopped carrying information');
  });

  test('the id set is exactly the sixteen the spec names', () => {
    // Deliberately a count AND a set: §8 changes which rows are verified over time, never which
    // rows exist. Without this, a registry that lost twelve hosts passes AC1-AC16.
    assert.deepEqual([...hostIds()].sort(), [...IDS].sort());
  });

  test('claude-code is served by the plugin, and is the only row that is', () => {
    const served = hostIds().filter((id) => HOSTS[id].servedBy);
    assert.deepEqual(served, ['claude-code']);
    assert.equal(installableIds().length, IDS.length - 1,
      'the installer should write for every host except the one the plugin serves');
  });

  test('only claude-code declares a mechanism, and it is report data', () => {
    for (const id of installableIds()) {
      assert.deepEqual(HOSTS[id].mechanisms, { subagents: false, slashCommands: false, hooks: false, pluginRoot: false },
        `${id} claims a mechanism an installed file could not use`);
    }
  });
});

describe('targets', () => {
  test('a user scope is a function of the injected environment, never the real home', () => {
    // The whole reason AC15 can run twice on one machine.
    const a = installTarget('cursor', 'user', '/repo', { HOME: '/tmp/home-a' });
    const b = installTarget('cursor', 'user', '/repo', { HOME: '/tmp/home-b' });
    assert.equal(a, '/tmp/home-a/.cursor/rules');
    assert.equal(b, '/tmp/home-b/.cursor/rules');
  });

  test('a host with no user scope returns null rather than guessing one', () => {
    assert.equal(installTarget('zed', 'user', '/repo', { HOME: '/tmp/h' }), null);
  });

  test('the AGENTS.md sharers are derived, not counted by hand', () => {
    const groups = sharedTargets(installableIds(), '/repo');
    const agents = groups.get('/repo/AGENTS.md');
    assert.ok(agents && agents.length > 1, 'no shared target — this asserts nothing');
    // Asserted as a SET drawn from the registry: hardcoding "five" makes adding a sixteenth host
    // that reads AGENTS.md a test failure rather than a registry edit.
    const expected = installableIds().filter((id) => HOSTS[id].project === 'AGENTS.md');
    assert.deepEqual(agents, expected);
  });
});

describe('AC13 — the unverified warning is keyed to the flag, not to the loop', () => {
  test('both directions, against fixture rows', () => {
    // Inline in the CLI this had no sensor that could fail: every host the installer writes for
    // is unverified today, because the one verified row is served by the plugin and never
    // installed. So making the warning unconditional changed no observable output — measured at
    // zero net failures in VERIFY round 2. As a predicate, both directions are reachable.
    assert.equal(needsVerificationWarning({ verified: false }), true);
    assert.equal(needsVerificationWarning({ verified: true, verifiedBy: 'exercised, and here is how' }), false);
  });

  test('and it agrees with the real registry for every row', () => {
    for (const id of hostIds()) {
      assert.equal(needsVerificationWarning(HOSTS[id]), !HOSTS[id].verified,
        `${id}: the predicate and the flag disagree`);
    }
  });
});
