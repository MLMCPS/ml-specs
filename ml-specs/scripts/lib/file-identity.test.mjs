import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { identical } from './file-identity.mjs';

// Everything happens under a temp tree — this helper exists to guard copies of tracked files,
// so its own test must never touch one.
let dir, a, b;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sdd-'));
  a = join(dir, 'a.mjs');
  b = join(dir, 'b.mjs');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('file-identity', () => {
  test('two identical files are identical', () => {
    writeFileSync(a, 'export const x = 1;\n');
    writeFileSync(b, 'export const x = 1;\n');
    assert.equal(identical(a, b), true);
  });

  test('one byte of difference is not identical', () => {
    writeFileSync(a, 'export const x = 1;\n');
    writeFileSync(b, 'export const x = 2;\n');
    assert.equal(identical(a, b), false);
  });

  test('a missing file is not identical, and does not throw', () => {
    writeFileSync(a, 'export const x = 1;\n');
    assert.equal(identical(a, join(dir, 'gone.mjs')), false);
    assert.equal(identical(join(dir, 'gone.mjs'), a), false);
  });
});
