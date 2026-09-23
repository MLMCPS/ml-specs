// Spec 0028 AC12 — `.ml-specs.json`, read key by key.
//
// THE RULE IS PER KEY, AND THAT IS FORCED RATHER THAN CHOSEN.
// `specs/0020-autonomy-levels.md:62-65` records why: one malformed file must resolve `mlSkills` to
// `auto` AND (when 0020 lands) `autonomy` to `manual` at the same time. Two rules, one file,
// opposite directions. `hosts` is a third direction again — it resolves to EMPTY, because a report
// that invents an install is worse than one that admits it cannot tell.
//
// A whole-file fail-closed parser passes a test that only checks `hosts`. So the cases below are
// split in two, and the split is the contract: when the FILE is unreadable both keys fall to their
// own safe value in one call, and when ONE KEY is bad the other is untouched. A file-wide rule
// passes the first group and fails the second, in both directions.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig, recordHosts, CONFIG } from './config.mjs';

function repo(t, contents) {
  const dir = mkdtempSync(join(tmpdir(), 'mlspecs-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (contents !== undefined) writeFileSync(join(dir, CONFIG), contents);
  return dir;
}

describe('AC12 — fail open per key, never per file', () => {
  // The FILE is unreadable: there are no keys to resolve, so both fall to their own safe value —
  // and they fall in opposite directions, which is the thing a file-wide rule cannot express.
  const unreadable = {
    'unparseable JSON': '{ "mlSkills": "off", ',
    'an array at the top level': '["off"]',
    'a bare string': '"off"',
    'null': 'null',
    'empty': '',
  };

  for (const [what, text] of Object.entries(unreadable)) {
    test(`${what}: hosts → empty AND mlSkills → auto, in one call`, (t) => {
      const cfg = readConfig(repo(t, text));
      assert.deepEqual(cfg.hosts, [], 'an install was claimed that nothing recorded');
      assert.equal(cfg.mlSkills, 'auto',
        'the gate was silently switched off by an unreadable file — fail open, never into off');
    });
  }

  // One KEY is bad and the other is fine. This is the sharper half, and the half a whole-file
  // parser gets wrong in both directions: it would discard a good value because a sibling is bad.
  test('a bad hosts does not disturb a good mlSkills', (t) => {
    for (const text of ['{ "mlSkills": "off", "hosts": "cursor" }',
                        '{ "mlSkills": "off", "hosts": ["cursor", 7] }']) {
      const cfg = readConfig(repo(t, text));
      assert.deepEqual(cfg.hosts, [], `hosts was trusted: ${text}`);
      assert.equal(cfg.mlSkills, 'off',
        'a valid mlSkills was discarded because hosts was malformed — that is a file-wide rule');
    }
  });

  test('a bad mlSkills does not disturb a good hosts', (t) => {
    const cfg = readConfig(repo(t, '{ "mlSkills": "sometimes", "hosts": ["cursor"] }'));
    assert.equal(cfg.mlSkills, 'auto', 'an unrecognised value did not fail open');
    assert.deepEqual(cfg.hosts, ['cursor'], 'a valid hosts array was discarded because a sibling key was bad');
  });

  test('an absent file is not an error — it is the common case in an adopting repo', (t) => {
    const cfg = readConfig(repo(t, undefined));
    assert.deepEqual(cfg, { mlSkills: 'auto', hosts: [] });
  });

  test('a well-formed file is read as written', (t) => {
    const cfg = readConfig(repo(t, '{ "mlSkills": "off", "hosts": ["cursor", "zed"] }'));
    assert.equal(cfg.mlSkills, 'off');
    assert.deepEqual(cfg.hosts, ['cursor', 'zed']);
  });

  test('readConfig never throws, whatever it is handed', (t) => {
    for (const text of [...Object.values(unreadable), '0', '{"hosts": 7}', '{"mlSkills": null}']) {
      assert.doesNotThrow(() => readConfig(repo(t, text)), `threw on ${JSON.stringify(text)}`);
    }
  });
});

describe('AC12 — recording an install', () => {
  test('creates the file when there is none', (t) => {
    const dir = repo(t, undefined);
    recordHosts(dir, ['cursor']);
    assert.ok(existsSync(join(dir, CONFIG)));
    assert.deepEqual(readConfig(dir).hosts, ['cursor']);
  });

  test('is idempotent — a second install does not duplicate the id', (t) => {
    const dir = repo(t, '{ "hosts": ["cursor"] }');
    const r = recordHosts(dir, ['cursor', 'zed']);
    assert.deepEqual(r.added, ['zed'], 'cursor was re-added');
    assert.deepEqual(readConfig(dir).hosts, ['cursor', 'zed']);

    recordHosts(dir, ['cursor', 'zed']);
    assert.deepEqual(readConfig(dir).hosts, ['cursor', 'zed'], 'ids accumulated on a repeat install');
  });

  test('every other key survives, comments included and in order', (t) => {
    // This repo's own `.ml-specs.json` carries its documentation in `//`, `//1` … keys. They are
    // the only explanation of the flag a reader gets, and a "write a clean config" convenience
    // would drop them silently.
    const original = JSON.stringify({
      '//': 'why this file exists',
      mlSkills: 'off',
      '//1': 'and a second line of it',
    }, null, 2);
    const dir = repo(t, original);

    recordHosts(dir, ['cursor']);
    const after = JSON.parse(readFileSync(join(dir, CONFIG), 'utf8'));

    assert.equal(after['//'], 'why this file exists');
    assert.equal(after['//1'], 'and a second line of it');
    assert.equal(after.mlSkills, 'off', 'writing hosts changed an unrelated key');
    assert.deepEqual(Object.keys(after), ['//', 'mlSkills', '//1', 'hosts'],
      'the comment keys moved — a reader loses the order the explanation was written in');
  });

  test('a malformed hosts is REFUSED, not replaced', (t) => {
    // This test used to assert the opposite, and the opposite was the defect: a `hosts` value
    // that is present and not an array of strings is data somebody put there on purpose, and
    // overwriting it takes any valid entries beside it. Reader and writer diverge here — the
    // reader still fails open to empty, the writer refuses.
    const original = '{ "mlSkills": "off", "hosts": "cursor" }';
    const dir = repo(t, original);
    const r = recordHosts(dir, ['zed']);

    assert.match(r.refused ?? '', /could not be read as JSON/, 'the writer replaced it anyway');
    assert.equal(readFileSync(join(dir, CONFIG), 'utf8'), original, 'the file was rewritten');
    assert.deepEqual(readConfig(dir).hosts, [], 'the reader should still fail open to empty');
    assert.equal(readConfig(dir).mlSkills, 'off', 'the reader lost a sibling key');
  });

  test('a hosts holding a non-string entry does not cost the valid ones', (t) => {
    const original = '{ "hosts": ["cursor", { "id": "zed" }] }';
    const dir = repo(t, original);
    recordHosts(dir, ['codex']);
    assert.equal(readFileSync(join(dir, CONFIG), 'utf8'), original,
      'a valid "cursor" entry was destroyed alongside the malformed one');
  });

  test('a symlinked config is never followed', (t) => {
    // The installer's third write target, and the one that had no guard: `existsSync`,
    // `readFileSync` and `writeFileSync` all follow a link.
    const dir = repo(t, undefined);
    const victim = mkdtempSync(join(tmpdir(), 'mlspecs-cfgvictim-'));
    t.after(() => rmSync(victim, { recursive: true, force: true }));
    symlinkSync(join(victim, 'planted.json'), join(dir, CONFIG));

    const r = recordHosts(dir, ['cursor']);
    assert.match(r.refused ?? '', /could not be read as JSON/);
    assert.equal(existsSync(join(victim, 'planted.json')), false, 'a file was created outside');
  });

  test('a successful write leaves no temp file', (t) => {
    const dir = repo(t, '{ "mlSkills": "off" }');
    recordHosts(dir, ['cursor']);
    assert.deepEqual(readdirSync(dir).filter((f) => f.includes('.tmp-')), []);
  });
});
