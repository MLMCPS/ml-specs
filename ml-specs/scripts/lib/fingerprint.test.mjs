// Hashing the files a verdict was taken against.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256, canonical, digest, hashFiles, compare } from './fingerprint.mjs';

function repo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'mlspecs-fp-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.mjs'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'src', 'b.mjs'), 'export const b = 2;\n');
  return dir;
}

test('canonical JSON does not depend on key order, so re-serialising is not an edit', () => {
  assert.equal(canonical({ b: 1, a: 2 }), canonical({ a: 2, b: 1 }));
  assert.equal(canonical({ x: { q: 1, p: 2 } }), canonical({ x: { p: 2, q: 1 } }));
  assert.notEqual(canonical({ a: 1 }), canonical({ a: 2 }));
});

test('a missing key and an undefined value hash alike', () => {
  // A field that does not exist yet must not change the digest of a record written before it
  // existed — that is what lets an older record still verify.
  assert.equal(digest({ a: 1, b: undefined }), digest({ a: 1, b: null }));
});

test('hashFiles is sorted and deduplicated, so declaration order is not meaning', (t) => {
  const dir = repo(t);
  const one = hashFiles(dir, ['src/b.mjs', 'src/a.mjs', 'src/a.mjs']);
  assert.deepEqual(one.map((f) => f.path), ['src/a.mjs', 'src/b.mjs']);
  assert.equal(one[0].sha256, sha256('export const a = 1;\n'));
});

test('a file that cannot be read is recorded with a null hash, never dropped', (t) => {
  const dir = repo(t);
  // Dropping it would make an unreadable file indistinguishable from one nobody named.
  const out = hashFiles(dir, ['src/a.mjs', 'src/gone.mjs']);
  assert.deepEqual(out.map((f) => f.path), ['src/a.mjs', 'src/gone.mjs']);
  assert.equal(out.find((f) => f.path === 'src/gone.mjs').sha256, null);
});

test('compare reports changed and removed, and says nothing about added', (t) => {
  const dir = repo(t);
  const inputs = hashFiles(dir, ['src/a.mjs', 'src/b.mjs']);
  assert.deepEqual(compare(dir, inputs), { changed: [], removed: [], unreadable: [] });

  writeFileSync(join(dir, 'src', 'a.mjs'), 'export const a = 99;\n');
  rmSync(join(dir, 'src', 'b.mjs'));
  writeFileSync(join(dir, 'src', 'c.mjs'), 'export const c = 3;\n');

  const after = compare(dir, inputs);
  assert.deepEqual(after.changed, ['src/a.mjs']);
  assert.deepEqual(after.removed, ['src/b.mjs']);
  // A file that appeared since is not something the gate got wrong — it is something the gate
  // never saw, which is the next gate's business.
  assert.equal(JSON.stringify(after).includes('c.mjs'), false);
});

test('an unreadable file is neither changed nor unchanged', (t) => {
  const dir = repo(t);
  const inputs = hashFiles(dir, ['src/a.mjs']);
  chmodSync(join(dir, 'src', 'a.mjs'), 0o000);
  t.after(() => { try { chmodSync(join(dir, 'src', 'a.mjs'), 0o644); } catch { /* gone */ } });

  const out = compare(dir, inputs);
  // Reporting it as changed would be an accusation nobody can act on; reporting it as unchanged
  // would be a claim about bytes nothing read.
  assert.deepEqual(out.changed, []);
  assert.deepEqual(out.unreadable, ['src/a.mjs']);
});
