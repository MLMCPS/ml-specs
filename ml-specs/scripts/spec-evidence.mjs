#!/usr/bin/env node
// Does what the gates proved still describe this repository?
//
//   node spec-evidence.mjs                    # every record, with its verdict
//   node spec-evidence.mjs --failing          # only the ones that no longer stand
//   node spec-evidence.mjs --json
//   node spec-evidence.mjs --root /path/to/repo
//
// `spec-advance.mjs` writes a record for every transition it allows. Without something that reads
// them back, that is a verdict nobody can see — and a verdict nobody reads is worth exactly as
// much as no verdict, which is the failure the records were added to fix, one level up. This is
// the reader.
//
// Exit codes: 0 = no record it JUDGED is failing · 1 = at least one is · 2 = could not run.
//
// Not "every record still stands": superseded records are held out of the judgement, and
// supersession is gated on a digest the silencer can recompute. Exit 0 means nothing judged is
// failing, which is a narrower claim and the only one this can make honestly.
// `unknown` never counts as a failure: a record that cannot be judged has not been shown wrong.
// Neither does `superseded`: a record for a status its spec does not hold — one it moved past, or
// one it moved back from — is history, and it is not being asked whether it still describes the
// tree.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { listSpecs } from './lib/specs.mjs';
import { listRecords, freshness, supersede, isFailing, attestMode, gateWritten, recencySealed, FRESH, STALE, UNKNOWN, UNSOUND, AMENDED, SUPERSEDED } from './lib/evidence.mjs';
import { contractOf } from './lib/contract.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : (argv[i + 1] ?? null); };
const has = (n) => argv.includes(`--${n}`);
const JSON_OUT = has('json');
const ONLY_FAILING = has('failing');
const ROOT = resolve(flag('root') ?? process.cwd());

/**
 * The §6 tokens as the gate reads them, for the spec this record is about.
 *
 * Asked of `spec-gate.mjs` rather than re-extracted here, for the reason `contract.mjs` gives:
 * a second implementation of "which tests does §6 name" would drift from the one that wrote the
 * record, and the reader would then disagree with the verdict it is reporting. 100ms a spec.
 *
 * `null` — not `[]` — when the gate could not be asked. An empty list would read as "§6 names
 * nothing now", which against a record that named something is an amendment nobody made.
 */
function claimedFor(specFile) {
  try {
    const out = execFileSync(
      process.execPath,
      [join(HERE, 'spec-gate.mjs'), join(ROOT, specFile), '--root', ROOT, '--json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return JSON.parse(out).claimed ?? null;
  } catch (e) {
    try { return JSON.parse(e.stdout || '').claimed ?? null; } catch { return null; }
  }
}

const records = listRecords(ROOT);
if (!records.length) {
  const msg = 'no evidence records yet — `/ml-specs:spec-advance` writes one for each transition it allows';
  if (JSON_OUT) console.log(JSON.stringify({ records: [], failing: 0, note: msg }, null, 2));
  else console.log(msg);
  process.exit(0);
}

const specs = new Map(listSpecs(ROOT).map((s) => [s.file, s]));
const judged = [];

for (const rec of records) {
  // A record whose spec is gone cannot be judged against it. `archive` moves a spec out from
  // under its own record on purpose, so a missing document means the check cannot run rather
  // than that something is wrong.
  const specPath = rec.spec ? join(ROOT, rec.spec) : null;
  let current = null;
  if (rec.contract && specPath && existsSync(specPath)) {
    const claimed = claimedFor(rec.spec);
    if (claimed !== null) current = contractOf(readFileSync(specPath, 'utf8'), claimed);
  }
  const v = freshness(ROOT, rec, current);
  judged.push({
    spec: rec.spec,
    to: rec.to,
    at: rec.at,
    // Provenance for `supersede()`: only a record the gate demonstrably wrote may silence
    // another. A hand-written file claiming no digest is `unknown`, which never blocks — and
    // before this it could corroborate a hand-edited `Status` cell and silence the rest.
    gated: gateWritten(rec),
    // Whether its `at` is inside the width it verifies at. The recency half of corroboration
    // rests on `at`, and every record written before V3 verifies at a width that does not cover
    // it — so those records cannot substantiate a recency claim and do not get to make one.
    sealed: recencySealed(rec),
    verdict: v.verdict,
    failing: isFailing(v.verdict),
    reason: v.reason,
    // How the judgement was made, which no verdict about files can see. A record can be `fresh`
    // and still rest on a gate no person ever read.
    mode: attestMode(rec),
    // The status the spec holds TODAY, which `supersede()` below reads to decide which record is
    // the live one. Corroborated there, never trusted: a cell naming a status no record exists for
    // silences nothing.
    status: specs.get(rec.spec)?.status ?? null,
    ...(v.detail ? { detail: v.detail } : {}),
  });
}

// The set-level pass, over rows `freshness()` has already judged one by one. `failing` is
// recomputed from the rewritten verdict rather than patched: `isFailing()` is the single predicate
// every consumer routes through, so the failing count follows the verdict instead of restating it.
// The spread keeps `failing` in its original position in the JSON, so the shape does not move.
const rows = supersede(judged).map((r) => ({ ...r, failing: isFailing(r.verdict) }));

const failing = rows.filter((r) => r.failing);
const shown = ONLY_FAILING ? failing : rows;

// How many records are being held out of the judgement. Supersession is gated on a digest the
// silencer can recompute (see `lib/evidence.mjs`), so an affirmative "everything is fine" is only
// as good as that hash — and a reassurance stronger than its evidence is the harm, not the hash.
const hidden = rows.filter((r) => r.verdict === SUPERSEDED).length;
// A record reading `unknown` is one that says nothing can judge it, so counting it as judged and
// then calling it a description of this tree is the collapse of "could not determine" into
// "fine" — the exact failure the `unknown` verdict exists to prevent, two lines from where that
// is written down. Measured: a record whose own reason was "1 file(s) could not be read, so this
// cannot be judged either way" was counted in `judged` and covered by "every one describes this
// tree".
const undecided = rows.filter((r) => r.verdict === UNKNOWN).length;
const caveat = hidden
  ? `  ${hidden} record(s) are superseded and were not judged — SUPERSESSION rests on a digest,`
    + '\n  which resists accident and not a deliberate edit. Other verdicts are unaffected.'
    + (ONLY_FAILING ? '\n  Run without --failing to read them.' : '')
  : null;

if (JSON_OUT) {
  // `judged` and `superseded` are in the payload, not only in the human output. The consumer with
  // the least capacity to infer a caveat — the MCP tool, and a model reading it — was the one still
  // being handed the older, stronger claim, which is the wrong way round.
  console.log(JSON.stringify({
    records: shown,
    total: rows.length,
    judged: rows.length - hidden - undecided,
    undecided,
    superseded: hidden,
    failing: failing.length,
    ...(hidden ? { note: 'superseded records were not judged; supersession rests on a digest that resists accident, not a deliberate edit' } : {}),
  }, null, 2));
  process.exit(failing.length ? 1 : 0);
}

// `superseded` gets its own glyph, not a failing one and not `fresh`'s tick: it is neither a
// problem nor a claim that this record still describes the tree. Nobody is asking it that.
const MARK = { [FRESH]: '✓', [STALE]: '✗', [AMENDED]: '✗', [UNSOUND]: '✗', [UNKNOWN]: '·', [SUPERSEDED]: '↩' };
if (!shown.length) {
  console.log(ONLY_FAILING ? 'no record is failing.' : 'no records to show.');
  if (caveat) console.log(caveat);
  process.exit(0);
}

for (const r of shown) {
  // Padded to the longest verdict word, so one `superseded` row does not shunt the column.
  console.log(`  ${MARK[r.verdict] ?? '?'} ${r.verdict.padEnd(10)} ${String(r.to).padEnd(12)} ${r.spec}`);
  console.log(`    ${r.reason}`);
  // Not a failure, and deliberately not marked as one: the record is honest about itself. It is
  // said out loud because `fresh` otherwise reads as "a person checked this", and here nobody did.
  if (r.mode === 'unattended') console.log('    attested unattended — no human made this judgement');
}
console.log('');

if (!failing.length) {
  // Not "every one still describing this tree" any more. That sentence counted superseded records
  // as confirmation when they are the opposite — records deliberately not judged — and it was the
  // line a forged record bought. Say what was actually checked.
  const judged = rows.length - hidden - undecided;
  console.log(`${judged} of ${rows.length} record(s) judged, and none of them is failing.`);
  if (undecided) console.log(`  ${undecided} could not be judged either way — read their reasons above.`);
  if (caveat) console.log(caveat);
  process.exit(0);
}

// Each failing verdict has its OWN remedy, and printing one instruction for all three would send
// somebody to re-run a gate when what they need is to decide whether an amendment was intended.
const kinds = new Set(failing.map((r) => r.verdict));
console.log(`${failing.length} of ${rows.length} record(s) no longer describe this tree.`);
// A `stale` or `amended` record listed here is the LIVE one — the record for the status its spec
// actually holds, or the furthest record when nothing corroborates the cell — because
// `supersede()` quiets every other. So `--re-record` re-gates exactly this status and is the
// remedy that fits. `unsound` is the exception, deliberately: it is exempt from supersession so
// that advancing cannot bury a doctored record, which means it can name a status the spec has
// since left, and re-recording is not what it needs anyway.
if (kinds.has(STALE)) console.log('  stale   — a file the gate read has changed. Re-run the gate for the status the spec holds: `/ml-specs:spec-advance <spec> --re-record` (refused at Draft and Archived, which have no gate for that status to re-run).');
if (kinds.has(AMENDED)) console.log('  amended — the SPEC moved after it passed. Decide whether that was intended, then re-run the gate.');
if (kinds.has(UNSOUND)) console.log('  unsound — the record was edited after it was written. Do not edit records; re-run the gate.');
process.exit(1);
