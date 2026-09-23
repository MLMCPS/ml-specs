// What the guard decided, and why.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { record, read, summary, LOG } from './activity.mjs';

const dir = (t) => {
  const d = mkdtempSync(join(tmpdir(), 'mlspecs-act-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
};

test('one line per decision, both directions', (t) => {
  const d = dir(t);
  record(d, { decision: 'allow', spec: 'specs/0001-a.md', files: ['src/a.ts'], tool: 'Write' });
  record(d, { decision: 'block', spec: 'specs/0001-a.md', files: ['src/b.ts'], tool: 'Bash', reason: 'outside the scope' });
  const all = read(d);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((e) => e.decision), ['allow', 'block']);
  assert.equal(all[1].tool, 'Bash');
});

test('SENSOR: the proposed CONTENT is never written', (t) => {
  const d = dir(t);
  // The guard receives what an agent is about to write. A second copy of somebody's source in a
  // log file is a worse leak than anything the guard prevents.
  record(d, {
    decision: 'block',
    files: ['src/keys.ts'],
    reason: 'outside the scope',
    content: 'const AWS_SECRET = "AKIAIOSFODNN7EXAMPLE";',
    payload: { tool_input: { content: 'secret' } },
  });
  const raw = readFileSync(join(d, LOG), 'utf8');
  assert.doesNotMatch(raw, /AKIA/, 'the proposed content reached the log');
  assert.doesNotMatch(raw, /content/, 'a content field reached the log');
  assert.match(raw, /src\/keys\.ts/, 'the path is what a reader needs and is kept');
});

test('SENSOR: failing to write the log never throws', (t) => {
  const d = dir(t);
  mkdirSync(join(d, '.ml-specs'), { recursive: true });
  chmodSync(join(d, '.ml-specs'), 0o500);
  t.after(() => { try { chmodSync(join(d, '.ml-specs'), 0o755); } catch { /* gone */ } });

  // A guard that refuses a write because it could not open its own log file is refusing for a
  // reason that has nothing to do with scope — the fastest way to lose the argument for having one.
  assert.doesNotThrow(() => record(d, { decision: 'block', files: ['src/a.ts'] }));
});

test('a half-written line is noise, not a decision', (t) => {
  const d = dir(t);
  record(d, { decision: 'allow', files: ['src/a.ts'] });
  writeFileSync(join(d, LOG), `${readFileSync(join(d, LOG), 'utf8')}{"decision":"blo`);
  // An interrupted process leaves one of these. Counting it would put a phantom in the summary.
  assert.equal(read(d).length, 1);
});

test('a large payload is capped, and says how much it dropped', (t) => {
  const d = dir(t);
  record(d, { decision: 'block', files: Array.from({ length: 30 }, (_, i) => `src/f${i}.ts`) });
  const e = read(d)[0];
  assert.equal(e.files.length, 12);
  assert.equal(e.more, 18, 'a silent cap reads as "that was all of them"');
});

test('the summary answers the question the rollout turns on', (t) => {
  const d = dir(t);
  for (let i = 0; i < 8; i += 1) record(d, { decision: 'allow', files: ['src/a.ts'] });
  record(d, { decision: 'block', spec: 'specs/0001-a.md', files: ['src/other.ts'] });
  record(d, { decision: 'block', spec: 'specs/0001-a.md', files: ['src/other.ts'] });

  const s = summary(read(d));
  assert.equal(s.total, 10);
  assert.equal(s.blocked, 2);
  assert.equal(s.blockRate, 0.2);
  assert.deepEqual(s.bySpec, { 'specs/0001-a.md': 2 });
  // A path refused repeatedly either belongs in Touches or belongs in a different spec — either
  // way it is the thing worth reading, so it has to be countable.
  assert.deepEqual(s.topPaths[0], ['src/other.ts', 2]);
});

test('no log at all is not an error', (t) => {
  assert.deepEqual(read(dir(t)), []);
});
