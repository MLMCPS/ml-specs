#!/usr/bin/env node
// Write a spec's Status — and refuse to, unless the gate cleared and the judgement was signed.
//
//   node spec-advance.mjs specs/0001-foo.md --attest "…"                # to the next status
//   node spec-advance.mjs specs/0001-foo.md --to Verified --attest "…"
//   node spec-advance.mjs specs/0001-foo.md --to Verified --attest "…" --json
//   node spec-advance.mjs specs/0001-foo.md --dry-run                   # decide, write nothing
//   node spec-advance.mjs specs/0001-foo.md --to Verified --run-suite --attest "…"
//   node spec-advance.mjs specs/0001-foo.md --attest "…" --unattended     # no human read this
//   node spec-advance.mjs specs/0001-foo.md --re-record --attest "…"     # refresh the record
//
// `--unattended` records HOW the judgement was made, and nothing else. `by` comes from
// `git config user.name`, which is the human whose machine this ran on — not necessarily the one
// who judged it. Without a mode, an automated run signs a human's name to a judgement that human
// never made, and every reader downstream treats a human-approval gate as witnessed by a human.
// The flag lowers no bar: the attestation minimum below applies exactly as it does to a person —
// and under `--unattended` it applies on EVERY target, including the ones with no MANUAL gate,
// because an unsigned record has no `mode` at all and an absent mode reads `human`.
//
// `--run-suite` is passed through to the gate, which runs the command §6.1 names and turns
// suite-green from a MANUAL you vouch for into a verdict a script took. The attestation then
// covers only what a script genuinely cannot witness.
//
// `--re-record` is passed through too, and re-writes the record for the status the spec ALREADY
// holds — the Status cell does not move. Acting on a review finding edits files the last gate
// fingerprinted, so its record goes `stale` for having done the right thing, and until this flag
// there was no way to refresh it. It is not a rubber stamp: the gate re-runs in full and every
// FAIL still refuses below, the gate refuses it at `Draft` and `Archived`, and a re-record whose
// branch diff has gone empty since the record it replaces is refused here.
//
// Why this exists. `commands/spec-advance.md` already says "This is the **only** command that
// writes a spec's Status", and until this script that sentence had nothing behind it: the gate
// reported, and the MODEL edited the header table. A rule that lives in a prompt is advice — the
// same model, the same repo, two runs, two outcomes, and no way to tell afterwards which happened.
//
// So the decision and the write are here. The gate's FAILs are refusals, not opinions. The gates
// a script cannot settle — human approval, a blocking §8 question, the suite, the review — still
// belong to a person, and `--attest` is how they say they made that judgement. Ten characters
// minimum, because a signature nobody could have withheld is a checkbox with a name on it.
//
// What it does NOT do: touch code, commit, push, tick criteria, or move an archived spec. Those
// stay with the command, which is the right place for the things a person should watch happen.
//
// Exit codes: 0 = written · 1 = refused (a gate failed, or the judgement is unsigned) · 2 = could
// not run. Exit 1 is a verdict about this repository; exit 2 is a fact about the machine.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LIFECYCLE, listSpecs } from './lib/specs.mjs';
import { record, readRecord } from './lib/evidence.mjs';
import { contractOf } from './lib/contract.mjs';
import { lines } from './lib/text.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const MIN_ATTEST = 10;

// ---------------------------------------------------------------------------- args

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : (argv[i + 1] ?? '');
};
const has = (name) => argv.includes(`--${name}`);
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['to', 'attest', 'root'].includes(argv[i - 1]?.replace(/^--/, ''))));

const JSON_OUT = has('json');
const DRY = has('dry-run');
// A boolean flag, so `has()` is enough and the `positional` filter above needs nothing: that
// filter only excludes the word FOLLOWING a flag that takes a value.
const MODE = has('unattended') ? 'unattended' : 'human';
// Also boolean, and forwarded to the gate — which owns the refusal, because the check it relaxes
// (`already <status>`) is the gate's and a second copy of that rule here would drift from it.
const RE_RECORD = has('re-record');
const ROOT = resolve(flag('root') ?? process.cwd());
const SPEC_ARG = positional[0];

const die = (code, message) => {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, reason: message }, null, 2));
  else console.error(message);
  process.exit(code);
};

if (!SPEC_ARG) die(2, 'usage: spec-advance.mjs <spec-file> [--to <Status>] --attest "…" [--unattended] [--re-record] [--root <path>] [--json] [--dry-run]');
const ABS = resolve(ROOT, SPEC_ARG);
if (!existsSync(ABS)) die(2, `could not run: no spec at ${SPEC_ARG}`);
const SPEC_REL = relative(ROOT, ABS).split('\\').join('/');

// ---------------------------------------------------------------------------- the gate

let gate;
try {
  const out = execFileSync(
    process.execPath,
    [join(HERE, 'spec-gate.mjs'), ABS, '--root', ROOT, '--json',
      ...(flag('to') ? ['--to', flag('to')] : []), ...(has('run-suite') ? ['--run-suite'] : []),
      ...(RE_RECORD ? ['--re-record'] : [])],
    // stderr is INHERITED, not piped. The gate writes the §6.1 command it is about to run to
    // stderr before running it (spec 0027), and piping it here swallowed that on the very path
    // `commands/spec-advance.md` recommends and `spec-why.mjs` instructs — so the one control
    // that lets an operator see the command never reached the operator. stdout stays a pipe
    // because it carries the JSON report this parses.
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  gate = JSON.parse(out);
} catch (e) {
  // The gate exits 1 when a gate FAILS, which is a verdict and not a crash — its stdout is still
  // the report. Anything without parseable stdout is a real inability.
  try {
    gate = JSON.parse(e.stdout || '');
  } catch {
    die(2, `could not run: the gate did not report\n${String(e.stderr || e.message).trim()}`);
  }
}

const target = gate.target;
if (!target) die(2, `could not run: no target status — ${gate.current ?? 'the spec'} has nowhere to advance to`);
if (!LIFECYCLE.includes(target)) die(2, `could not run: '${target}' is not a lifecycle status`);

const failed = (gate.gates ?? []).filter((g) => g.verdict === 'FAIL');
const manual = (gate.gates ?? []).filter((g) => g.verdict === 'MANUAL');

// ---------------------------------------------------------------------------- the refusals

if (failed.length) {
  const lines = failed.map((g) => `  ✗ ${g.name.padEnd(18)} ${g.detail}`).join('\n');
  die(1, `${SPEC_REL}: ${failed.length} gate(s) failed — Status not written.\n${lines}\n\nFix what they name, then run this again. The gate is not an opinion.`);
}

const attestation = String(flag('attest') ?? '').trim();
const unsigned = attestation.length < MIN_ATTEST;
if (manual.length && unsigned) {
  const lines = manual.map((g) => `  · ${g.name.padEnd(18)} ${g.detail}`).join('\n');
  die(1,
    `${SPEC_REL}: ${manual.length} gate(s) need a human judgement, and nothing has been signed.\n${lines}\n\n` +
    `Make those judgements yourself, then say so:\n` +
    `  --attest "I ran the suite green and read every criterion against the diff"\n\n` +
    `${MIN_ATTEST} characters minimum. A signature nobody could have withheld is a checkbox with a name on it.`);
}

// And unconditionally under `--unattended`, whatever gates this target happens to have.
//
// The minimum above is conditional on a MANUAL gate existing, and `Approved → Implemented` emits
// none — so `--unattended` alone wrote `attested: null`, which `attestMode()` reads back as
// `'human'` (`lib/evidence.mjs`). An explicitly unattended run then produced the one record shape
// that claims a person made the judgement, which is the defect the mode field exists to prevent
// (spec 0026 §1 D4). The flag lowers no bar; it must not lower this one by omission.
if (unsigned && MODE === 'unattended') {
  die(1,
    `${SPEC_REL}: --unattended says no human made this judgement, and nothing has been signed.\n\n` +
    `Without --attest the record's \`attested\` is null, and an absent mode reads \`human\` — so an\n` +
    `unattended run would leave a record claiming the opposite of what you just typed.\n\n` +
    `  --attest "the §6.1 suite ran green and every criterion was read against the diff"\n\n` +
    `${MIN_ATTEST} characters minimum, on every target, whether or not a gate asked for judgement.`);
}

// The radius a re-record would write, against the one it replaces.
//
// `changedFiles()` is `git diff <base>...<branch>`, and a three-dot diff from the merge base is
// EMPTY once the branch merges. So a re-record after the merge fingerprints strictly fewer files
// than the record it overwrites and reads `fresh` for that reason — a `Verified` record that went
// `stale` because implementation files moved could be made `fresh` by dropping them from the
// radius instead of re-answering the question (spec 0026 §1 D3).
//
// Only the collapse to EMPTY is refused (§5 AC7, revision 2). A file genuinely deleted as part of
// the work shrinks the radius honestly, and a hard refusal on any shrink would block re-recording
// that spec forever — so a partial shrink is named in the output below and proceeds.
const prior = RE_RECORD ? readRecord(ROOT, SPEC_REL, target) : null;
const priorChanged = (prior?.changed ?? []).map((f) => f.path ?? f);
const nowChanged = gate.changed ?? [];
if (RE_RECORD && priorChanged.length && !nowChanged.length) {
  die(1,
    `${SPEC_REL}: this re-record would cover nothing — Status not written.\n` +
    `  the ${target} record on file fingerprints ${priorChanged.length} file(s) from this branch; today's gate read 0.\n\n` +
    `The radius is a three-dot diff from the merge base, and that goes empty the moment the branch\n` +
    `merges — so re-recording now would narrow what ${target} is checked against rather than re-answer\n` +
    `it. Whatever made that record fail is still true: decide it, or move the spec on.`);
}
const dropped = priorChanged.filter((f) => !nowChanged.includes(f));

// ---------------------------------------------------------------------------- the write

/**
 * Replace the Status cell and nothing else.
 *
 * Byte-for-byte everywhere but that one cell, because a status write that reflows a table or
 * normalises whitespace makes the diff unreviewable — and a diff nobody reads is how a status
 * write hides something else.
 */
export function setStatus(text, to) {
  const line = lines(text).find((l) => /^\|\s*\*\*Status\*\*\s*\|/i.test(l));
  if (!line) return { text, changed: false, from: null };
  const start = line.indexOf('|', line.indexOf('**Status**')) + 1;
  const end = line.lastIndexOf('|');
  if (start <= 0 || end <= start) return { text, changed: false, from: null };
  const from = line.slice(start, end).trim();
  const next = `${line.slice(0, start)} ${to} ${line.slice(end)}`;
  return { text: text.replace(line, next), changed: next !== line, from };
}

const before = readFileSync(ABS, 'utf8');
const { text: after, changed, from } = setStatus(before, target);
if (from === null) die(2, `could not run: ${SPEC_REL} has no Status row to write`);

const spec = listSpecs(ROOT).find((s) => s.file === SPEC_REL || s.file.endsWith(`/${SPEC_REL.split('/').pop()}`));
const who = (() => {
  try {
    const name = execFileSync('git', ['config', 'user.name'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const email = execFileSync('git', ['config', 'user.email'], { cwd: ROOT, encoding: 'utf8' }).trim();
    return email ? `${name || 'unnamed'} <${email}>` : (name || null);
  } catch {
    return null;
  }
})();

if (DRY) {
  const msg = `${SPEC_REL}: would ${RE_RECORD ? `re-record ${target} (the Status cell does not move)` : `write ${from} → ${target}`}${manual.length ? ` on ${manual.length} signed judgement(s)` : ''} (--dry-run, nothing written)`;
  if (JSON_OUT) console.log(JSON.stringify({ ok: true, dryRun: true, spec: SPEC_REL, from, to: target }, null, 2));
  else console.log(msg);
  process.exit(0);
}

// Not written at all on a re-record, rather than written back identical. `setStatus()` rewrites
// the whole Status LINE and normalises the cell's padding, so a re-record produced a diff under a
// message that said the cell was unchanged (spec 0026 §1 D6). The only version of "unchanged"
// that is true is the one that does not touch the file.
if (!RE_RECORD) writeFileSync(ABS, after);

// The record, after the write, over the tree the gate actually read. A record written before the
// status would describe a transition that had not happened yet.
const rec = record(ROOT, {
  spec: SPEC_REL,
  to: target,
  baseBranch: gate.baseBranch ?? null,
  baseRev: gate.baseRev ?? null,
  tests: gate.tests ?? [],
  changed: gate.changed ?? [],
  gates: gate.gates ?? [],
  // `mode` says how the judgement was made; `by` only says whose machine made it.
  attested: attestation ? { by: who, at: new Date().toISOString(), text: attestation, mode: MODE } : null,
  // Over the text as it stood when the gate read it, not after this write: the Status cell is
  // not part of the contract, but taking the snapshot before the write keeps that obvious.
  contract: contractOf(before, gate.claimed ?? []),
});

if (JSON_OUT) {
  // `changed` is about the Status CELL, and a re-record does not write it — so it is false here
  // whatever `setStatus()` computed over text that was never saved.
  console.log(JSON.stringify({ ok: true, spec: SPEC_REL, from, to: target, changed: RE_RECORD ? false : changed, record: rec.path, attested: rec.attested }, null, 2));
} else {
  console.log(RE_RECORD ? `${SPEC_REL}  ${target} re-recorded — the Status cell is unchanged` : `${SPEC_REL}  ${from} → ${target}`);
  if (attestation) console.log(`  signed by ${who ?? 'unknown (git has no user.name)'} (${MODE}): "${attestation}"`);
  // A partial shrink is honest — a file deleted as part of the work leaves the branch diff — but
  // it narrows what this status is checked against, so it is said out loud rather than absorbed.
  if (dropped.length) {
    const head = dropped.slice(0, 3).join(', ');
    console.log(`  the radius narrowed: ${dropped.length} file(s) the ${target} record named are no longer in this branch's diff — ${head}${dropped.length > 3 ? ` and ${dropped.length - 3} more` : ''}`);
  }
  // "0 file(s) fingerprinted" reads like a failure. For an Approved record it is the design: the
  // transition certifies a contract, not a tree, so say which it is rather than printing a zero.
  // Keyed on the TARGET and not on the count, because an Archived record fingerprints nothing
  // either and calling it an approval was a sentence about a transition that did not happen
  // (spec 0026 §1 D7).
  const fingerprinted = (rec.tests?.length ?? 0) + (rec.changed?.length ?? 0);
  console.log(`  evidence: ${rec.path}  ${fingerprinted
    ? `(${fingerprinted} file(s) fingerprinted)`
    : target === 'Approved'
      ? '(judged by its contract — an approval fingerprints no files)'
      : '(no file fingerprinted — this record rests on the gates it names and nothing else)'}`);
  // And only promise the check that will actually run. Staleness is a verdict about fingerprinted
  // files, so a record that fingerprinted none cannot go stale, whatever this line used to say.
  if (fingerprinted) console.log(`\n  This status is now re-checkable: if those files move, the record goes stale and says which.`);
  else if (target === 'Approved') console.log(`\n  This approval is re-checkable: soften a criterion or repoint a §6 row and the record reads amended.`);
}
process.exit(0);
