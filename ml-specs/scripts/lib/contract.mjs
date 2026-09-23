// The part of a spec a gate actually reasoned about, and whether it still says that.
//
// `specs/` is always writable — it has to be, or nobody could fix a spec. So the sequence that
// costs nothing is: pass the gate, then soften the criterion it passed against. The status goes
// on reading `Verified`, the evidence record goes on reading `fresh` — every file it fingerprinted
// is byte-identical, because the thing that changed was the spec — and no command can tell.
//
// Two shapes of that, both real:
//
//   * delete or reword AC1 after the gate checked it was ticked
//   * repoint §6's AC1 row at a different test file
//
// The second is invisible to the file hashes by construction: the record holds the OLD path's
// hash, the old file still exists unchanged, and the spec now claims something else proves the
// criterion. Only comparing the claim catches it.
//
// ── What is hashed, and what deliberately is not ────────────────────────────────────────────
//
// In:  each criterion's id and text; the §6 test tokens as the spec writes them.
// Out: whether a criterion is TICKED — ticking a box is progress, not an amendment, and the gate
//      checks the ticks itself every run. Out: Status, Branch, Date, Author, and every prose
//      section — rewriting the explanation of a contract is not rewriting the contract, and
//      treating it as such would make improving a spec look like tampering.

import { parseCriteria } from './specs.mjs';
import { digest } from './fingerprint.mjs';

/**
 * @param {string} text  the spec document
 * @param {string[]} claimed  §6 tokens as written, from `spec-gate.mjs --json`.`claimed`
 * @returns {{criteria: Array<{id, text}>, tests: string[], digest: string}}
 *
 * `claimed` is a parameter rather than re-extracted here: `spec-gate.mjs` owns that reading, and
 * a second implementation of "which tests does §6 name" would drift from the one the gate used —
 * which would mean the record disagreed with the verdict it was recording.
 */
export function contractOf(text, claimed = []) {
  const criteria = parseCriteria(text)
    .map((c) => ({ id: c.id, text: String(c.text).trim() }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const tests = [...new Set((claimed || []).map((t) => String(t).trim()).filter(Boolean))].sort();
  return { criteria, tests, digest: digest({ criteria, tests }) };
}

/**
 * What changed between the contract a gate read and the contract on disk now.
 *
 * Every change carries its DIRECTION, because they are not equally alarming and a reader
 * deciding what to do has to tell them apart: a criterion removed after the gate passed is the
 * case this file exists for; one added is scope the gate never saw; a test row repointed means
 * something else now claims to prove a criterion that was checked against something else.
 *
 * @returns {Array<{kind: string, text: string}>} empty when the contract still stands
 */
export function changes(stored, current) {
  if (!stored) return [];
  const out = [];

  const was = new Map((stored.criteria || []).map((c) => [c.id, c.text]));
  const now = new Map((current.criteria || []).map((c) => [c.id, c.text]));

  for (const [id, text] of was) {
    if (!now.has(id)) out.push({ kind: 'criterion-removed', text: `${id} is gone — the gate passed against it` });
    else if (now.get(id) !== text) out.push({ kind: 'criterion-reworded', text: `${id} now reads differently than when it passed` });
  }
  for (const id of now.keys()) {
    if (!was.has(id)) out.push({ kind: 'criterion-added', text: `${id} was added after the gate ran — nothing has checked it` });
  }

  const wasT = new Set(stored.tests || []);
  const nowT = new Set(current.tests || []);
  const gone = [...wasT].filter((x) => !nowT.has(x));
  const fresh = [...nowT].filter((x) => !wasT.has(x));
  if (gone.length) out.push({ kind: 'test-plan-narrowed', text: `§6 no longer names ${gone.join(', ')} — the gate passed when it did` });
  if (fresh.length) out.push({ kind: 'test-plan-widened', text: `§6 now also names ${fresh.join(', ')}, which nothing has checked` });

  return out;
}
