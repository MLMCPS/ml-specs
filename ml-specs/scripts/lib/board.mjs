// Board-wide operations: the next number, the whole board's gates, and what shipped. Spec 0036.
//
// Three manual steps this replaces, and each was manual because the answer was derivable and
// nobody had derived it.
//
// THE NEXT NUMBER was picked by looking, and `specs/README.md` already says numbers are never
// reused. `nextSpecNumber` lived inside the MCP server, where a model could call it and a shell
// user could not — so it moves here and both consume one implementation. It is the better answer
// too: it reads every branch, not just the working tree, because two people speccing in parallel
// otherwise both take the next number and collide at merge.
//
// THE BOARD'S GATES ran one spec at a time by design, so "is this whole board honest" meant
// running the gate N times and reading N outputs, which nobody does.
//
// WHAT SHIPPED was written from memory, while every merged spec already says what it changed and
// why in its Revisions table.
//
// A `lib/` module never consoles. It returns results; the caller prints them.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { listSpecs } from './specs.mjs';
import { lines } from './text.mjs';

const git = (root, ...args) => {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

/**
 * The next unused spec number, across every branch this machine can see.
 *
 * Returns the warning rather than swallowing it: a number derived from an un-fetched remote can
 * collide, and a caller told "0042" with no caveat has no way to know that.
 *
 * @param {string} root
 * @param {{fetch?: boolean}} [opts]  `fetch: false` for tests, which must not touch a network
 */
export function nextSpecNumber(root = process.cwd(), opts = {}) {
  // `s.id`, not `s.number`. The version this moved out of the MCP server read `s.number`, which
  // `listSpecs` does not return — so every working-tree spec contributed NaN and the count came
  // from the git-log scan alone. A spec written but not yet committed was invisible, which is
  // exactly the spec most likely to be sitting there when somebody asks for the next number.
  const used = new Set();
  for (const s of listSpecs(root)) {
    const n = Number(s.id);
    if (Number.isFinite(n)) used.add(n);
  }

  const hasRemote = git(root, 'remote') !== '';
  let fetched = false;
  if (hasRemote && opts.fetch !== false) {
    try {
      execFileSync('git', ['-C', root, 'fetch', '--quiet'], { stdio: 'ignore' });
      fetched = true;
    } catch {
      fetched = false;   // offline, or no credentials — reported below, never silently assumed
    }
  }

  // command output: `git log --name-only`, not a file somebody's editor wrote.
  const historical = git(root,
    'log', '--all', '--pretty=format:', '--name-only', '--diff-filter=A', '--', 'specs/[0-9]*');
  for (const line of historical.split('\n')) {
    const m = basename(line.trim()).match(/^(\d{4})-/);
    if (m) used.add(Number(m[1]));
  }

  const max = used.size ? Math.max(...used) : 0;
  return {
    next: String(max + 1).padStart(4, '0'),
    highestUsed: used.size ? String(max).padStart(4, '0') : null,
    countUsed: used.size,
    scannedAllBranches: historical !== '',
    remoteChecked: fetched,
    warning: fetched ? null
      : hasRemote
        ? 'Remote exists but fetch failed (offline or no credentials) — branches you have not '
          + 'pulled were not counted, so a collision is possible.'
        : 'No git remote — only local branches were counted.',
  };
}

/** A slug that will not become a path, a hidden file, or a name git dislikes. */
export function usableSlug(slug) {
  if (typeof slug !== 'string' || !slug.trim()) return 'a slug is required';
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return `'${slug}' is not a usable slug — lowercase letters, digits and hyphens, starting with a letter or digit`;
  }
  if (slug.length > 60) return `'${slug}' is ${slug.length} characters — keep a filename readable`;
  return null;
}

export const RIGORS = Object.freeze(['light', 'standard', 'deep']);

/**
 * What shipped, from the specs that shipped it.
 *
 * A spec with no `Revisions` table contributes its title alone — `specs/TEMPLATE.md:31-33` says to
 * skip that section entirely when a spec was approved first pass, so treating its absence as a
 * defect would punish the specs that went smoothest.
 *
 * @param {string} root
 * @param {string[]} statuses  which statuses count as shipped
 */
export function shipped(root = process.cwd(), statuses = ['Verified', 'Archived']) {
  return listSpecs(root)
    .filter((s) => statuses.includes(s.status))
    .map((s) => {
      const text = existsSync(join(root, s.file)) ? readFileSync(join(root, s.file), 'utf8') : '';
      const rows = lines(text)
        .filter((l) => /^\|\s*\d+\s*\|/.test(l))
        .map((l) => l.split('|').map((c) => c.trim()))
        .filter((c) => c.length >= 4)
        .map((c) => ({ n: Number(c[1]), what: c[2], why: c[3] }));
      // `s.id` again — the same field name that made nextSpecNumber count nothing.
      return { number: s.id, title: s.title, status: s.status, revisions: rows };
    })
    .sort((a, b) => Number(a.number) - Number(b.number));
}

/**
 * Splice a section into a changelog, leaving every other section byte-identical.
 *
 * Returns the new text rather than writing it, so a dry run and a real one share one code path —
 * the difference is whether the caller writes, which is the only way "--write changed nothing
 * else" is provable by comparison.
 */
export function spliceUnreleased(changelog, body) {
  const rows = lines(changelog);
  const start = rows.findIndex((l) => /^##\s*\[Unreleased\]/i.test(l));
  if (start === -1) return { text: changelog, error: 'no [Unreleased] section to splice into' };

  let end = rows.length;
  for (let i = start + 1; i < rows.length; i++) {
    if (/^##\s/.test(rows[i])) { end = i; break; }
  }
  const next = [...rows.slice(0, start + 1), '', ...lines(body), '', ...rows.slice(end)];
  return { text: next.join('\n'), error: null };
}
