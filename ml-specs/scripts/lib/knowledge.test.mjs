import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { read, write, forRepos, staleness, renderForSpec } from './knowledge.mjs';

let dir, path;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sdd-')); path = join(dir, 'docs', 'CONSTRAINTS.md'); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const PERF = { id: 'NFR-03', scope: ['api-neelias'], text: 'stays responsive (p95 < 400ms)' };
const GLOBAL = { id: 'NFR-07', scope: ['*'], text: 'no high findings' };

describe('round trip', () => {
  test('a constraint survives write and read', () => {
    write(path, [PERF]);
    assert.deepEqual(read(path), [PERF]);
  });

  test('an absent store reads as empty, not as an error', () => {
    assert.deepEqual(read(path), []);
    assert.equal(staleness(path), null);
  });

  test('write is an upsert and reports only real changes', () => {
    assert.deepEqual(write(path, [PERF]), ['NFR-03']);
    assert.deepEqual(write(path, [PERF]), []);            // a no-op says so
    assert.deepEqual(write(path, [{ ...PERF, text: 'tightened to 200ms' }]), ['NFR-03']);
    assert.equal(read(path).length, 1);                    // replaced, not duplicated
  });

  test('an empty store still writes a readable file', () => {
    write(path, []);
    assert.match(readFileSync(path, 'utf8'), /_none —/);
  });
});

describe('scope decides what a spec inherits', () => {
  test('estate-wide plus its own', () => {
    write(path, [PERF, GLOBAL]);
    assert.deepEqual(forRepos(read(path), ['api-neelias']).map((c) => c.id), ['NFR-03', 'NFR-07']);
    assert.deepEqual(forRepos(read(path), ['neelias-mobile']).map((c) => c.id), ['NFR-07']);
  });

  test('a spec with no repos yet still inherits the estate-wide ones', () => {
    write(path, [PERF, GLOBAL]);
    assert.deepEqual(forRepos(read(path), []).map((c) => c.id), ['NFR-07']);
  });
});

describe('staleness', () => {
  test('is measured from the recorded date', () => {
    write(path, [PERF], new Date('2026-08-01T00:00:00Z'));
    assert.equal(staleness(path, new Date('2026-09-04T00:00:00Z')), 34);
    assert.equal(staleness(path, new Date('2026-08-01T00:00:00Z')), 0);
  });
});

describe('rendering into a spec', () => {
  test('constraints are put in front of the author', () => {
    const block = renderForSpec([PERF]);
    assert.match(block, /## Constraints in force/);
    assert.match(block, /\*\*NFR-03\*\*/);
  });

  test('nothing in force renders nothing at all', () => {
    assert.equal(renderForSpec([]), '');
  });
});
