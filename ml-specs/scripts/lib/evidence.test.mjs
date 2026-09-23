// What a gate read, and whether it still describes this tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  record, readRecord, listRecords, freshness, supersede, digestIntact, attestMode, gateWritten, recencySealed,
  FRESH, STALE, UNKNOWN, UNSOUND, AMENDED, SUPERSEDED, isFailing, DIGESTED, DIGEST_HISTORY,
} from './evidence.mjs';
import { digest } from './fingerprint.mjs';

function repo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'mlspecs-ev-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'test'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'test', 'a.test.mjs'), '// proves AC1\n');
  writeFileSync(join(dir, 'src', 'a.mjs'), 'export const a = 1;\n');
  return dir;
}

const gated = (dir, over = {}) => record(dir, {
  spec: 'specs/0001-x.md',
  to: 'Implemented',
  baseBranch: 'main',
  baseRev: 'abc123',
  tests: ['test/a.test.mjs'],
  changed: ['src/a.mjs'],
  gates: [{ name: 'tests-exist', verdict: 'PASS', detail: 'all 1 named test(s) exist on disk' }],
  ...over,
});

test('a record names the files the gate read, and reads fresh against them', (t) => {
  const dir = repo(t);
  const rec = gated(dir);
  assert.equal(rec.tests.length, 1);
  assert.equal(rec.changed.length, 1);
  assert.equal(freshness(dir, rec).verdict, FRESH);
});

test('SENSOR: deleting the test the gate read makes the verdict stale', (t) => {
  const dir = repo(t);
  const rec = gated(dir);

  // The gap this closes. `spec-gate.mjs` checks that every test §6 names exists on disk, which is
  // true when it runs and may not be true a fortnight later. With nothing recorded, a status went
  // on claiming what a deleted test once proved, and no command could tell.
  rmSync(join(dir, 'test', 'a.test.mjs'));
  const v = freshness(dir, rec);
  assert.equal(v.verdict, STALE);
  assert.ok(isFailing(v.verdict), 'stale must block, not merely annotate');
  assert.match(v.reason, /test\/a\.test\.mjs/, 'and it names the file, so there is something to do');
});

test('SENSOR: a change under the branch rewrites the verdict too', (t) => {
  const dir = repo(t);
  const rec = gated(dir);
  // The other half of the radius: the work itself, not only the tests that name it.
  writeFileSync(join(dir, 'src', 'a.mjs'), 'export const a = 99;\n');
  assert.equal(freshness(dir, rec).verdict, STALE);
});

test('the gate detail is not digested — rewording a message is not tampering', (t) => {
  const dir = repo(t);
  const rec = gated(dir);
  // Only name and verdict are kept. The detail strings carry counts and paths that move for
  // reasons that have nothing to do with the verdict.
  assert.deepEqual(rec.gates, [{ name: 'tests-exist', verdict: 'PASS' }]);
});

test('SENSOR: a record edited after it was written is unsound, not merely stale', (t) => {
  const dir = repo(t);
  const rec = gated(dir);
  const path = join(dir, rec.path);

  const tampered = JSON.parse(readFileSync(path, 'utf8'));
  tampered.gates[0].verdict = 'PASS';
  tampered.tests[0].sha256 = 'cafebabe';   // pretend the deleted test still hashed
  writeFileSync(path, JSON.stringify(tampered, null, 2));

  const v = freshness(dir, readRecord(dir, 'specs/0001-x.md', 'Implemented'));
  assert.equal(v.verdict, UNSOUND);
  assert.ok(isFailing(v.verdict));
  assert.match(v.reason, /edited after the gate wrote it/);
});

test('integrity is decided before the files are, so a doctored record cannot read fine', (t) => {
  const dir = repo(t);
  const rec = gated(dir);
  const path = join(dir, rec.path);
  const doctored = JSON.parse(readFileSync(path, 'utf8'));
  doctored.to = 'Verified';                 // a status this gate never cleared
  writeFileSync(path, JSON.stringify(doctored, null, 2));

  // Every file it names is still byte-identical, so a files-first check would say `fresh`.
  assert.equal(freshness(dir, readRecord(dir, 'specs/0001-x.md', 'Verified')).verdict, UNKNOWN,
    'a record filed under a status it never gated is simply absent');
  assert.equal(freshness(dir, readRecord(dir, 'specs/0001-x.md', 'Implemented')).verdict, UNSOUND);
});

test('no record is unknown — never fresh, and never a failure', (t) => {
  const dir = repo(t);
  const v = freshness(dir, readRecord(dir, 'specs/0404-none.md', 'Implemented'));
  assert.equal(v.verdict, UNKNOWN);
  assert.equal(isFailing(v.verdict), false, 'a spec gated before evidence existed must not be accused');
});

test('a record naming no file says so rather than claiming everything is fine', (t) => {
  const dir = repo(t);
  const rec = gated(dir, { tests: [], changed: [] });
  assert.equal(freshness(dir, rec).verdict, UNKNOWN);
});

test('a record written at an earlier width still verifies', (t) => {
  const dir = repo(t);
  const rec = gated(dir);

  // The registry is append-only for this reason: widen DIGESTED without registering the old list
  // and every record already on disk is reported as hand-edited. Today there is one width, so
  // this asserts the mechanism rather than a past migration.
  // The registry is APPEND-ONLY, which is what lets an old record verify at its own width. Pinned
  // as that property rather than as a fixed length: a later spec may legitimately add a width
  // (0026 added V3 for `at`), and a length assertion would fail for the one reason that is fine.
  for (let i = 1; i < DIGEST_HISTORY.length; i += 1) {
    assert.deepEqual(DIGEST_HISTORY[i].slice(0, DIGEST_HISTORY[i - 1].length), DIGEST_HISTORY[i - 1],
      `width ${i} is not an append to width ${i - 1} — every record written at the older one now reads unsound`);
  }
  assert.deepEqual(DIGESTED, DIGEST_HISTORY[DIGEST_HISTORY.length - 1]);
  assert.equal(digestIntact(rec), true);
  assert.equal(digestIntact({ ...rec, recordDigest: undefined }), true, 'no claim, nothing to disprove');

  // The point of the registry, demonstrated rather than asserted: a record written at V1, before
  // `amendments` existed, still verifies. Widening without this reports every record already on
  // disk as hand-edited, which is the loudest accusation there is to make wrongly.
  const atV1 = { ...rec };
  delete atV1.amendments;
  delete atV1.recordDigest;
  atV1.recordDigest = digest(Object.fromEntries(DIGEST_HISTORY[0].map((k) => [k, atV1[k] ?? null])));
  assert.equal(digestIntact(atV1), true, 'a V1 record was accused after V2 was added');
});

// ── how the judgement was made ──────────────────────────────────────────────────────────────

// The field list as it stood before `attested.mode` existed. Pinned literally, so that widening
// or editing the registry to make room for `mode` fails here rather than on every record on disk.
const BEFORE_MODE = ['spec', 'to', 'baseBranch', 'baseRev', 'tests', 'changed', 'gates', 'attested', 'contract', 'amendments'];

const signed = (over = {}) => ({ by: 'Ada Lovelace <ada@example.com>', at: '2026-01-01T00:00:00.000Z', text: 'I read every criterion against the diff', ...over });

test('AC3: a record written before `mode` existed reads human, and still verifies', (t) => {
  const dir = repo(t);
  const rec = gated(dir, { attested: signed() });      // no `mode` key, as every record on disk has

  // Digested over the field list as it stood then, the way a record on disk was. The naive
  // implementation of this feature widens that list, and then every record already written stops
  // digesting to what it claims — the loudest accusation there is, made about correct records.
  const onDisk = { ...rec };
  delete onDisk.path;
  delete onDisk.recordDigest;
  onDisk.recordDigest = digest(Object.fromEntries(BEFORE_MODE.map((k) => [k, onDisk[k] ?? null])));

  assert.equal(digestIntact(onDisk), true, 'the digest field list was widened for `mode` and now accuses every existing record');
  // Spec 0023's pin, stated as what it protects: `mode` lives INSIDE `attested`, which is already
  // one digested entry, so it must never appear in the outer field list. Not `DIGESTED equals a
  // frozen array` — that fails when a later spec adds an unrelated width, which 0026 did.
  assert.ok(!DIGESTED.includes('mode'),
    '`mode` was added to the outer digest list; it belongs inside `attested`, which is digested whole');
  assert.deepEqual(DIGESTED.slice(0, BEFORE_MODE.length), BEFORE_MODE,
    'the pre-`mode` fields moved or were reordered — every record on disk now reads unsound');
  assert.equal(attestMode(onDisk), 'human', 'an absent mode must read human, never a third state');
  assert.equal(freshness(dir, onDisk).verdict, FRESH);
});

test('AC6: SENSOR: flipping mode on disk reads unsound — otherwise the field is decoration', (t) => {
  const dir = repo(t);
  const rec = gated(dir, { attested: signed({ mode: 'unattended' }) });
  assert.equal(attestMode(rec), 'unattended');

  // The move the field exists to catch: an unattended transition relabelled afterwards as one a
  // person made. Anything that can be flipped from `unattended` to `human` records nothing.
  const path = join(dir, rec.path);
  const tampered = JSON.parse(readFileSync(path, 'utf8'));
  tampered.attested.mode = 'human';
  writeFileSync(path, JSON.stringify(tampered, null, 2));

  const back = readRecord(dir, 'specs/0001-x.md', 'Implemented');
  assert.equal(attestMode(back), 'human', 'the file now claims a human made this judgement');
  const v = freshness(dir, back);
  assert.equal(v.verdict, UNSOUND, '`attested.mode` is outside the digest — it can be rewritten with nothing noticing');
  assert.ok(isFailing(v.verdict));
});

test('listRecords skips a file nobody can parse rather than inventing a verdict', (t) => {
  const dir = repo(t);
  gated(dir);
  writeFileSync(join(dir, '.ml-specs', 'evidence', 'broken.json'), '{ not json');
  const all = listRecords(dir);
  assert.equal(all.length, 1);
  assert.equal(all[0].spec, 'specs/0001-x.md');
});

// ── the spec moving, which no file hash can see ─────────────────────────────────────────────

test('SENSOR: softening a criterion after the gate passed reads AMENDED', async (t) => {
  const { contractOf } = await import('./contract.mjs');
  const dir = repo(t);
  const spec = '- [x] **AC1** — it validates the token before use.\n';
  const rec = gated(dir, { contract: contractOf(spec, ['test/a.test.mjs']) });

  // `specs/` is always writable — it has to be, or nobody could fix a spec. So the sequence that
  // costs nothing is: pass the gate, then soften the criterion it passed against. Every file the
  // record fingerprinted is still byte-identical, because the thing that changed was the spec.
  assert.equal(freshness(dir, rec, contractOf(spec, ['test/a.test.mjs'])).verdict, FRESH);

  const softened = '- [x] **AC1** — it handles tokens.\n';
  const v = freshness(dir, rec, contractOf(softened, ['test/a.test.mjs']));
  assert.equal(v.verdict, AMENDED);
  assert.ok(isFailing(v.verdict), 'an amendment must block, not merely annotate');
  assert.match(v.reason, /AC-1 now reads differently/);
});

test('SENSOR: repointing a §6 row is invisible to the file hashes, and caught here', async (t) => {
  const { contractOf } = await import('./contract.mjs');
  const dir = repo(t);
  const spec = '- [x] **AC1** — it validates the token.\n';
  const rec = gated(dir, { contract: contractOf(spec, ['test/a.test.mjs']) });

  // The record holds the OLD path's hash, that file still exists unchanged, and the spec now
  // claims something else proves the criterion. Only comparing the claim notices.
  const v = freshness(dir, rec, contractOf(spec, ['test/other.test.mjs']));
  assert.equal(v.verdict, AMENDED);
  assert.match(v.reason, /§6 no longer names test\/a\.test\.mjs/);
});

test('ticking a box is progress, not an amendment', async (t) => {
  const { contractOf } = await import('./contract.mjs');
  const dir = repo(t);
  const unticked = '- [ ] **AC1** — it validates the token.\n';
  const ticked = '- [x] **AC1** — it validates the token.\n';
  const rec = gated(dir, { contract: contractOf(unticked, []) });

  // The gate checks the ticks itself on every run. Digesting them would make finishing the work
  // look like tampering with the contract.
  assert.equal(freshness(dir, rec, contractOf(ticked, [])).verdict, FRESH);
});

test('a record with no contract still answers about its files', async (t) => {
  const { contractOf } = await import('./contract.mjs');
  const dir = repo(t);
  const rec = gated(dir);                       // written without a contract
  assert.equal(freshness(dir, rec, contractOf('- [x] **AC9** — anything.\n', [])).verdict, FRESH,
    'a record that never captured a contract must not be accused of an amendment');
});

// ── Spec 0024 — an Approved record's radius is its contract ─────────────────────────────────

test('AC3/AC5: an Approved record with no files does not go stale when the code moves', async (t) => {
  const { contractOf } = await import('./contract.mjs');
  const dir = repo(t);
  // The bug this fixes. Before spec 0024 an Approved record fingerprinted the whole branch diff,
  // so implementing the spec — the one thing meant to happen next — turned its own approval stale.
  //
  // The contract is part of the fixture, not decoration: an Approved record rests on it entirely
  // now, and without one this exercises the "cannot be judged" path instead of the judged one.
  const spec = '- [x] **AC1** — it validates the token.\n';
  const contract = contractOf(spec, []);
  const rec = gated(dir, { to: 'Approved', tests: [], changed: [], contract });

  writeFileSync(join(dir, 'src', 'a.mjs'), 'export const a = 999; // implemented\n');
  const v = freshness(dir, rec, contract);

  assert.notEqual(v.verdict, STALE, 'an approval went stale because the spec was being built');
  assert.equal(v.verdict, UNKNOWN);
  // AC5: the reason must not read as a missing measurement, or somebody adds the radius back.
  assert.match(v.reason, /judged by its contract/i,
    `the reason still implies an omission: "${v.reason}"`);
});

test('AC5: an approval that cannot be judged says so, instead of claiming its contract held', (t) => {
  // Found by adversarial review. The first version of this message said "and that contract still
  // holds" for EVERY Approved record with an empty radius — including ones where no contract was
  // ever compared. Both states below are routine, not exotic, and in both the sentence asserted a
  // verdict nothing earned: the same fault as the false `stale` this spec removes, pointed the
  // other way.
  const dir = repo(t);

  // 1. Predates contract capture — there is no contract to have held.
  const noContract = gated(dir, { to: 'Approved', tests: [], changed: [], contract: null });
  const a = freshness(dir, noContract);
  assert.equal(a.verdict, UNKNOWN);
  assert.doesNotMatch(a.reason, /still holds/i,
    `a record with no contract claims one held: "${a.reason}"`);
  assert.match(a.reason, /predates contract capture/i);

  // 2. The spec cannot be read. `spec-evidence.mjs` passes current=null for every ARCHIVED spec,
  // because `archive` moves the document out from under its own record on purpose.
  const withContract = gated(dir, { to: 'Approved', tests: [], changed: [], contract: { criteria: [], tests: [], digest: 'abc' } });
  const b = freshness(dir, withContract, null);
  assert.equal(b.verdict, UNKNOWN);
  assert.doesNotMatch(b.reason, /still holds/i,
    `a record read without its spec claims its contract held: "${b.reason}"`);
  assert.match(b.reason, /could not be read/i);
});

test('AC4: an Approved record STILL catches a softened criterion — nothing was lost', async (t) => {
  const { contractOf } = await import('./contract.mjs');
  const dir = repo(t);
  const spec = '- [x] **AC1** — it validates the token before use.\n';
  const rec = gated(dir, { to: 'Approved', tests: [], changed: [], contract: contractOf(spec, []) });

  // The criterion that carries the whole argument for spec 0024. `freshness()` checks the contract
  // BEFORE the files, so emptying the file radius cannot reach this: an approval whose promise was
  // softened afterwards is exactly what an approval record should still refuse to stand behind.
  const v = freshness(dir, rec, contractOf('- [x] **AC1** — it handles tokens.\n', []));
  assert.equal(v.verdict, AMENDED,
    'emptying the Approved radius also disabled the contract check — the meaningful half is gone');
});

test('AC6: no digest width was added, and records on disk still verify', (t) => {
  const dir = repo(t);
  const rec = gated(dir, { to: 'Approved', tests: [], changed: [] });
  assert.equal(digestIntact(rec), true);
  // Spec 0024's pin: it changed no digested field. Stated as the whole list, deep-equal, so that
  // ANY future widening is a deliberate edit somebody reviews rather than a silent one.
  //
  // My first rewrite of this asserted `!DIGESTED.includes('radius')` and `'approvedRadius'` — two
  // names that have never existed anywhere in `ml-specs/scripts/`. It could not fail, while still
  // announcing "no digest width was added". A tautology written while fixing other tautologies,
  // caught in review. The lesson is the one this file keeps relearning: assert the property, and
  // then check the assertion can fail.
  assert.deepEqual(DIGESTED,
    ['spec', 'to', 'baseBranch', 'baseRev', 'tests', 'changed', 'gates', 'attested', 'contract',
      'amendments', 'at'],
    'the digested field list changed — widen it only on purpose, and add the old width to DIGEST_HISTORY');
});

// ── Spec 0025 — a record for a status you have moved past is history, not drift ──────────────

/** Judge a set of records the way `spec-evidence.mjs` does: per record, then over the set. */
const judgeAll = (dir, recs, extra = () => ({})) =>
  // `gated` mirrors what `spec-evidence.mjs` supplies: provenance comes from the RECORD, and
  // these rows are judged verdicts. Omitting it here would make every test pass for the wrong
  // reason — nothing would supersede anything.
  supersede(recs.map((r) => ({
    spec: r.spec, to: r.to, at: r.at, gated: gateWritten(r), sealed: recencySealed(r), ...freshness(dir, r), ...extra(r),
  })));

test('AC1: the record for a status the spec has moved past reads superseded; the live one does not', (t) => {
  const dir = repo(t);
  const impl = gated(dir);
  const verif = gated(dir, { to: 'Verified' });

  const rows = judgeAll(dir, [impl, verif]);
  assert.equal(rows[0].verdict, SUPERSEDED, 'the Implemented record is still being judged as if it were live');
  assert.notEqual(rows[1].verdict, SUPERSEDED, 'the furthest record must never supersede itself');
  assert.equal(rows[1].verdict, FRESH);
  assert.match(rows[0].reason, /Verified/, 'the reason must name the record that replaced it');
});

test('AC2: superseded does not fail — it is history, not drift', () => {
  assert.equal(isFailing(SUPERSEDED), false,
    'superseded joined FAILING, so every successful advance now reports a failure');
});

test('AC3: a record that would read stale reads superseded once the spec has moved on', (t) => {
  const dir = repo(t);
  const impl = gated(dir);
  const verif = gated(dir, { to: 'Verified' });

  // The case this spec exists for. Acting on a review finding edits a file the Implemented gate
  // read, so that record goes stale for having done the right thing.
  writeFileSync(join(dir, 'test', 'a.test.mjs'), '// proves AC1, and now AC16 too\n');
  assert.equal(freshness(dir, impl).verdict, STALE, 'the fixture no longer reproduces the stale case');

  const rows = judgeAll(dir, [impl, verif]);
  assert.equal(rows[0].verdict, SUPERSEDED);
  assert.equal(rows[1].verdict, STALE, 'the LIVE record must still report the drift — only history goes quiet');
});

test('AC4: SENSOR — a tampered record reads unsound, not superseded. Advancing launders nothing', (t) => {
  const dir = repo(t);
  const impl = gated(dir);
  gated(dir, { to: 'Verified' });

  // The attestation, because it is the field with the most to gain from being rewritten.
  const path = join(dir, impl.path);
  const doctored = JSON.parse(readFileSync(path, 'utf8'));
  doctored.gates[0].verdict = 'FAIL';
  writeFileSync(path, JSON.stringify(doctored, null, 2));

  const rows = judgeAll(dir, listRecords(dir));
  const row = rows.find((r) => r.to === 'Implemented');
  assert.equal(row.verdict, UNSOUND,
    'a doctored record was laundered by advancing its spec — integrity must outrank history');
  assert.notEqual(row.verdict, SUPERSEDED);
  assert.equal(isFailing(row.verdict), true, 'and it must still block');
});

test('AC1: supersession is read from the RECORDS, never from the Status cell', (t) => {
  const dir = repo(t);
  const impl = gated(dir);

  // A hand-edited Status is exactly what the records exist to catch, so it must not be able to
  // mark them history. One record, a cell claiming the spec is two statuses further on.
  const rows = judgeAll(dir, [impl], () => ({ status: 'Verified' }));
  assert.equal(rows[0].verdict, FRESH,
    'a hand-edited Status cell silenced a record — the check now trusts its own subject');
});

test('AC1: one spec moving on does not supersede another spec at the same status', (t) => {
  const dir = repo(t);
  const mine = gated(dir);
  const theirs = gated(dir, { spec: 'specs/0002-y.md' });
  const verif = gated(dir, { to: 'Verified' });

  const rows = judgeAll(dir, [mine, theirs, verif]);
  assert.equal(rows[0].verdict, SUPERSEDED);
  assert.equal(rows[1].verdict, FRESH, 'supersession leaked across specs');
});

// ── Spec 0026 — the live record is the one for the status the spec actually holds ────────────
//
// Every supersede test above builds its records FORWARDS: Implemented, then Verified, and a spec
// that only ever moves forwards. `spec-gate.mjs` permits moving backwards on purpose, and ranking
// by record index alone then called the withdrawn status "the live one" while the status the spec
// actually held read `superseded` — which is not a failing verdict, so the live status became
// unauditable and its only remedy was refused for naming a status the spec no longer held.
//
// So these build the records BACKWARDS, which is the shape that defect lives in.

/** Verified written first, then Implemented — a spec that moved back after review found a defect. */
const movedBack = (dir) => {
  const verif = gated(dir, { to: 'Verified' });
  const impl = gated(dir);
  return [verif, impl];
};
const rowFor = (rows, to) => rows.find((r) => r.to === to);

test('AC1: after a move back, the record for the status the spec HOLDS is judged, not silenced', (t) => {
  const dir = repo(t);
  const [verif, impl] = movedBack(dir);

  const rows = judgeAll(dir, [verif, impl], () => ({ status: 'Implemented' }));
  const live = rowFor(rows, 'Implemented');
  assert.notEqual(live.verdict, SUPERSEDED,
    'the record for the status the spec holds reads as history — the live status cannot be audited');
  assert.equal(live.verdict, FRESH);

  // And it must still be ABLE to fail: `superseded` is not in FAILING, so a live record wrongly
  // marked history can never report drift again. That is the whole of D1.
  writeFileSync(join(dir, 'test', 'a.test.mjs'), '// proves AC1, and now AC16 too\n');
  const again = rowFor(judgeAll(dir, [verif, impl], () => ({ status: 'Implemented' })), 'Implemented');
  assert.equal(again.verdict, STALE, 'the live record stopped reporting drift once another record existed');
  assert.equal(isFailing(again.verdict), true);
});

test('AC2: the record for a status the spec moved BACK from says it was withdrawn, not passed', (t) => {
  const dir = repo(t);
  const [verif, impl] = movedBack(dir);

  const row = rowFor(judgeAll(dir, [verif, impl], () => ({ status: 'Implemented' })), 'Verified');
  assert.equal(row.verdict, SUPERSEDED, 'a status the spec withdrew is still being judged as live');
  assert.match(row.reason, /moved back|withdrew/i,
    `a withdrawn status is described as progress: "${row.reason}"`);
  assert.doesNotMatch(row.reason, /moved past/i,
    `"moved past" is false about a status the spec retreated from: "${row.reason}"`);
  assert.match(row.reason, /Implemented/, 'the reason must name the status that is live instead');
  assert.equal(isFailing(row.verdict), false, 'history is not drift, in either direction');
});

test('AC3: REGRESSION — moving forwards still supersedes the status left behind, as 0025 does', (t) => {
  const dir = repo(t);
  const [verif, impl] = movedBack(dir);          // same two records, built in the same order

  const rows = judgeAll(dir, [verif, impl], () => ({ status: 'Verified' }));
  const past = rowFor(rows, 'Implemented');
  assert.equal(past.verdict, SUPERSEDED, 'spec 0025 behaviour was lost — a past status reads live again');
  assert.match(past.reason, /moved past/i, `progress is described as a withdrawal: "${past.reason}"`);
  assert.notEqual(rowFor(rows, 'Verified').verdict, SUPERSEDED, 'the live record supersedes itself');
});

test('AC4: LAUNDERING GUARD — a Status cell no record corroborates silences nothing', (t) => {
  const dir = repo(t);
  const impl = gated(dir);
  writeFileSync(join(dir, 'test', 'a.test.mjs'), '// edited after the gate read it\n');
  assert.equal(freshness(dir, impl).verdict, STALE, 'the fixture no longer reproduces a failing record');

  // The move the whole design has to refuse: type a further status into the header table and the
  // record that would otherwise accuse you goes quiet. Silencing it needs a RECORD at the forged
  // status, and forging one makes that record `unsound`.
  const rows = judgeAll(dir, [impl], () => ({ status: 'Verified' }));
  assert.equal(rows[0].verdict, STALE,
    'a hand-edited Status cell silenced a record — the check now trusts its own subject');
  assert.equal(isFailing(rows[0].verdict), true);
});

test('AC4: an uncorroborated cell falls back to index ordering, which is 0025 exactly', (t) => {
  const dir = repo(t);
  const [verif, impl] = movedBack(dir);

  // `Archived`: a real status, no record for it. Nothing corroborates the cell, so the furthest
  // record is the live one — today's answer, unchanged.
  const rows = judgeAll(dir, [verif, impl], () => ({ status: 'Archived' }));
  assert.equal(rowFor(rows, 'Implemented').verdict, SUPERSEDED);
  assert.match(rowFor(rows, 'Implemented').reason, /moved past/i);
  assert.notEqual(rowFor(rows, 'Verified').verdict, SUPERSEDED, 'the fallback silenced the furthest record');
  assert.equal(rowFor(rows, 'Verified').verdict, FRESH);
});

test('AC5: SENSOR — a tampered record reads unsound whichever status the cell claims', (t) => {
  const dir = repo(t);
  movedBack(dir);

  // Doctor the record for the status the spec has WITHDRAWN — the one the new rule would quiet.
  // Integrity outranks history in both directions, or moving a spec backwards becomes a way to
  // bury a doctored record, which is the hole 0025 §4.2 closed pointed the other way.
  const path = join(dir, '.ml-specs', 'evidence', '0001-x-verified.json');
  const doctored = JSON.parse(readFileSync(path, 'utf8'));
  doctored.gates[0].verdict = 'PASS';
  doctored.to = 'Verified';
  doctored.attested = { by: 'nobody', at: '2026-01-01T00:00:00.000Z', text: 'signed later', mode: 'human' };
  writeFileSync(path, JSON.stringify(doctored, null, 2));

  const rows = judgeAll(dir, listRecords(dir), () => ({ status: 'Implemented' }));
  const row = rowFor(rows, 'Verified');
  assert.equal(row.verdict, UNSOUND, 'moving a spec back laundered a hand-edited record');
  assert.equal(isFailing(row.verdict), true);
  assert.equal(rowFor(rows, 'Implemented').verdict, FRESH, 'and the live record is still judged');
});

test('AC4: an unsound record corroborates nothing and supersedes nothing', (t) => {
  // The hole the spec's own §4.2 argument left open, found by trying it rather than reading it.
  // §4.2 reasoned "forging one makes it unsound — which is accusation, not silence". Measured, it
  // was both: the forgery earned its unsound row AND silenced every other record for that spec,
  // which is a trade worth making for anyone hiding a stale one.
  //
  // Gating only the corroboration was not enough — a record at the furthest index supersedes the
  // rest through the FALLBACK ordering whether the cell corroborates it or not. Both maps have to
  // ignore it.
  const dir = repo(t);
  const real = { ...gated(dir, { to: 'Implemented', tests: [], changed: ['src/a.mjs'] }), status: 'Archived' };
  const forged = { ...gated(dir, { to: 'Archived', tests: [], changed: [] }), status: 'Archived', verdict: UNSOUND };

  const out = supersede([{ ...real, verdict: STALE }, forged]);
  const judged = out.find((r) => r.to === 'Implemented');

  assert.equal(judged.verdict, STALE,
    'a forged Archived record silenced the real record — the forgery bought exactly what it wanted');
  assert.equal(out.find((r) => r.to === 'Archived').verdict, UNSOUND,
    'the forgery must still be accused');
});
