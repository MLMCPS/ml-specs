// One definition of "is this path inside that declaration".
//
// Two checks have to agree about this and they are asked at different moments: the guard, before
// an edit lands, and any later reader asking whether a branch stayed inside what its spec
// declared. Two copies of that rule drift, and the way it shows up is the worst possible one —
// the guard allows a write and something afterwards calls the same file out of scope, or the
// reverse. So it lives here and is imported, never re-derived.
//
// A declaration covers a path when it IS that path or is a directory prefix of it. Nothing
// fancier: no globs, no regex. A `Touches` row is read by people first, and a bound somebody
// has to parse is a bound they will get wrong.

import { resolve, relative, isAbsolute, sep } from 'node:path';

/** Strip backticks, a `./` prefix and any trailing slash, so declarations compare on meaning. */
export function norm(path) {
  return String(path).replace(/[`*]/g, '').replace(/^\.\//, '').replace(/\/+$/, '').trim();
}

/**
 * Case is folded on macOS and Windows, where the default volume folds it.
 *
 * `src/Billing/x.ts` and `src/billing/x.ts` are ONE file there, and refusing the first while
 * allowing the second is a false block on the platform most of this is written on. The
 * trade-off, stated rather than hidden: on a case-sensitive volume mounted on one of those
 * platforms two genuinely different files compare equal, and a write that should be blocked is
 * allowed. That is the fail-open direction, which is the one to choose on purpose.
 */
const FOLDS = process.platform === 'darwin' || process.platform === 'win32';
const fold = (p) => (FOLDS ? p.toLowerCase() : p);

/** A declared path covers another when it is equal to it, or is a directory prefix of it. */
export function covers(declared, file) {
  const d = fold(norm(declared));
  const f = fold(norm(file));
  return d === '' || f === d || f.startsWith(`${d}/`);
}

/**
 * Paths every spec may always write, whatever its `Touches` says.
 *
 * `specs/` is here because a spec that blocks you has to be editable — the fix for an
 * out-of-scope change is very often to widen the declaration, and a rule you cannot amend is one
 * people route around. `.ml-specs/` is the toolkit's own bookkeeping, which it writes itself;
 * counting that as the author's change would have the guard refuse the evidence record that the
 * guard's own transition writes.
 */
export const ALWAYS_WRITABLE = ['specs', '.ml-specs'];

/**
 * Turn any path into one that is comparable with a declaration: repo-relative, normalised.
 *
 * A relative path is resolved against the root BEFORE anything compares it. `covers` is a prefix
 * test, so `src/lib/../../../escape/x.mjs` "starts with" `src/lib/` and would be allowed — a
 * write that lands outside the repository entirely. Resolving first is what closes that.
 *
 * @returns {string} repo-relative when inside the repository; the absolute path when outside,
 * which no declaration can cover and which names the file the writer actually meant.
 */
export function toRepoRelative(root, file) {
  const absolute = isAbsolute(file) ? resolve(file) : resolve(root, file);
  const rel = relative(resolve(root), absolute);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? norm(rel.split(sep).join('/')) : absolute;
}

/**
 * @param {string[]} declared  the spec's `Touches`
 * @param {string[]} files     repo-relative paths
 * @returns {string[]} the ones no declaration covers
 *
 * An empty `declared` returns `[]` — nothing is outside a bound nobody set. The CALLER decides
 * what to do about an unbounded spec; conflating "declared nothing" with "declared nothing is
 * allowed" here would make every unfilled template refuse every write.
 */
export function outside(declared, files) {
  const bounds = [...(declared || []), ...ALWAYS_WRITABLE].map(norm).filter(Boolean);
  if (!(declared || []).length) return [];
  return (files || []).map(norm).filter((f) => f && !bounds.some((d) => covers(d, f)));
}
