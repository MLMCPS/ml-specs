// What a gate read, and whether it still describes this tree.
//
// `spec-gate.mjs` decides the mechanical half of a transition and writes nothing. So a status is
// a claim with no basis on file: pass the gate on Monday, change the module it covered on
// Tuesday, and `Verified` still reads `Verified` with nothing able to notice. The gate was not
// wrong — it was true about a tree that has since moved, and a verdict about a tree has to say
// which tree.
//
// ── Four verdicts, not two ──────────────────────────────────────────────────────────────────
//
//   fresh       every file the gate read is byte-identical, and the spec still says what it said
//   amended     the SPEC moved, not the code — a criterion or a §6 row changed after the gate passed
//   stale       a file the gate read changed or was deleted — re-run the gate
//   unknown     the record cannot be judged (no base, an unreadable file) — never blocks
//   unsound     the record no longer digests to what it claims: it was edited after it was written
//   superseded  the spec does not hold this status — the record for the one it holds is the live
//               one, whether the spec moved past this status or back from it
//
// `unknown` exists so that "could not determine" never collapses into "fine". That collapse is
// the failure this whole file is about, one level down.
//
// `superseded` is the one verdict decided over the SET rather than the record (`supersede()`
// below); `freshness()` cannot see it, because a record in isolation cannot know another exists.
//
// ── The radius ──────────────────────────────────────────────────────────────────────────────
//
// warrant fingerprints a spec's declared `Touches`. These specs have no such row — the header
// carries Status, Branch, Ticket, Project, NFRs, Approver, Author and nothing about scope. So
// the radius is what the spec DOES declare and what git already knows:
//
//   1. the tests §6 names, resolved to real paths by the gate itself
//   2. the files this spec's branch changed against the base
//
// Both are explicit file lists, which is why `fingerprint.mjs` needs no directory expansion.
// Inventing a `Touches` row to copy warrant's radius would be adding a field to every spec in
// order to answer a question git can already answer.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { hashFiles, compare, digest } from './fingerprint.mjs';
import { changes } from './contract.mjs';
// Lifecycle order, for `supersede()` below. `specs.mjs` imports nothing from here, so this is
// not a cycle — and a second copy of the status order is exactly the drift `specs.mjs` exists
// to prevent.
import { LIFECYCLE } from './specs.mjs';

export const DIR = join('.ml-specs', 'evidence');

export const FRESH = 'fresh';
export const STALE = 'stale';
export const UNKNOWN = 'unknown';
export const UNSOUND = 'unsound';
export const AMENDED = 'amended';
export const SUPERSEDED = 'superseded';

/**
 * The verdicts that mean "do not build on this". One set, so a reader cannot miss a new one.
 *
 * `SUPERSEDED` is deliberately NOT here. A record for a status the spec has moved past is history,
 * and history that fires a failure on every successful advance is a signal people stop reading —
 * the argument `spec-gate.mjs` already made about fingerprinting an approval's file radius.
 */
export const FAILING = new Set([STALE, AMENDED, UNSOUND]);
export const isFailing = (verdict) => FAILING.has(verdict);

/**
 * Every field the digest covers — the record's decision-bearing payload.
 *
 * APPEND ONLY, and `DIGEST_HISTORY` below is why. A record's digest is taken over the fields
 * that existed when it was written; widen this list and every record already on disk stops
 * digesting to what it claims, so the integrity check reports them all as hand-edited. That is
 * the loudest accusation this can make, and making it wrongly about correct records costs more
 * than the check is worth.
 */
// V1 gained `contract` before any record had been written under it — the feature and the field
// shipped on the same unreleased branch, so there was nothing on disk to accuse. From here the
// rule above holds strictly: a new field is a NEW entry, never an edit to this one.
const V1 = ['spec', 'to', 'baseBranch', 'baseRev', 'tests', 'changed', 'gates', 'attested', 'contract'];

// V2 adds `amendments`: an acknowledged amendment re-baselines the contract, so the note saying
// WHY has to be inside the digest — otherwise the one field that explains a re-baseline is the
// one field anybody can rewrite afterwards.
//
// Appended rather than edited into V1, which is the whole point of the registry: records written
// before this still verify at their own width instead of being reported as hand-edited.
const V2 = [...V1, 'amendments'];

// V3 adds `at`. Until spec 0026 the timestamp was written into every record and protected by
// nothing, which was harmless while nothing read it. `supersede()` now does: the record at the
// status the `Status` cell claims corroborates that claim only when it is the NEWEST for its spec,
// because an honest transition — forward or backward — always writes the newest record and a
// hand-edited cell cannot. That rule is only as good as `at`, so `at` has to be inside the digest
// or the whole thing is bypassed by editing a timestamp, which today makes no record `unsound`.
//
// Appended, never edited in: every record written at V1 or V2 width still verifies at its own.
const V3 = [...V2, 'at'];

export const DIGEST_HISTORY = [V1, V2, V3];
export const DIGESTED = DIGEST_HISTORY[DIGEST_HISTORY.length - 1];

const recordDigest = (rec, fields = DIGESTED) =>
  digest(Object.fromEntries(fields.map((k) => [k, rec ? rec[k] : null])));

/** Intact at any width it could have been written at. No digest claimed = nothing to disprove. */
export function digestIntact(rec) {
  if (!rec?.recordDigest) return true;
  return DIGEST_HISTORY.some((fields) => recordDigest(rec, fields) === rec.recordDigest);
}

/**
 * Did this record demonstrably come from the gate?
 *
 * `digestIntact()` answers "has this been edited since it was written", and says `true` for a
 * record that claims no digest at all — correct there, because a record making no claim has made
 * no claim to disprove. It is the wrong question for supersession.
 *
 * Supersession lets one record silence another, so the silencer has to PROVE its provenance rather
 * than merely fail to be caught lying. A hand-written JSON file with no `recordDigest` is not an
 * accusation, it is an `unknown` — which never blocks — and before this it could corroborate a
 * hand-edited `Status` cell and turn every other record for that spec into non-failing history.
 * Reproduced end to end: exit 1 became exit 0, and the forged record claimed a HIGHER status than
 * the one it hid.
 *
 * A record that predates digests falls back to index ordering, which is the honest answer about an
 * uncorroborated claim.
 */
export function digestWidth(rec) {
  if (!rec?.recordDigest) return -1;
  return DIGEST_HISTORY.findIndex((fields) => recordDigest(rec, fields) === rec.recordDigest);
}

export const gateWritten = (rec) => digestWidth(rec) >= 0;

/**
 * Can this record's `at` be trusted — does the width it verifies at actually cover it?
 *
 * `digestIntact()` accepts a record at ANY width it could have been written at. That is right as an
 * integrity policy and fatal for a rule resting on a field the older widths do not cover. Measured:
 * all 17 records in this repo verify at V2, where `at` is NOT digested — so adding it at V3
 * protected nothing that existed. Editing `at` on any of them broke no digest, and the recency half
 * of corroboration evaporated.
 *
 * A record whose width predates `at` cannot substantiate a recency claim, so it does not get to
 * make one: corroboration falls through to the index ordering, the same answer the fallback already
 * gives an uncorroborated cell. This is about what the code ACCEPTS — re-recording everything at V3
 * would not fix it, because the next V2 record to arrive walks straight back in.
 */
export const recencySealed = (rec) => {
  const i = digestWidth(rec);
  return i >= 0 && DIGEST_HISTORY[i].includes('at');
};

/**
 * How the judgement behind a record was made: `'human'` or `'unattended'`.
 *
 * An ABSENT `mode` reads `'human'`, never a third state. Every record written before the field
 * existed came from a human-invoked run, so `'human'` is the true answer about all of them — and
 * an `unknown` here would put ambiguity back into the one field that exists to remove it.
 *
 * It lives here rather than in each reader so the default is decided once: `spec-evidence.mjs`
 * and anything added later cannot disagree about what silence means.
 *
 * No new digest width was needed for it. `mode` sits INSIDE `attested`, which is a single entry
 * in the field list above and is digested whole (`recordDigest`) — so it is covered against
 * hand-editing already, and records on disk keep digesting to exactly what they claim.
 */
export const attestMode = (rec) => rec?.attested?.mode ?? 'human';

const nameOf = (specFile, to) => `${basename(specFile, '.md')}-${String(to).toLowerCase()}.json`;

/**
 * Write the record for a transition that passed.
 *
 * Called only after the gate cleared — a record of a failed gate would be a record of nothing.
 *
 * @returns {object} the record as written, with its path
 */
export function record(root, { spec, to, baseBranch = null, baseRev = null, tests = [], changed = [], gates = [], attested = null, contract = null }) {
  const payload = {
    spec,
    to,
    at: new Date().toISOString(),
    baseBranch,
    baseRev,
    // Inside the digest, because an attestation that can be rewritten afterwards is not a
    // signature. `by` is git's idea of who ran this, not a name anybody typed.
    attested,
    // What the gate reasoned about, so softening it afterwards is visible. The file hashes cannot
    // see this: rewording a criterion changes no file the record measured.
    contract,
    tests: hashFiles(root, tests),
    changed: hashFiles(root, changed),
    // id and verdict only. The detail strings carry counts and paths that move for reasons that
    // are not tampering, and digesting them would make a reworded message look like an edit.
    gates: (gates || []).map((g) => ({ name: g.name, verdict: g.verdict })),
  };
  payload.recordDigest = recordDigest(payload);

  const dir = join(root, DIR);
  mkdirSync(dir, { recursive: true });
  const path = join(DIR, nameOf(spec, to));
  writeFileSync(join(root, path), `${JSON.stringify(payload, null, 2)}\n`);
  return { ...payload, path };
}

/**
 * Re-write an existing record, digest recomputed over whatever it now says.
 *
 * Only `spec-amend.mjs` uses this, and only to acknowledge an amendment. It is deliberately not a
 * way to record a NEW verdict: `record()` above is the only thing that writes one, because a
 * record is what a gate produced and this function runs no gate.
 */
export function writeRecord(root, rec) {
  const payload = { ...rec };
  delete payload.path;
  delete payload.recordDigest;
  payload.recordDigest = recordDigest(payload);
  const dir = join(root, DIR);
  mkdirSync(dir, { recursive: true });
  const path = join(DIR, nameOf(payload.spec, payload.to));
  writeFileSync(join(root, path), `${JSON.stringify(payload, null, 2)}\n`);
  return { ...payload, path };
}

export function readRecord(root, specFile, to) {
  const path = join(root, DIR, nameOf(specFile, to));
  if (!existsSync(path)) return null;
  try {
    return { ...JSON.parse(readFileSync(path, 'utf8')), path: join(DIR, nameOf(specFile, to)) };
  } catch {
    // A file somebody hand-edited into invalid JSON makes no claim at all.
    return null;
  }
}

export function listRecords(root) {
  const dir = join(root, DIR);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push({ ...JSON.parse(readFileSync(join(dir, f), 'utf8')), path: join(DIR, f) });
    } catch {
      // skipped on purpose: an unreadable record is reported by `freshness` when asked about a
      // spec, not invented into a listing as a phantom verdict
    }
  }
  return out.sort((a, b) => String(a.spec).localeCompare(String(b.spec)));
}

/**
 * @returns {{verdict: string, reason: string, detail?: object}}
 *
 * Integrity first. A record edited after it was written is not weaker evidence, it is none —
 * so that answer must not be reachable by a later check deciding the files look fine.
 */
export function freshness(root, rec, current = null) {
  if (!rec) return { verdict: UNKNOWN, reason: 'no record — this status was never gated, or predates evidence records' };

  if (!digestIntact(rec)) {
    return {
      verdict: UNSOUND,
      reason: 'this record no longer digests to what it claims — it was edited after the gate wrote it',
    };
  }

  // The spec, before the files. A record whose contract moved is answering about a promise that
  // no longer exists, and reporting the files as byte-identical would be true and beside the point.
  if (rec.contract && current) {
    const diff = changes(rec.contract, current);
    if (diff.length) {
      return {
        verdict: AMENDED,
        reason: `the spec changed after this gate passed — ${diff[0].text}${diff.length > 1 ? ` (and ${diff.length - 1} more)` : ''}`,
        detail: { changes: diff },
      };
    }
  }

  const inputs = [...(rec.tests || []), ...(rec.changed || [])];
  if (!inputs.length) {
    // Not a gap. An `Approved` record has no file radius by design — the transition certifies a
    // contract, and the contract check above is what judges it. Saying "names no file" alone read
    // as a missing measurement and invited somebody to add one back.
    //
    // But only say the contract HELD when it was actually compared. The check above runs on
    // `rec.contract && current`, and both halves fail routinely: a record written before contract
    // capture has no `rec.contract`, and `spec-evidence.mjs` passes `current = null` whenever the
    // spec file is gone — which is every archived spec — or the gate could not be asked. Claiming
    // a contract still holds in those states is a verdict nothing earned, which is the same fault
    // as the false `stale` this whole change removes, pointed the other way.
    const judged = rec.to === 'Approved' && rec.contract && current;
    return {
      verdict: UNKNOWN,
      reason: judged
        ? 'an approval is judged by its contract, not by files — and that contract still holds'
        : rec.to === 'Approved' && !rec.contract
          ? 'this approval predates contract capture, and names no file — nothing can judge it'
          : rec.to === 'Approved'
            ? 'an approval is judged by its contract, and this spec could not be read to compare it'
            : 'the record names no file — nothing to compare against',
    };
  }

  const { changed, removed, unreadable } = compare(root, inputs);
  const moved = [...removed, ...changed];
  if (moved.length) {
    const head = moved.slice(0, 3).join(', ');
    return {
      verdict: STALE,
      reason: `${moved.length} file(s) the gate read have changed since — ${head}${moved.length > 3 ? ` and ${moved.length - 3} more` : ''}`,
      detail: { changed, removed },
    };
  }
  if (unreadable.length) {
    return {
      verdict: UNKNOWN,
      reason: `${unreadable.length} file(s) could not be read, so this cannot be judged either way`,
      detail: { unreadable },
    };
  }
  return { verdict: FRESH, reason: `all ${inputs.length} file(s) the gate read are byte-identical` };
}

/**
 * Rewrite the verdicts of records whose status their spec no longer holds.
 *
 * A second pass rather than an argument to `freshness()`, because supersession is a property of
 * the SET: a record on its own cannot know another exists. `spec-amend.mjs` reads exactly one
 * record by name and has no reason to load the rest, so widening `freshness()` would have made
 * every caller pay for a question only the reader asks.
 *
 * **The live record is the one for the status the spec actually holds** — and a spec may move
 * BACKWARDS, which `spec-gate.mjs` permits on purpose. Ranking by record index alone (spec 0025)
 * then called the record for the withdrawn status "the live one" and the record for the status
 * the spec really holds "history", which is not a failing verdict — so the live status became
 * unauditable and its remedy, `--re-record`, was refused for naming a status the spec no longer
 * held. There was no available action (spec 0026 §1 D1).
 *
 * **The `Status` cell is corroborated, never trusted**, and corroboration is a high bar because
 * two weaker versions of it were both broken by measurement (spec 0026 revisions 3 and 4). The
 * record at the claimed status must:
 *
 *   1. exist,
 *   2. carry a `recordDigest` that verifies — `gateWritten()`, not merely "not caught lying".
 *      `digestIntact()` says `true` for a record claiming no digest, which is right for integrity
 *      and wrong here: a hand-written file with no digest reads `unknown`, never blocks, and used
 *      to corroborate a retreated cell and silence everything else while claiming a HIGHER status
 *      than the one it hid,
 *   3. and be the NEWEST record for its spec. An honest transition writes the newest record in
 *      either direction; a hand-edited cell writes nothing. Without this, editing one word — zero
 *      JSON bytes, every checksum verifying — silenced a stale record, because `spec-advance`
 *      has already written genuine records at every status the spec passed through. The forger
 *      does not need to forge anything; the toolkit supplied the corroboration.
 *
 * `at` is inside the digest at V3 for rule 3's sake. When nothing corroborates the cell this falls
 * back to 0025's index ordering, the honest answer about an uncorroborated claim.
 *
 * **What this resists, and what it does not.** Every rule above terminates in `recordDigest`,
 * which is an unkeyed sha256 over exported field lists — `writeRecord()` is a working recipe for
 * recomputing one. So supersession resists ACCIDENT and carelessness: a hand-edited record, a
 * stripped digest, a retreated `Status` cell. It does not resist a deliberate edit by someone who
 * reads this file, and four lines is the whole cost. That is stated here rather than implied
 * because `main` has no supersession at all — this capability is new, and a reader deciding what
 * an exit 0 is worth should know which of the two it is. Anchoring the digest to something its
 * author does not control (a signature, or the commit that wrote the record) is the fix, and it
 * is not done here.
 *
 * **`unsound` is returned untouched, and that is the whole design** (spec 0025 §4.2). Integrity
 * outranks history: a record edited after it was written is not weaker evidence, it is none, so
 * no amount of advancing a spec may launder it. Reversing these two lines turns `spec-advance`
 * into a way to bury a doctored record.
 *
 * @param {object[]} rows records already judged — each `{spec, to, verdict, reason, status?, …}`
 * @returns {object[]} the same rows, with superseded ones rewritten
 */
export function supersede(rows) {
  const furthest = new Map();
  const held = new Map();
  // The newest `at` per spec, over sound records only — the corroboration test below needs it, and
  // it has to be known before any row is judged.
  const newest = new Map();
  for (const r of rows ?? []) {
    // `sealed`, not merely `gated`. An unsealed record's `at` is editable for free — its digest
    // width does not cover it — so letting one set `best` here lets a free edit deny corroboration
    // to an honest sealed record, which re-opens D1's unauditable live status at no cost. It cannot
    // silence anything (the index fallback still reports), but "cannot silence" is not the bar.
    if (!r?.sealed || LIFECYCLE.indexOf(r?.to) === -1) continue;
    const at = String(r?.at ?? '');
    const seen = newest.get(r?.spec);
    if (seen === undefined || at > seen) newest.set(r?.spec, at);
  }

  for (const r of rows ?? []) {
    const i = LIFECYCLE.indexOf(r?.to);
    // A record for a word no lifecycle knows supersedes nothing — it has no position to be later
    // than, and guessing one would mark real records as history on the strength of a typo.
    if (i === -1) continue;
    // An `unsound` record counts toward NEITHER map — not the corroborated live status below, and
    // not this fallback ordering. Both were measured: gating only the corroboration left the
    // forgery silencing everything anyway, because a record at the furthest index supersedes the
    // rest through the fallback whether the cell corroborates it or not. A record that no longer
    // digests to what it claims is not evidence of progress either.
    // Provenance, not innocence. `verdict === UNSOUND` catches a record that claims a digest and
    // breaks it; it waves through one that claims none, which is exactly the forgery the security
    // review reproduced. A record may only silence another if it can show the gate wrote it.
    //
    // `gated` is computed by the caller with `gateWritten(record)`, because provenance is a property
    // of the RECORD and these rows are judged verdicts. A caller that forgets it supersedes nothing
    // — every record stays judged, which is the safe direction to fail in.
    if (!r.gated) continue;
    const seen = furthest.get(r.spec);
    if (seen === undefined || i > seen) furthest.set(r.spec, i);
    // The corroboration: this record is FOR the status its spec's cell claims. `status` is absent
    // for callers that do not read specs, which simply leaves the fallback in charge.
    //
    // An `unsound` record corroborates NOTHING. Without this clause, forging one record at a forged
    // status silences every other record for that spec: the forgery earns its own `unsound` row,
    // but it buys the silence of all the rest, which is a trade worth making for anyone hiding a
    // `stale`. Measured before this line existed — a stale `Verified` record went to `superseded`
    // on the strength of a hand-edited `Archived` one. A record that cannot vouch for itself cannot
    // vouch for what the spec holds.
    //
    // And it must be the NEWEST record for its spec. This is the clause the security review was
    // blocked on. Revision 3 assumed the corroborating record would have to be forged; it does not,
    // because `spec-advance` writes a genuine record for EVERY transition — so a spec that reached
    // `Verified` already has honest, digest-intact `Approved` and `Implemented` records sitting on
    // disk. Editing one word of the `Status` cell, touching no JSON at all, made a stale `Verified`
    // record read `superseded` and turned exit 1 into exit 0 with "every record still stands."
    //
    // An honest transition always writes the newest record, in either direction: a backwards
    // `spec-advance` rewrites the target's record with a fresh `at`. A hand-edited cell cannot
    // produce that, because it writes nothing. `at` is inside the digest at V3 for exactly this
    // reason — without that, the rule is bypassed by editing a timestamp.
    // And its recency claim has to be substantiable, not merely asserted — `recencySealed()`. A
    // record at a pre-`at` width falls through to the index ordering below rather than corroborating
    // on the strength of a timestamp nothing protects.
    if (r.to === r.status && r.sealed) {
      const best = newest.get(r.spec);
      if (best === undefined || String(r.at ?? '') >= best) held.set(r.spec, i);
    }
  }
  return (rows ?? []).map((r) => {
    if (r?.verdict === UNSOUND) return r;
    const i = LIFECYCLE.indexOf(r?.to);
    if (i === -1) return r;
    const live = held.has(r?.spec) ? held.get(r?.spec) : furthest.get(r?.spec);
    if (live === undefined || live === i) return r;
    // Both directions are history, and they are not the same history. "Moved past" said about a
    // status a spec RETREATED from is the false sentence D1 printed, so each says which happened.
    return {
      ...r,
      verdict: SUPERSEDED,
      reason: live > i
        ? `the spec has moved past this status — its ${LIFECYCLE[live]} record is the live one, so this is history rather than drift`
        : `the spec moved back from this status — it holds ${LIFECYCLE[live]}, whose record is the live one, so this is a status it withdrew rather than drift`,
    };
  });
}
