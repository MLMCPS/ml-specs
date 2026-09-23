// `.ml-specs.json` — the first production reader.
//
// Until spec 0028 nothing in this repo parsed this file. `mlSkills` is honoured by PROSE, at the
// four sites `mlskills-flag-wiring.test.mjs:58-63` enumerates, and the only code that had ever
// opened it was that test. So this is not an extension of an existing parser; it is the first one,
// and it sets the convention the next key inherits.
//
// THE FAIL-OPEN RULE IS PER KEY, NOT PER FILE
//
// This is forced, not chosen. `specs/0020-autonomy-levels.md:62-65` records that one malformed
// `.ml-specs.json` must resolve `mlSkills` → `auto` AND `autonomy` → `manual` at the same time:
// two rules, one file, opposite directions. Today's prose says "no file, no key, unreadable JSON,
// unrecognised value … fail open" in FILE-WIDE terms, which cannot be true of both.
//
// `hosts` is a third direction again. It resolves to EMPTY on anything unexpected, because the
// safe failure is "we know of no install" and never "these hosts are installed" — a report that
// invents an install is worse than one that admits it cannot tell.
//
// Nothing here throws. A caller asking what the config says must always get an answer.

import { readFileSync, writeFileSync, renameSync, unlinkSync, lstatSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const CONFIG = '.ml-specs.json';

/** `mlSkills` values the contract defines. `mlskills-flag-wiring.test.mjs:31` is the other copy. */
const ML_SKILLS = ['off', 'auto'];

/**
 * Read the raw object. Never throws.
 *
 * ABSENT and UNREADABLE are different answers, and collapsing them is what made the writer
 * destructive: a file with a trailing comma or a JSONC comment parsed as `null`, the writer read
 * that as "there is nothing here", and replaced the whole file — silently dropping `mlSkills` and
 * returning the architecture-standards gate to its fail-open default. For a READER the two are
 * the same (both fail open); for a WRITER they are opposites.
 *
 * @returns {{state: 'absent'|'unreadable'|'ok', value: object|null}}
 */
function raw(root) {
  const path = join(root, CONFIG);
  // A symlink is `unreadable`, whatever it points at. The installer guards its two other write
  // targets — the shims and the canonical document — by resolving them and refusing a link; this
  // is the third, and it had neither. A `.ml-specs.json` symlinked out of a cloned repository
  // created a file at an attacker-chosen absolute path, or rewrote an existing JSON file in
  // place, at exit 0 with a clean report. `existsSync`, `readFileSync` and `writeFileSync` all
  // follow links, so the check has to be `lstat`.
  try { if (lstatSync(path).isSymbolicLink()) return { state: 'unreadable', value: null }; } catch { /* absent */ }
  if (!existsSync(path)) return { state: 'absent', value: null };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { state: 'unreadable', value: null };
    // A `hosts` that is present and not an array of strings is data somebody put there on
    // purpose — `{"cursor": {"pinned": true}}`, or a list holding an object. Treating it as
    // absent let the writer overwrite it, taking valid entries beside it. For a READER it still
    // fails open to empty; for the WRITER it is a refusal.
    if ('hosts' in parsed
        && !(Array.isArray(parsed.hosts) && parsed.hosts.every((h) => typeof h === 'string'))) {
      return { state: 'unreadable', value: parsed };
    }
    return { state: 'ok', value: parsed };
  } catch {
    return { state: 'unreadable', value: null };
  }
}

/**
 * Every key resolved independently, each toward its own safe answer.
 *
 * @param {string} root
 * @returns {{mlSkills: 'off'|'auto', hosts: string[]}}
 */
export function readConfig(root) {
  const cfg = raw(root).value ?? {};
  return {
    // Fail open to `auto`: the gate runs and reports rather than silently skipping.
    mlSkills: ML_SKILLS.includes(cfg.mlSkills) ? cfg.mlSkills : 'auto',
    // Fail closed to empty: claiming an install that is not there is the harmful direction.
    hosts: Array.isArray(cfg.hosts) && cfg.hosts.every((h) => typeof h === 'string')
      ? [...cfg.hosts]
      : [],
  };
}

/**
 * Record that a host was installed. Idempotent — a second install of the same host does not
 * duplicate the id.
 *
 * Written key-by-key onto the PARSED OBJECT rather than by re-serialising a fresh one, because
 * this repo's own `.ml-specs.json` carries its documentation in `//`, `//1` … keys. A
 * parse-and-restringify keeps them (JSON.stringify preserves insertion order) but a "write a clean
 * config" convenience would not, and the comments are the only explanation of the flag a reader
 * gets.
 *
 * @returns {{added: string[], hosts: string[]}} what changed, for the report
 */
export function recordHosts(root, ids) {
  const path = join(root, CONFIG);
  const { state, value } = raw(root);

  // Refuse rather than replace. `CLAUDE.md`'s "never silently overwrite a user's file" is the
  // rule, and this is the shape it takes here: a file we cannot parse may still hold an
  // `mlSkills` opt-out and a block of `//` documentation, and recording a host is not worth
  // destroying either. Same posture as the installer's `foreign` refusal on a shim.
  if (state === 'unreadable') {
    return { added: [], hosts: [], refused: `${CONFIG} could not be read as JSON — leaving it alone rather than replacing it` };
  }

  const existing = value ?? {};
  const current = Array.isArray(existing.hosts) && existing.hosts.every((h) => typeof h === 'string')
    ? [...existing.hosts]
    : [];

  const added = ids.filter((id) => !current.includes(id));
  const hosts = [...current, ...added];

  try {
    // Written to a sibling and renamed. `writeFileSync` opens with O_TRUNC, so a failure after
    // the truncate and before the content lands leaves an empty file — and the catch below would
    // then report a refusal for a file it had already destroyed. `renameSync` on the same
    // filesystem is atomic.
    const tmp = `${path}.tmp-${process.pid}`;
    try {
      writeFileSync(tmp, `${JSON.stringify({ ...existing, hosts }, null, 2)}\n`);
      renameSync(tmp, path);
    } catch (e) {
      try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* nothing more to do */ }
      throw e;
    }
  } catch (e) {
    // A directory where the file should be, a read-only tree. The shims are already on disk by
    // the time this runs, so throwing here would abandon the install mid-way with a stack trace.
    return { added: [], hosts: current, refused: `could not write ${CONFIG}: ${e.message}` };
  }
  return { added, hosts, refused: null };
}
