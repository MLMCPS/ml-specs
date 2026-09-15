// Byte-identity between two files on disk.
//
// Pure Node, no dependencies. Reads two files; writes nothing.
//
// Some files in this repo are kept as exact copies of each other — the CI knowledge-check is
// byte-identical to the template that seeds it into adopting repos. That invariant was prose
// only, asserted in a doc and checked by nobody, which is how two copies drift and the shipped
// one quietly rots. It lives here rather than inline in a script because a script that hardcodes
// its own root can only be tested by mutating tracked files; a function taking two paths is
// testable over temp files.

import { readFileSync, existsSync } from 'node:fs';

/**
 * Are the two files byte-for-byte identical?
 * A missing file on either side is not identical — never a throw, so a caller accumulating
 * errors keeps going.
 * @param {string} a absolute or cwd-relative path
 * @param {string} b absolute or cwd-relative path
 * @returns {boolean}
 */
export function identical(a, b) {
  if (!existsSync(a) || !existsSync(b)) return false;
  return readFileSync(a).equals(readFileSync(b));
}
