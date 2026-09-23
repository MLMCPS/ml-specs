// How long things take, from timestamps the repo already had. Spec 0035.
//
// Draft 0020's premise is that development with this toolkit takes too long, and nobody can say by
// how much or where. Every transition writes a timestamped evidence record, and every spec carries
// a Revisions table counting the review rounds it took. The data is on disk and unread.
//
// TWO RULES, AND BOTH ARE ABOUT NOT FLATTERING THE NUMBERS
//
// A spec with NO RECORDS is excluded and counted separately, never treated as zero. That is the
// same `unknown`-is-not-`fresh` distinction `lib/evidence.mjs:14` draws, and the arithmetic gets it
// wrong in the flattering direction if it is ignored: a spec nobody advanced looks instant.
//
// NOTHING IS KEYED TO A PERSON. Every record carries `attested.by` — a name and an email — so this
// is one field away from being a performance instrument, and a cycle-time report that becomes one
// stops being honest the week people notice. The ban is asserted against the real records rather
// than a fixture, because a fixture with no name in it could not fail.
//
// A `lib/` module never consoles. It returns results; the caller prints them.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { listSpecs } from './specs.mjs';
import { lines } from './text.mjs';

/** The lifecycle, in order. A record's position in it is what "out of order" is measured against. */
const LIFECYCLE = ['Draft', 'Approved', 'Implemented', 'Verified', 'Archived'];

/** Whole days. An hour-level number invites a precision a "when somebody got round to it" timestamp does not have. */
const days = (from, to) => Math.round((to - from) / 86_400_000);

/** Every evidence record, newest last, with unreadable ones reported rather than skipped. */
export function readRecords(root = process.cwd()) {
  const dir = join(root, '.ml-specs', 'evidence');
  if (!existsSync(dir)) return { records: [], unreadable: [] };

  const records = [];
  const unreadable = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    try {
      const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (r?.spec && r?.to && r?.at) records.push({ spec: r.spec, to: r.to, at: new Date(r.at) });
      else unreadable.push(f);
    } catch {
      unreadable.push(f);
    }
  }
  return { records: records.sort((a, b) => a.at - b.at), unreadable };
}

/**
 * Time between consecutive transitions OF THE SAME SPEC.
 *
 * Grouped by spec first, because the records are one directory and a naive sort would compute the
 * gap between one spec's Approved and another's Implemented — a number that means nothing and
 * looks plausible.
 */
export function durations(records) {
  const bySpec = new Map();
  for (const r of records) {
    if (!bySpec.has(r.spec)) bySpec.set(r.spec, []);
    bySpec.get(r.spec).push(r);
  }

  const out = [];
  const outOfOrder = [];
  for (const [spec, rows] of bySpec) {
    const sorted = [...rows].sort((a, b) => a.at - b.at);

    // Out of order means out of LIFECYCLE order, not out of the order they happened to be read in.
    //
    // The first version compared each record to the one before it as loaded — and `readRecords`
    // sorts by timestamp before returning, so by the time this ran they were always ascending and
    // the check was dead code on the real path. It passed only in a unit test that called this
    // function directly with unsorted input: a test that could not fail against the code it
    // guarded. The e2e in `cycle-wiring.test.mjs` is what surfaced it.
    //
    // A `Verified` record timestamped before its own `Approved` one is genuinely wrong — a
    // re-record, a clock, a hand-edited file — however the two were read.
    const byLifecycle = [...rows].sort((a, b) => LIFECYCLE.indexOf(a.to) - LIFECYCLE.indexOf(b.to));
    if (byLifecycle.some((r, i) => i > 0 && r.at < byLifecycle[i - 1].at)) outOfOrder.push(spec);

    for (let i = 1; i < sorted.length; i++) {
      out.push({
        spec,
        from: sorted[i - 1].to,
        to: sorted[i].to,
        days: days(sorted[i - 1].at, sorted[i].at),
      });
    }
  }
  return { durations: out, outOfOrder };
}

/**
 * How many revision rows a spec carries — the review rounds it actually took.
 *
 * `0` for a spec with no Revisions section: `specs/TEMPLATE.md:31-33` says to skip that section
 * entirely when a spec was approved first pass, so its absence means zero rounds, not missing data.
 */
export function rounds(specText) {
  const rows = lines(specText);
  const start = rows.findIndex((l) => /^##\s*Revisions/i.test(l));
  if (start === -1) return 0;
  let end = rows.length;
  for (let i = start + 1; i < rows.length; i++) if (/^##\s/.test(rows[i])) { end = i; break; }
  return rows.slice(start, end).filter((l) => /^\|\s*\d+\s*\|/.test(l)).length;
}

/**
 * The whole report.
 *
 * `excluded` is a first-class field, not a footnote: an average computed over the specs that
 * happened to transition, presented without saying which were left out, is the flattering answer.
 */
export function report(root = process.cwd()) {
  const { records, unreadable } = readRecords(root);
  const { durations: spans, outOfOrder } = durations(records);

  const specs = listSpecs(root);
  const withRecords = new Set(records.map((r) => r.spec));
  const excluded = specs
    .filter((s) => !withRecords.has(s.file))
    .map((s) => ({ spec: s.file, why: 'no evidence record — this status predates evidence recording, or was never gated' }));

  const byStatus = new Map();
  for (const d of spans) {
    if (!byStatus.has(d.from)) byStatus.set(d.from, []);
    byStatus.get(d.from).push(d.days);
  }
  const stat = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return { n: s.length, median: s.length ? s[Math.floor(s.length / 2)] : null, max: s.length ? s[s.length - 1] : null };
  };

  return {
    measured: spans.length,
    specsMeasured: new Set(spans.map((d) => d.spec)).size,
    excluded,
    outOfOrder,
    unreadable,
    // Keyed by the status a spec sat IN, which is the question "where does time go" actually asks.
    inStatus: Object.fromEntries([...byStatus].map(([k, v]) => [k, stat(v)])),
    rounds: specs.map((s) => ({
      spec: s.file,
      rounds: existsSync(join(root, s.file)) ? rounds(readFileSync(join(root, s.file), 'utf8')) : 0,
    })).sort((a, b) => b.rounds - a.rounds),
    slowest: [...spans].sort((a, b) => b.days - a.days).slice(0, 5),
  };
}
