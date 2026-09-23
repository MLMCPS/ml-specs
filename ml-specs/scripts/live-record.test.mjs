// Spec 0026 — the live record is the one for the status the spec actually holds.
//
// Five defects that exist only where specs 0023, 0024 and 0025 compose. Every one of them is
// driven through the REAL CLIs over a throwaway git repo, because that is where they live: the
// refusals are in `spec-gate.mjs`, the flags are typed at `spec-advance.mjs`, and the verdict is
// read back by `spec-evidence.mjs`. Three per-spec reviews missed all five, and no unit test
// inside one of those scripts could have caught them either.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const ADVANCE = join(DIR, 'spec-advance.mjs');
const EVIDENCE = join(DIR, 'spec-evidence.mjs');
const REAL = 'I ran the suite green and read every criterion against the diff';

// The Status cell is written TIGHT — `|Implemented|`, no padding — on purpose. `setStatus()`
// normalises that padding, so a re-record that rewrites the line leaves a visible diff under a
// message saying the cell is unchanged. With a pre-padded cell the rewrite would be invisible and
// the D6 assertion would prove nothing.
const SPEC = (status) => `# Spec: a thing

| | |
|---|---|
| **Status** |${status}|
| **Branch** | feat/thing |
| **Author** | Ada |

## 5. Acceptance criteria
- [x] **AC1** — it validates the token.

## 6. Test plan
| AC | Test file | What it proves |
|---|---|---|
| AC1 | \`test/thing.test.mjs\` | it validates |

## 8. Open questions
None blocking.
`;

/**
 * A repo holding one spec at `status`.
 *
 * `branch: true` puts the work on `feat/thing`, which the spec's Branch row names — without it
 * `changedFiles()` returns `[]` and every radius assertion below would pass having measured
 * nothing. Two files change on the branch so that one of them can be reverted later, which is the
 * partial shrink AC7 must NOT refuse.
 */
function repo(t, status = 'Approved', { branch = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mlspecs-live-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  mkdirSync(join(dir, 'specs'), { recursive: true });
  mkdirSync(join(dir, 'test'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'specs', '0001-thing.md'), SPEC(status));
  writeFileSync(join(dir, 'test', 'thing.test.mjs'), '// proves AC1\n');
  writeFileSync(join(dir, 'src', 'thing.mjs'), 'export const f = 1;\n');
  writeFileSync(join(dir, 'src', 'other.mjs'), 'export const g = 1;\n');
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Ada Lovelace');
  git('config', 'user.email', 'ada@example.com');
  git('add', '-A');
  git('commit', '-qm', 'base');
  if (branch) {
    git('checkout', '-q', '-b', 'feat/thing');
    writeFileSync(join(dir, 'src', 'thing.mjs'), 'export const f = 2; // the work\n');
    writeFileSync(join(dir, 'src', 'other.mjs'), 'export const g = 2; // the work\n');
    git('add', '-A');
    git('commit', '-qm', 'work');
  }
  return { dir, git };
}

const run = (dir, ...args) => {
  const r = spawnSync(process.execPath, [ADVANCE, 'specs/0001-thing.md', '--root', dir, ...args], {
    cwd: dir, encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};
const evidence = (dir, ...args) => {
  const r = spawnSync(process.execPath, [EVIDENCE, '--root', dir, ...args], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};
const specFile = (dir) => join(dir, 'specs', '0001-thing.md');
const statusOf = (dir) => /\|\s*\*\*Status\*\*\s*\|\s*([A-Za-z]+)/.exec(readFileSync(specFile(dir), 'utf8'))[1];
const recordPath = (dir, to) => join(dir, '.ml-specs', 'evidence', `0001-thing-${to.toLowerCase()}.json`);
const radiusOf = (dir, to) => JSON.parse(readFileSync(recordPath(dir, to), 'utf8')).changed.map((f) => f.path);

// ── AC6 — the two statuses `--re-record` cannot re-gate ─────────────────────────────────────

test('AC6: --re-record is refused at Draft, where nothing would be examined', (t) => {
  const { dir } = repo(t, 'Draft');

  // D5. No target block matches `Draft`, so widening `forward` bought nothing: the record was
  // written with the lifecycle check alone examined and nothing signed — the rubber stamp spec
  // 0025 revision 5 justified the widening as preventing.
  const r = run(dir, '--re-record', '--attest', REAL);
  assert.equal(r.code, 1, `--re-record was allowed at Draft:\n${r.out}`);
  assert.match(r.out, /--re-record cannot re-gate Draft/, `the refusal does not say why:\n${r.out}`);
  assert.match(r.out, /no gate block exists/i);
  assert.equal(existsSync(recordPath(dir, 'Draft')), false,
    'a Draft record was written on one gate examined and nothing signed');
});

test('AC6: --re-record is refused at Archived, naming the local branch list it would trust', (t) => {
  const { dir } = repo(t, 'Archived');

  // D2. `git branch --merged` lists the branches on THIS machine: a false FAIL on a fresh clone
  // where the branch is genuinely merged, a false PASS on a merge nobody pushed. Re-gating a
  // status granted arbitrarily long ago is exactly where the pruned branch is the normal case.
  const r = run(dir, '--re-record', '--attest', REAL);
  assert.equal(r.code, 1, `--re-record was allowed at Archived:\n${r.out}`);
  assert.match(r.out, /--re-record cannot re-gate Archived/, `the refusal does not say why:\n${r.out}`);
  assert.match(r.out, /branch --merged/);
  assert.doesNotMatch(r.out, /branch-merged/,
    'the gate whose answer cannot be trusted ran anyway, underneath the sentence refusing it');
  assert.equal(existsSync(recordPath(dir, 'Archived')), false);
});

// ── AC7 — the radius a re-record writes ─────────────────────────────────────────────────────

test('AC7: a re-record whose branch diff has gone empty since the record it replaces is refused', (t) => {
  const { dir, git } = repo(t, 'Approved', { branch: true });
  assert.equal(run(dir, '--attest', REAL).code, 0);            // Approved → Implemented, on the branch
  const before = readFileSync(recordPath(dir, 'Implemented'), 'utf8');
  assert.ok(JSON.parse(before).changed.length,
    'the fixture recorded no branch radius, so this test asserts nothing');

  // The merge. `changedFiles()` is `git diff main...feat/thing`, and from here the merge base IS
  // the branch tip — so the diff is empty by construction. A re-record now would fingerprint
  // strictly fewer files than the record it replaces and read `fresh` for that reason: a stale
  // record made green by dropping the files from the radius instead of re-answering the question.
  git('add', '-A');
  git('commit', '-qm', 'status');
  git('checkout', '-q', 'main');
  git('merge', '-q', 'feat/thing');

  const r = run(dir, '--re-record', '--attest', REAL);
  assert.equal(r.code, 1, `a post-merge re-record narrowed the radius to nothing and passed:\n${r.out}`);
  assert.match(r.out, /would cover nothing/, `the refusal does not say what is wrong:\n${r.out}`);
  assert.equal(readFileSync(recordPath(dir, 'Implemented'), 'utf8'), before,
    'a refused re-record rewrote the record anyway');
});

test('AC7: a PARTIAL shrink proceeds, and is named — revision 2 narrowed the refusal to empty', (t) => {
  const { dir, git } = repo(t, 'Approved', { branch: true });
  assert.equal(run(dir, '--attest', REAL).code, 0);
  assert.ok(radiusOf(dir, 'Implemented').includes('src/other.mjs'));

  // The branch genuinely stops touching one file. That shrinks the radius honestly, and refusing
  // it would have blocked re-recording this spec forever — which is why revision 2 narrowed AC7
  // to the collapse to empty rather than adding an override flag.
  writeFileSync(join(dir, 'src', 'other.mjs'), 'export const g = 1;\n');
  git('add', '-A');
  git('commit', '-qm', 'the work no longer touches other.mjs');

  const r = run(dir, '--re-record', '--attest', REAL);
  assert.equal(r.code, 0, `a partial shrink was refused, so this spec can never be re-recorded:\n${r.out}`);
  assert.match(r.out, /radius narrowed/, `the shrink was absorbed silently:\n${r.out}`);
  assert.match(r.out, /src\/other\.mjs/, 'the output does not name the file that left the radius');

  const after = radiusOf(dir, 'Implemented');
  assert.ok(!after.includes('src/other.mjs'), 'the re-record did not re-read the radius');
  assert.ok(after.includes('src/thing.mjs'), 'the rest of the radius was dropped too');
});

// ── AC8 — an unattended run may not leave a record that reads `human` ───────────────────────

test('AC8: --unattended without --attest is refused, on a target with no MANUAL gate', (t) => {
  const { dir } = repo(t);

  // D4. The attestation minimum was conditional on a MANUAL gate existing, and `Approved →
  // Implemented` emits none — so this wrote `attested: null`, which `attestMode()` reads back as
  // `human`. The one record shape spec 0023 exists to prevent, reachable by typing the flag that
  // says the opposite.
  const r = run(dir, '--unattended');
  assert.equal(r.code, 1, `an unattended run wrote a record nobody signed:\n${r.out}`);
  assert.match(r.out, /--unattended/);
  assert.match(r.out, /absent mode reads `human`/, `the refusal does not say why:\n${r.out}`);
  assert.equal(existsSync(recordPath(dir, 'Implemented')), false, 'a record was written anyway');
  assert.equal(statusOf(dir), 'Approved', 'the Status moved on an unsigned unattended run');

  const ok = run(dir, '--unattended', '--attest', REAL);
  assert.equal(ok.code, 0, ok.out);
  assert.equal(JSON.parse(readFileSync(recordPath(dir, 'Implemented'), 'utf8')).attested.mode, 'unattended',
    'no record may read `human` after an explicitly unattended run');
});

test('AC8: and on the re-record path, which has no MANUAL gate either', (t) => {
  const { dir } = repo(t, 'Implemented');
  const r = run(dir, '--re-record', '--unattended');
  assert.equal(r.code, 1, `an unattended re-record wrote an unsigned record:\n${r.out}`);
  assert.equal(existsSync(recordPath(dir, 'Implemented')), false);
});

// ── AC9 — the two sentences that were false ────────────────────────────────────────────────

test('AC9: a re-record leaves the spec file byte-identical while saying the cell is unchanged', (t) => {
  const { dir } = repo(t, 'Implemented');
  const before = readFileSync(specFile(dir), 'utf8');
  assert.match(before, /\|\s*\*\*Status\*\*\s*\|Implemented\|/,
    'the fixture pads the Status cell, so a rewrite of the line would be invisible here');

  // D6. `setStatus()` rewrites the whole line and normalises the cell's padding, so the run
  // produced a diff under a message asserting it had not.
  const r = run(dir, '--re-record', '--attest', REAL);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /the Status cell is unchanged/);
  assert.equal(readFileSync(specFile(dir), 'utf8'), before,
    'the run said the Status cell was unchanged and rewrote the line it lives on');
});

test('AC9: an Archived record is not called an approval, and promises no staleness check', (t) => {
  const { dir, git } = repo(t, 'Verified', { branch: true });
  git('checkout', '-q', 'main');
  git('merge', '-q', 'feat/thing');

  // D7. The message was keyed on `fingerprinted === 0` rather than on the target, and an Archived
  // record fingerprints nothing either — so archiving printed a sentence about a transition that
  // had not happened. The line under it promised staleness detection for a record that measured
  // no file at all, which is a check that cannot run.
  const r = run(dir, '--to', 'Archived', '--attest', REAL);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /\(no file fingerprinted/, `the zero radius is not explained:\n${r.out}`);
  assert.doesNotMatch(r.out, /an approval fingerprints no files/,
    'an Archived record is described as an approval');
  assert.doesNotMatch(r.out, /goes stale/,
    'staleness detection is promised for a record that fingerprinted nothing');
});

test('AC9: REGRESSION — an Approved record still says it is judged by its contract', (t) => {
  const { dir } = repo(t, 'Draft');

  // Spec 0024's message, which is true and must survive: an approval certifies a contract, not a
  // tree, so "0 file(s) fingerprinted" would read as a missing measurement.
  const r = run(dir, '--attest', REAL);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /an approval fingerprints no files/);
  assert.doesNotMatch(r.out, /goes stale/, 'an approval cannot go stale — it fingerprints no file');
  assert.match(r.out, /reads amended/, 'the check an approval IS subject to went unmentioned');
});

// ── AC10 — what `spec-evidence.mjs` claims, in the state that made it false ─────────────────

test('AC10: after a move back the failing record is the live one, and the printed remedy runs', (t) => {
  const { dir } = repo(t, 'Approved', { branch: true });
  assert.equal(run(dir, '--attest', REAL).code, 0);                        // → Implemented
  assert.equal(run(dir, '--to', 'Verified', '--attest', REAL).code, 0);    // → Verified

  // D1, reproduced through the SUPPORTED path. Moving backwards is permitted — `CLAUDE.md` calls
  // it "allowed and sometimes correct" — and review found a defect, so the spec goes back to
  // Implemented and the work resumes on the files the gate fingerprinted.
  //
  // This runs the real transition rather than hand-editing the `Status` cell, and the difference is
  // the entire security model (revision 4). A genuine retreat writes a fresh `Implemented` record,
  // which is then the newest for this spec and corroborates the cell. A cell edited by hand writes
  // nothing, corroborates nothing, and silences nothing — which is what stops one word of prose
  // hiding a failing record. An earlier version of this test took the shortcut and therefore
  // asserted the attack was honoured.
  assert.equal(run(dir, '--to', 'Implemented', '--attest', REAL).code, 0,
    'a backwards transition is allowed and must be how a retreat is recorded');
  writeFileSync(join(dir, 'src', 'thing.mjs'), 'export const f = 3; // acting on the finding\n');

  const j = JSON.parse(evidence(dir, '--json').out);
  const impl = j.records.find((r) => r.to === 'Implemented');
  const verif = j.records.find((r) => r.to === 'Verified');
  assert.equal(impl.verdict, 'stale',
    `the record for the status the spec holds read ${impl.verdict} — the live status is unauditable`);
  assert.equal(impl.failing, true);
  assert.equal(verif.verdict, 'superseded', 'a status the spec withdrew is still the one being judged');
  assert.match(verif.reason, /moved back|withdrew/i, `"${verif.reason}" describes a retreat as progress`);
  assert.equal(verif.failing, false);

  // The claim `spec-evidence.mjs` prints under the failing count. Asserted over the rows rather
  // than over the sentence, so it is the claim being tested and not its wording: every record
  // still listed is the live one, apart from `unsound`, which is exempt on purpose.
  for (const r of j.records.filter((x) => x.failing)) {
    assert.ok(r.verdict === 'unsound' || r.to === r.status,
      `a ${r.to} record reads ${r.verdict} while the spec holds ${r.status} — the remedy printed under it names an action the gate refuses`);
  }

  const text = evidence(dir);
  assert.equal(text.code, 1);
  assert.match(text.out, /Re-run the gate for the status the spec holds/,
    `the stale remedy is unqualified, and was false whenever the spec had moved back:\n${text.out}`);

  // And the remedy works in exactly the state it is printed in. Before this spec the gate was
  // told the spec held Verified, so `--re-record` refused and there was no available action.
  const fix = run(dir, '--re-record', '--attest', REAL);
  assert.equal(fix.code, 0, `the remedy spec-evidence prints is refused in the state it prints it:\n${fix.out}`);
  assert.equal(statusOf(dir), 'Implemented', 'the remedy moved the Status cell');
  assert.equal(evidence(dir).code, 0, 'the refreshed record still does not describe this tree');
});

test('AC10: SENSOR — a hand-edited Status cell naming a status with no record silences nothing', (t) => {
  const { dir, git } = repo(t, 'Approved', { branch: true });
  assert.equal(run(dir, '--attest', REAL).code, 0);                        // → Implemented

  // The laundering guard, end to end. Type a further status into the header table and the record
  // that would otherwise accuse you must NOT go quiet: silencing it takes a record at the forged
  // status, and forging one makes that record `unsound`.
  writeFileSync(join(dir, 'src', 'thing.mjs'), 'export const f = 4; // changed after the gate\n');
  git('add', '-A');
  git('commit', '-qm', 'more work');
  assert.equal(evidence(dir).code, 1, 'the fixture no longer reproduces a failing record');

  writeFileSync(specFile(dir),
    readFileSync(specFile(dir), 'utf8').replace(/(\*\*Status\*\*\s*\|\s*)Implemented/, '$1Verified'));

  const j = JSON.parse(evidence(dir, '--json').out);
  const impl = j.records.find((r) => r.to === 'Implemented');
  assert.equal(impl.verdict, 'stale',
    `a hand-edited Status cell turned a failing record into ${impl.verdict} — the check now trusts its own subject`);
  assert.equal(j.failing, 1);
  assert.equal(evidence(dir).code, 1, 'editing one table cell made the toolkit stop reporting drift');
});

test('AC12: one word in the Status cell cannot silence a failing record', (t) => {
  // The criterion the security review blocked on, and the reason revision 4 exists. Revision 3
  // assumed the corroborating record would have to be FORGED. It does not: `spec-advance` writes a
  // genuine record for every transition, so a spec that reached Verified already has honest,
  // digest-intact Approved and Implemented records on disk. The attacker's corroboration is
  // pre-supplied by the toolkit itself.
  //
  // Measured before the fix: editing one word — zero JSON bytes, every record checksum verifying —
  // turned "1 of 3 record(s) no longer describe this tree" (exit 1) into "every record still
  // stands." (exit 0), while the forged claim was a HIGHER status than the one it hid.
  const { dir } = repo(t, 'Draft', { branch: true });
  for (const to of ['Approved', 'Implemented', 'Verified']) {
    assert.equal(run(dir, '--to', to, '--attest', REAL).code, 0, `could not reach ${to}`);
  }
  writeFileSync(join(dir, 'src', 'thing.mjs'), 'export const f = 9; // real drift\n');

  const before = JSON.parse(evidence(dir, '--json').out);
  assert.equal(before.records.find((r) => r.to === 'Verified').verdict, 'stale',
    'the fixture produced no drift — this test would assert nothing');
  assert.ok(before.failing >= 1);

  const digests = readdirSync(join(dir, '.ml-specs', 'evidence')).sort()
    .map((f) => readFileSync(join(dir, '.ml-specs', 'evidence', f), 'utf8'));

  // The attack: retreat the cell to a status that HAS a genuine record, touching no JSON.
  writeFileSync(specFile(dir),
    readFileSync(specFile(dir), 'utf8').replace(/(\*\*Status\*\*\s*\|\s*)Verified/, '$1Approved'));

  const after = JSON.parse(evidence(dir, '--json').out);
  assert.equal(after.records.find((r) => r.to === 'Verified').verdict, 'stale',
    'one word of prose silenced a failing record — the live status is unauditable');
  assert.ok(after.failing >= 1, 'spec-evidence stopped reporting a failure after a cell edit');

  // And prove the attack really did touch nothing else, or the assertion above proves nothing.
  const now = readdirSync(join(dir, '.ml-specs', 'evidence')).sort()
    .map((f) => readFileSync(join(dir, '.ml-specs', 'evidence', f), 'utf8'));
  assert.deepEqual(now, digests, 'the fixture changed record bytes; the attack is a cell edit only');
});

test('AC12: a hand-written record claiming no digest corroborates nothing', (t) => {
  // The second vector, found by the spec review after revision 3. `digestIntact()` returns true for
  // a record that claims no digest — right there, because a record making no claim has made none to
  // disprove — but it is the wrong question for supersession. A forgery that simply omits the field
  // is `unknown`, which never blocks, and before this it could corroborate a retreated cell and turn
  // every other record into non-failing history while claiming a HIGHER status than the one it hid.
  const { dir } = repo(t, 'Approved', { branch: true });
  assert.equal(run(dir, '--attest', REAL).code, 0);                      // → Implemented
  assert.equal(run(dir, '--to', 'Verified', '--attest', REAL).code, 0);  // → Verified
  writeFileSync(join(dir, 'src', 'thing.mjs'), 'export const f = 9; // real drift\n');
  assert.equal(JSON.parse(evidence(dir, '--json').out).records.find((r) => r.to === 'Verified').verdict,
    'stale', 'the fixture produced no drift');

  writeFileSync(join(dir, '.ml-specs', 'evidence', '0001-thing-archived.json'),
    `${JSON.stringify({ spec: 'specs/0001-thing.md', to: 'Archived', tests: [], changed: [] }, null, 2)}\n`);
  writeFileSync(specFile(dir),
    readFileSync(specFile(dir), 'utf8').replace(/(\*\*Status\*\*\s*\|\s*)Verified/, '$1Archived'));

  const j = JSON.parse(evidence(dir, '--json').out);
  assert.equal(j.records.find((r) => r.to === 'Verified').verdict, 'stale',
    'a record claiming no digest silenced a real one — it need not even be a convincing forgery');
  assert.ok(j.failing >= 1);
});

test('AC12: the report never claims more than it judged', (t) => {
  // Security review: a forged record silences the rest, and the line that used to print was
  // "every record still stands." — a reassurance stronger than the evidence, which was the harm
  // rather than the hash. Superseded records are held OUT of the judgement, so the report says how
  // many it judged and names the caveat.
  const { dir } = repo(t, 'Approved', { branch: true });
  assert.equal(run(dir, '--attest', REAL).code, 0);                      // → Implemented
  assert.equal(run(dir, '--to', 'Verified', '--attest', REAL).code, 0);  // → Verified

  const out = evidence(dir).out;
  assert.doesNotMatch(out, /every one still describing this tree/,
    'the report still claims every record confirms the tree, including ones it did not judge');
  assert.match(out, /of \d+ record\(s\) judged/,
    'the report does not say how many records it actually judged');
  assert.match(out, /superseded and were not judged/,
    'superseded records are held out of the judgement and the report does not say so');
  assert.match(out, /resists accident and not a deliberate edit/,
    'the caveat does not say what the digest is worth');
});

test('AC12: a record that could not be judged is not counted as one that was', (t) => {
  // `judged` was `total - superseded`, which folded every `unknown` into it. So a record whose own
  // reason reads "1 file(s) could not be read, so this cannot be judged either way" was counted in
  // a sentence saying nothing judged is failing — "could not determine" collapsing into "fine",
  // which is the failure the `unknown` verdict exists to keep separate (`lib/evidence.mjs:14`).
  // The fix shipped in the same commit as the AC12 caveat and had no sensor of its own.
  const { dir } = repo(t, 'Approved', { branch: true });
  assert.equal(run(dir, '--attest', REAL).code, 0);  // → Implemented, fingerprinting the branch files

  // A directory where a file was: `readFileSync` raises EISDIR rather than ENOENT, so `compare()`
  // sorts it into `unreadable` instead of `removed` and the verdict is `unknown`, not `stale`.
  rmSync(join(dir, 'src', 'other.mjs'));
  mkdirSync(join(dir, 'src', 'other.mjs'));

  const j = JSON.parse(evidence(dir, '--json').out);
  const undecided = j.records.filter((r) => r.verdict === 'unknown');
  assert.ok(undecided.length, `the fixture produced no unknown record, so this asserts nothing: ${evidence(dir).out}`);
  assert.equal(j.undecided, undecided.length, '--json does not report how many records went unjudged');
  assert.equal(j.judged, j.total - j.superseded - undecided.length,
    'a record whose own reason says it cannot be judged either way was counted among the judged');

  const out = evidence(dir).out;
  assert.match(out, /could not be judged either way/,
    'the report does not separate the undecided from the judged');
  assert.doesNotMatch(out, new RegExp(`${j.total} of ${j.total} record\\(s\\) judged`),
    'the report claims it judged every record, including the one it could not read');
});

test('AC12: every flag the output tells you to run actually exists', (t) => {
  // Security review caught this INSIDE the sentence written to stop overclaiming: the caveat said
  // "Read them with --all", and `--all` is parsed nowhere. Unknown flags are silently ignored, so a
  // reader following the instruction runs a command that does nothing, sees identical output, and
  // believes they performed the check. A remedy naming an action that does not exist is the same
  // defect as `repo-doctor`'s "re-run the gate" was in spec 0025.
  const src = readFileSync(join(DIR, 'spec-evidence.mjs'), 'utf8');
  const parsed = new Set([...src.matchAll(/has\('([a-z-]+)'\)/g)].map((m) => `--${m[1]}`));
  const advertised = new Set([...src.matchAll(/(?:Run|run|read|Read)[^'"`\n]{0,40}(--[a-z-]+)/g)].map((m) => m[1]));
  for (const flag of advertised) {
    assert.ok(parsed.has(flag),
      `spec-evidence.mjs tells the reader to run ${flag}, which it does not parse (parses: ${[...parsed].join(', ')})`);
  }
});

test('AC12: the JSON payload carries the caveat, not just the human output', (t) => {
  // The consumer least able to infer a caveat — the MCP tool, and a model reading it — was the one
  // still being handed the older, stronger claim. exitCode 0 has to be readable as "nothing JUDGED
  // is failing", which needs `judged` and `superseded` in the payload.
  const { dir } = repo(t, 'Approved', { branch: true });
  assert.equal(run(dir, '--attest', REAL).code, 0);                      // → Implemented
  assert.equal(run(dir, '--to', 'Verified', '--attest', REAL).code, 0);  // → Verified

  const j = JSON.parse(evidence(dir, '--json').out);
  assert.equal(typeof j.judged, 'number', '--json does not say how many records were judged');
  assert.equal(typeof j.superseded, 'number', '--json does not say how many were held out');
  assert.ok(j.superseded > 0 && j.judged < j.total, 'the fixture superseded nothing — this asserts nothing');
  assert.match(j.note ?? '', /resists accident/, '--json carries no caveat for a consumer that cannot infer one');
});
