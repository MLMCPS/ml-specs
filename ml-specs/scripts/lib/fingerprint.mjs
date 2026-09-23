// Hashing the files a verdict was taken against.
//
// A gate's PASS is a statement about a tree at a moment. `spec-gate.mjs` checks that every test
// §6 names exists on disk — which is true when it runs and may not be true a fortnight later,
// after somebody deletes a test or rewrites the module it covers. Nothing recorded what the gate
// read, so nothing could ever answer "is that still true?".
//
// This is the smallest thing that makes the question answerable: a path and a hash per file the
// gate actually looked at, and a digest over the record so an edit to it is detectable.
//
// Deliberately smaller than it could be. No directory expansion and no exclusion rules: every
// radius here is an EXPLICIT list of files (the tests §6 names, the files the branch changed),
// so there is nothing to expand and nothing to exclude. A version that walked declared
// directories would need both, and would be guessing at a `Touches` row these specs do not have.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Stable JSON: object keys sorted at every depth, so re-serialising a record is not an edit.
 * `undefined` and a missing key hash alike — a field that does not exist yet must not change
 * the digest of a record written before it existed.
 */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

export const digest = (value) => sha256(canonical(value));

/**
 * @param {string} root
 * @param {string[]} paths  repo-relative, explicit
 * @returns {Array<{path: string, sha256: string|null}>} sorted, deduplicated
 *
 * A file that cannot be read is recorded with a null hash rather than dropped: leaving it out
 * would make an unreadable file indistinguishable from one nobody named.
 */
export function hashFiles(root, paths) {
  const seen = [...new Set((paths || []).filter(Boolean).map(String))].sort();
  return seen.map((path) => {
    try {
      return { path, sha256: sha256(readFileSync(join(root, path))) };
    } catch {
      return { path, sha256: null };
    }
  });
}

/**
 * @returns {{changed: string[], removed: string[], unreadable: string[]}}
 * Empty everywhere means the files this verdict rested on are byte-identical to what it read.
 *
 * `added` is deliberately not reported. A file that appeared since is not something the gate
 * got wrong — it is something the gate never saw, which is the next gate's business.
 */
export function compare(root, inputs) {
  const changed = [];
  const removed = [];
  const unreadable = [];
  for (const { path, sha256: was } of inputs || []) {
    let now;
    try {
      now = sha256(readFileSync(join(root, path)));
    } catch (e) {
      (e.code === 'ENOENT' ? removed : unreadable).push(path);
      continue;
    }
    if (was === null) unreadable.push(path);
    else if (now !== was) changed.push(path);
  }
  return { changed, removed, unreadable };
}
