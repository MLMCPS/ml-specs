#!/usr/bin/env node
// Check the MECHANICAL half of a /spec-advance lifecycle gate.
// Pure Node, no dependencies. Read-only. No network calls — nothing leaves this machine.
//
//   node spec-gate.mjs specs/0001-foo.md                  # gate for the next status
//   node spec-gate.mjs specs/0001-foo.md --to Verified    # gate for a named target
//   node spec-gate.mjs specs/0001-foo.md --json           # machine-readable
//   node spec-gate.mjs specs/0001-foo.md --root /path/to/repo
//   node spec-gate.mjs specs/0001-foo.md --re-record      # re-gate the status it already holds
//
// Why this exists: /spec-advance's gates are half judgement and half bookkeeping, and the
// bookkeeping half was being done by a model re-reading the spec and globbing for test files.
// That is slow, costs tokens per run, and is the half most likely to be done sloppily — a
// named-but-missing test file is the most common way a status ends up claiming evidence that
// isn't there. A script does it exactly, every time, for free.
//
// What it deliberately does NOT decide: whether the human approved in conversation, whether a
// §8 question is blocking, whether the reviewer was satisfied, whether the suite ran green.
// Those are reported as MANUAL. A script that guessed at them would be worse than no script,
// because its PASS would get believed.
//
// Exit codes: 0 = no mechanical gate failed · 1 = at least one FAIL · 2 = could not run.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { LIFECYCLE, listSpecs } from './lib/specs.mjs';
import { lines } from './lib/text.mjs';

// ---------------------------------------------------------------------------- args

// Walked rather than searched, so a positional that happens to equal a flag's value
// (e.g. `--root specs` then `specs/0001-foo.md`) is still read as the positional.
const TAKES_VALUE = new Set(['--root', '--to']);
const opts = { '--root': process.cwd(), '--to': null };
let specArg = null;
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (TAKES_VALUE.has(a)) { opts[a] = argv[++i] ?? null; continue; }
    if (a === '--json') { opts['--json'] = true; continue; }
    if (a === '--run-suite') { opts['--run-suite'] = true; continue; }
    if (a === '--re-record') { opts['--re-record'] = true; continue; }
    if (a.startsWith('--')) continue;
    if (specArg === null) specArg = a;
  }
}

const ROOT = resolve(opts['--root'] ?? process.cwd());
// Off by default: see the suite-green gate. `SDD_SUITE_TIMEOUT_MS` exists because a hung suite
// should end as "could not run", not as a gate that never returns.
const RUN_SUITE = opts['--run-suite'] === true;
// Re-gate the status the spec ALREADY holds, against today's tree. It relaxes exactly one check —
// the `already <status>` FAIL below — and nothing else: every other gate for that target runs
// exactly as it did when the status was first granted, because a re-record is a re-gate and not a
// rubber stamp. Without it, acting on a review finding turns the record it was measured against
// `stale` with no way to refresh it (spec 0025). It is refused at `Draft` and `Archived`, which
// have no block it could re-gate honestly — see `RE_RECORD_REFUSED` below.
const RE_RECORD = opts['--re-record'] === true;
const SUITE_TIMEOUT_MS = Number(process.env.SDD_SUITE_TIMEOUT_MS) || 15 * 60 * 1000;
const JSON_OUT = opts['--json'] === true;

if (!specArg) {
  console.error('usage: spec-gate.mjs <spec-file> [--to <Status>] [--root <dir>] [--json] [--run-suite] [--re-record]');
  process.exit(2);
}

// ---------------------------------------------------------------------------- load

const specRel = relative(ROOT, resolve(ROOT, specArg)).split('\\').join('/');
const specAbs = join(ROOT, specRel);
if (!existsSync(specAbs)) {
  console.error(`spec-gate: no such file: ${specRel}`);
  process.exit(2);
}

// Parse via the shared implementation so this agrees with /repo-status, /repo-doctor, the
// dashboard and the MCP server about what a spec says. Two parsers would have drifted.
const spec = listSpecs(ROOT).find((s) => s.file === specRel);
if (!spec) {
  console.error(`spec-gate: ${specRel} is not a spec file (expected specs/NNNN-slug.md)`);
  process.exit(2);
}

const text = readFileSync(specAbs, 'utf8');
const current = spec.status;
// `--re-record` names no new target: the status being re-gated is the one the spec holds. Left to
// default to the NEXT status it would gate a transition nobody asked for.
const target = opts['--to'] ?? (RE_RECORD
  ? current
  : (current && LIFECYCLE.indexOf(current) < LIFECYCLE.length - 1
    ? LIFECYCLE[LIFECYCLE.indexOf(current) + 1]
    : null));

const gates = [];
// Every test path this run resolved, uncapped and unformatted.
//
// `evidence` below is for a reader and is capped at ten with a "… and N more" line, so it cannot
// be used as the list of files a verdict rested on. `spec-advance.mjs` records that list, and a
// truncated one would silently narrow what the record covers — the same defect the cap's own
// comment is about, one consumer over.
const resolvedTests = [];
// And the §6 tokens AS WRITTEN, before resolution. `tests` says where each landed on disk;
// this says what the spec claimed — repoint a row at a different file and the paths change
// while every file on disk stays byte-identical, so only this notices.
/**
 * What §6 names, whatever transition is being gated.
 *
 * Read here rather than inside the `tests-exist` gate, which only runs for one target: a reader
 * asking about a Verified record would have gated toward Archived, found no `tests-exist` block,
 * and been handed an empty list — which against a record that named something reads as "§6 no
 * longer names it", an amendment nobody made. §6's contents are a property of the document, not
 * of the transition somebody happens to be asking about.
 */
const claimedNow = () => {
  const s6 = section(6);
  return s6 === null ? [] : [...new Set(claimedTests(s6))].sort();
};
// Evidence is capped so a badly-drifted spec can't bury the verdict, but a silent cap would
// read as "that's all of it" — so say when there is more.
const CAP = 10;
const add = (name, verdict, detail, evidence = []) => {
  const shown = evidence.slice(0, CAP);
  if (evidence.length > CAP) shown.push(`… and ${evidence.length - CAP} more`);
  gates.push({ name, verdict, detail, evidence: shown, evidenceTotal: evidence.length });
};

// ---------------------------------------------------------------------------- helpers

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** The body of a numbered spec section, e.g. section(6) → everything under "## 6. …". */
function section(n) {
  // `rows`, not `lines` — `lines()` is the CRLF-tolerant splitter imported above, and a local of
  // the same name shadowed it here.
  const rows = lines(text);
  const start = rows.findIndex((l) => new RegExp(`^#{1,4}\\s*${n}[.)]?\\s`).test(l));
  if (start === -1) return null;
  const level = (rows[start].match(/^#+/) ?? ['##'])[0].length;
  let end = rows.length;
  for (let i = start + 1; i < rows.length; i++) {
    const m = rows[i].match(/^(#+)\s/);
    if (m && m[1].length <= level) { end = i; break; }
  }
  return rows.slice(start + 1, end).join('\n');
}

/**
 * The command §6.1 says constitutes this spec's final acceptance run.
 *
 * From the spec rather than from a config key, because the answer differs per spec — a unit run
 * for one, `npm test && npm run test:e2e` for another — and §6.1 already asks the author to write
 * it down. Reading a global setting instead would mean the gate ran something the spec never
 * named.
 *
 * @returns {string|null} the command, or null when §6.1 names none
 */
function suiteCommand() {
  const s6 = section(6);
  if (s6 === null) return null;
  const line = lines(s6).find((l) => /full suite\s*:/i.test(l));
  if (!line) return null;
  const cmd = (line.match(/`([^`]+)`/) ?? [])[1];
  if (!cmd) return null;
  // The template's own placeholder is not a command. Running `<e.g. npm test / mvn verify>` would
  // fail and report the suite red, which is a worse answer than saying nobody wrote one down.
  const clean = cmd.trim();
  return clean.startsWith('<') || /^e\.g\./i.test(clean) ? null : clean;
}

/**
 * Everything a suite command is allowed to be made of. Anything else refuses the command.
 *
 * An ALLOWLIST on the CHARACTER CLASS, not a denylist of known-bad strings — a denylist of
 * metacharacters is the thing that gets bypassed, because it has to enumerate every spelling of
 * the attack and the allowlist only has to enumerate what a test command needs.
 *
 * MEASURED, across all 25 §6.1 commands in this repo: only word characters, spaces, `.`, `/`,
 * `-`, `&`, `(` and `)` actually appear. `= : @ + ,` are permitted for adopting repos — `--opt=v`,
 * `@scope/pkg`, `-m 'a,b'` are ordinary test commands — and are not claimed to be needed here.
 *
 * `*` is NOT permitted, and that is the one exclusion worth explaining. It was allowed until a
 * review demonstrated the bypass: a §6.1 of `node *` in a tree containing a file named
 * `--eval=require("fs").writeFileSync(…)` ran arbitrary JS and the gate reported PASS, while the
 * operator had been shown `node *`. §7 draws the residual at "nothing executes unseen", and glob
 * expansion crosses it — the filename is attacker-controlled in the same breath as the spec. That
 * is unlike the accepted `&&` residual, which is visible in the string the operator reads. No §6.1
 * in this repo uses `*`.
 *
 * Parentheses are grouping — `validate && (cd ml-specs && npm test)` is a real §6.1 here — and
 * grouping can do nothing a `&&` chain cannot. Substitution is `$(`, and `$` is refused outright,
 * which takes `${` and `$VAR` with it; the shell is pinned to `/bin/sh` at the exec site so that
 * sentence is true of the shell that actually runs. A newline is not whitespace here: `\t` and a
 * space are, `\n` is not.
 */
const SUITE_FORBIDDEN = /[^\w \t.\/\-=:@+,'"()&]/;

/**
 * The punctuation the class above permits, spelled for the refusal message by ASKING the class
 * rather than restating it.
 *
 * A second, hand-written copy is how the refusal came to offer `*` inside the message refusing
 * `*`: the character left the class and the sentence beside it did not. Derived, the two cannot
 * disagree. Word characters, spaces and tabs are named in the message directly; this is the rest.
 */
const SUITE_ALLOWED_PUNCT = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i))
  .filter((c) => !/[\w\s]/.test(c) && !SUITE_FORBIDDEN.test(c))
  .join(' ');

/**
 * May this §6.1 command be handed to a shell?
 *
 * PURE — it inspects a string and executes nothing. That is structural rather than incidental: a
 * predicate that can run a command is the bug it exists to prevent, wearing the fix's clothes.
 *
 * @param {string} cmd the command §6.1 names
 * @returns {{ok: true} | {ok: false, found: string}} `found` is the character that refused it
 */
function suiteShellSafe(cmd) {
  const s = String(cmd ?? '');
  const bad = s.match(SUITE_FORBIDDEN);
  if (bad) return { ok: false, found: bad[0] };
  // The one rule the character class cannot express. `&&` is sequencing and `&` is backgrounding,
  // and the whole point of running the suite is to wait for its answer — so a `&` is legal only as
  // half of a `&&`. Removing the pairs first leaves any lone one behind.
  if (s.replace(/&&/g, '').includes('&')) return { ok: false, found: '&' };
  return { ok: true };
}

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'target', 'build', 'dist', 'out', 'vendor', '.venv', 'venv',
  '__pycache__', '.next', '.nuxt', 'coverage', '.gradle', '.idea', 'bin', 'obj',
]);

/** Bounded index of basename → relative paths. Built once, only if a gate needs it. */
let fileIndex = null;
function indexFiles() {
  if (fileIndex) return fileIndex;
  fileIndex = new Map();
  let budget = 60000; // enough for a large monorepo, bounded so this can't hang a CI job
  const walk = (dir) => {
    if (budget <= 0) return;
    let entries;
    try { entries = readdirSync(join(ROOT, dir), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (budget <= 0) return;
      if (e.name.startsWith('.') && e.name !== '.github') continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(rel);
      } else {
        budget--;
        if (!fileIndex.has(e.name)) fileIndex.set(e.name, []);
        fileIndex.get(e.name).push(rel);
      }
    }
  };
  walk('');
  return fileIndex;
}

/**
 * The default branch, by git's own answer first.
 *
 * Lifted out of the branch-merged gate because the record needs the same answer: a verdict that
 * says which tree it describes has to name the tree it measured against, and two resolutions of
 * "the base" would let the gate and the record disagree about it.
 */
function defaultBranch() {
  if (!git(['rev-parse', '--is-inside-work-tree'])) return null;
  const head = git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  return (head && head.replace(/^origin\//, ''))
    ?? ['main', 'master', 'develop'].find((b) => git(['rev-parse', '--verify', '--quiet', b]))
    ?? null;
}

/** What this spec's branch changed against the base. `[]` when git cannot say — never a guess. */
function changedFiles(base, branch) {
  if (!base || !branch) return [];
  const clean = String(branch).replace(/[`*]/g, '').trim();
  if (!git(['rev-parse', '--verify', '--quiet', clean])) return [];
  const out = git(['diff', '--name-only', `${base}...${clean}`]);
  // The evidence directory is never part of the radius, and it is not an aesthetic exclusion.
  // Records are tracked, so writing one puts it in the branch diff — which means every record
  // fingerprints the directory it lives in, and writing a record makes records stale. Including
  // ITSELF: a `--re-record` run rewrote its own file and the new record was stale on arrival,
  // naming that file as the thing that changed. That is unfixable by re-recording, because
  // re-recording writes the file again.
  //
  // Nothing is lost. A record is evidence ABOUT a spec and its code; no gate certifies the
  // contents of `.ml-specs/`, and a doctored record is caught by `digestIntact()`, not by a
  // neighbouring record's file hashes.
  // command output: git writes \n, whatever the checkout's line endings are.
  return out ? out.split('\n').filter(Boolean).filter((f) => !f.startsWith('.ml-specs/')) : [];
}

const TEST_EXT = 'java|kt|kts|ts|tsx|js|jsx|mjs|cjs|py|go|rb|cs|php|scala|swift|rs|dart|ex|exs';

/**
 * Pull the things a §6 test-plan table claims exist. Two shapes, because projects write both:
 *   * a path or filename with an extension  — user.service.spec.ts, src/__tests__/foo.test.js
 *   * a bare Java/C#-style test class name  — CouponExpiryIntegrationTest
 * Anything else in the cell (prose, a criterion id, a method name) is ignored on purpose:
 * a false "missing test" would block a legitimate transition, which is worse than a miss.
 */
function claimedTests(body) {
  const out = new Set();
  for (const m of body.matchAll(new RegExp(`[A-Za-z0-9_./\\\\-]+\\.(?:${TEST_EXT})\\b`, 'g'))) {
    const candidate = m[0].split('\\').join('/');
    // A glob in the prose — `scripts/*.test.mjs` describing a runner's config — matches from the
    // dot onward, because `*` is not in the character class above, and yields a stem-less
    // `.test.mjs`. Nobody claimed that file, so failing tests-exist on it blocks a legitimate
    // transition: exactly what this function's contract above says must not happen. A basename
    // starting with `.` has no stem, so it is a pattern or a bare suffix, never a claimed test.
    if (candidate.slice(candidate.lastIndexOf('/') + 1).startsWith('.')) continue;
    out.add(candidate);
  }
  for (const m of body.matchAll(/\b([A-Z][A-Za-z0-9]*(?:Test|Tests|Spec|IT|TestCase))\b/g)) {
    out.add(m[1]);
  }
  return [...out];
}

function resolveTest(token) {
  if (/[./]/.test(token) && token.includes('/')) {
    if (existsSync(join(ROOT, token))) return token;
    // A spec often writes a path relative to a module root rather than the repo root.
    const hits = indexFiles().get(basename(token)) ?? [];
    const suffix = hits.find((p) => p.endsWith(token));
    if (suffix) return suffix;
    return hits[0] ?? null;
  }
  if (/\.(?:[a-z]+)$/i.test(token)) {
    return (indexFiles().get(token) ?? [])[0] ?? null;
  }
  // Bare class name — find a source file whose basename matches.
  for (const [name, paths] of indexFiles()) {
    if (name.replace(new RegExp(`\\.(?:${TEST_EXT})$`), '') === token) return paths[0];
  }
  return null;
}

// ---------------------------------------------------------------------------- gates

/**
 * The two statuses `--re-record` cannot honestly re-gate, and why.
 *
 * The refusal lives HERE rather than in `spec-advance.mjs` because the gate is what knows
 * `current` and `target`, and a second copy of the rule there would drift from this one — the
 * same argument the `already <status>` refusal is made on.
 *
 * Both were reproduced (spec 0026 §1). Widening `forward` to cover the re-record case made every
 * target's block reachable, and these two have nothing behind them.
 */
const RE_RECORD_REFUSED = {
  Draft: 'no gate block exists for Draft, so re-recording it would write a record with the lifecycle check alone examined — the rubber stamp this flag exists not to be',
  Archived: 'the only gate for Archived asks `git branch --merged`, which lists the branches on THIS machine — a merged branch that was pruned reads FAIL and a merge nobody pushed reads PASS. Re-gating a status granted arbitrarily long ago is exactly where the pruned branch is normal',
};

// 0. The transition itself.
if (!current) {
  add('lifecycle', 'FAIL', `Status cell holds no lifecycle word: ${JSON.stringify(spec.rawStatus ?? '(empty)')}`);
} else if (!target) {
  add('lifecycle', 'FAIL', `${current} is the last status — nothing to advance to`);
} else if (!LIFECYCLE.includes(target)) {
  add('lifecycle', 'FAIL', `"${target}" is not a lifecycle status (${LIFECYCLE.join(' → ')})`);
} else {
  const from = LIFECYCLE.indexOf(current);
  const to = LIFECYCLE.indexOf(target);
  if (RE_RECORD && to !== from) {
    // A re-record refreshes the status a spec HOLDS. Pointed at any other one it would write a
    // record for a transition that did not happen — history invented rather than refreshed.
    add('lifecycle', 'FAIL', `--re-record refreshes the status this spec holds, and it holds ${current}, not ${target} — refreshing a status it does not hold would be writing history that never happened`);
  } else if (RE_RECORD && RE_RECORD_REFUSED[current]) {
    add('lifecycle', 'FAIL', `--re-record cannot re-gate ${current}: ${RE_RECORD_REFUSED[current]}`);
  } else if (to === from) {
    if (RE_RECORD) add('lifecycle', 'PASS', `re-recording ${current} against today's tree`);
    else add('lifecycle', 'FAIL', `already ${current}`);
  } else if (to < from) add('lifecycle', 'MANUAL', `moving backwards ${current} → ${target} — allowed, but it must add a Revisions row and un-tick criteria that no longer hold`);
  else if (to - from > 1) add('lifecycle', 'FAIL', `cannot skip: ${current} → ${target} passes ${LIFECYCLE.slice(from + 1, to).join(', ')} — run the gates in order`);
  else add('lifecycle', 'PASS', `${current} → ${target}`);
}

// Which target's gates to run. Moving to a status runs them — and so does re-recording one, since
// a re-record measures the status the spec already holds against today's tree. Leave the re-record
// out and it would run the lifecycle check alone, pass with nothing examined, and become the rubber
// stamp it must not be: the point is the same verdict re-earned, not the old verdict re-stamped.
//
// A re-record the lifecycle gate just refused examines nothing either: running the Archived block
// for a flag that is being refused would print a `git branch --merged` verdict underneath the
// sentence explaining why that verdict cannot be trusted.
const forward = Boolean(current && target && (
  LIFECYCLE.indexOf(target) > LIFECYCLE.indexOf(current)
  || (RE_RECORD && target === current && !RE_RECORD_REFUSED[current])
));

// 1. Draft → Approved: unfilled template, and whatever §8 still holds.
if (forward && target === 'Approved') {
  const placeholders = [];
  // Angle brackets inside code are SYNTAX, not an unfilled template cell: `git diff <default>...<branch>`,
  // a branch template `feat/<id>-<slug>`, a worked example of a bad `<TBD>` input. A real unfilled
  // placeholder is never in backticks — every one in specs/TEMPLATE.md is bare prose — so skipping code
  // cannot weaken this gate. Not skipping it made any spec that documents CLI or naming syntax
  // unapprovable: spec 0017 tripped 17 times on its own accurate documentation.
  // Known limit: the inline-code strip is per line, so a code span wrapped across a newline is not
  // stripped and its brackets still report. That is rare and reads badly anyway — reflow the line.
  let inFence = false;
  lines(text).forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    if (/^\s*<!--/.test(line)) return;
    for (const m of line.replace(/`[^`]*`/g, '').matchAll(/<([a-z][a-z0-9 _/-]{2,40})>/gi)) {
      if (/:\/\//.test(m[1])) continue;
      placeholders.push(`${specRel}:${i + 1}  <${m[1]}>`);
    }
  });
  if (placeholders.length) {
    add('placeholders', 'FAIL', `${placeholders.length} unfilled template placeholder(s)`, placeholders);
  } else {
    add('placeholders', 'PASS', 'no template placeholders left');
  }

  const s8 = section(8);
  if (s8 === null) {
    add('section-8', 'MANUAL', 'no section 8 found — confirm the spec has an open-questions section');
  } else {
    const bullets = lines(s8).filter((l) => /^\s*[-*]\s+\S/.test(l) && !/^\s*[-*]\s+(none|n\/a|—)\b/i.test(l));
    if (bullets.length === 0) add('section-8', 'PASS', 'section 8 holds no open questions');
    else add('section-8', 'MANUAL', `section 8 holds ${bullets.length} open question(s) — judge whether any is blocking (would change an API shape, data model, error code, scope boundary, or compatibility)`, bullets.map((b) => b.trim()));
  }

  add('human-approval', 'MANUAL', 'the human must approve in the conversation — a script cannot witness that');
}

// 2. Approved → Implemented, and still required at Verified: criteria + the named tests.
if (forward && (target === 'Implemented' || target === 'Verified')) {
  if (spec.acTotal === 0) {
    add('criteria', 'FAIL', 'no acceptance criteria — there is nothing to verify against');
  } else if (spec.acChecked < spec.acTotal) {
    add('criteria', 'FAIL', `${spec.acTotal - spec.acChecked} of ${spec.acTotal} acceptance criteria unchecked`);
  } else {
    add('criteria', 'PASS', `all ${spec.acTotal} acceptance criteria checked`);
  }

  const s6 = section(6);
  if (s6 === null) {
    add('tests-exist', 'FAIL', 'no section 6 (test plan) found — nothing names the tests');
  } else {
    const claimed = claimedTests(s6);
    if (claimed.length === 0) {
      add('tests-exist', 'FAIL', 'section 6 names no test file or test class — a test plan that names nothing cannot be checked');
    } else {
      const missing = [];
      const found = [];
      for (const t of claimed) {
        const hit = resolveTest(t);
        if (hit) { found.push(`${t} → ${hit}`); resolvedTests.push(hit); }
        else missing.push(t);
      }
      if (missing.length) {
        add('tests-exist', 'FAIL', `${missing.length} of ${claimed.length} named test(s) do not exist on disk`, missing);
      } else {
        add('tests-exist', 'PASS', `all ${claimed.length} named test(s) exist on disk`, found);
      }
    }
  }
}

// 3. Implemented → Verified: the parts only a run can establish.
if (forward && target === 'Verified') {
  // `--run-suite` turns the one MANUAL gate a script CAN settle into a real verdict.
  //
  // Off by default and deliberately so. Running the suite is the expensive half of a transition —
  // on a large repo it is minutes — and a gate that always costs minutes is a gate people route
  // around, after which nothing is checked at all. Opt in where the suite is fast enough to
  // afford it; keep the honest MANUAL where it is not.
  //
  // It runs a command out of a COMMITTED file, which is a real consideration: anyone who can edit
  // the spec can choose what this executes. Three things hold that down. It never runs unless the
  // flag is typed; `suiteShellSafe()` refuses anything carrying a shell metacharacter beyond a
  // conservative allowlist, before any of it reaches a shell; and what does run is written to
  // stderr FIRST, so the operator sees the command instead of meeting it in the verdict afterwards,
  // by which time it has run.
  const cmd = RUN_SUITE ? suiteCommand() : null;
  const safety = cmd ? suiteShellSafe(cmd) : null;
  if (RUN_SUITE && !cmd) {
    add('suite-green', 'MANUAL', '--run-suite was asked for, but §6.1 names no full-suite command — write one down, or judge this yourself');
  } else if (cmd && !safety.ok) {
    // MANUAL, never FAIL. A command this gate declined to run has not failed — nobody ran it, and
    // reporting it red would send somebody to debug a suite that never started. That is the same
    // distinction the exit-127 branch below draws.
    add('suite-green', 'MANUAL', `\`${cmd}\` was not run: §6.1 holds ${JSON.stringify(safety.found)}, and this gate hands a shell only word characters, spaces, tabs and \`${SUITE_ALLOWED_PUNCT}\` — where \`&\` is legal only as \`&&\` — run the suite yourself and judge it`);
  } else if (cmd) {
    // Before the run, and on stderr rather than stdout: `--json` emits the whole report on stdout
    // and `spec-advance.mjs` parses it, so a line there would corrupt the payload and break
    // `spec-advance --run-suite` — the exact path this printing exists to make safe.
    console.error(`spec-gate: running the §6.1 full suite — ${cmd}`);
    const started = Date.now();
    let ok = false;
    let detail = '';
    try {
      execFileSync('/bin/sh', ['-c', cmd], {
        cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: SUITE_TIMEOUT_MS,
      });
      ok = true;
    } catch (e) {
      // A suite that could not START and a suite that FAILED are different answers, and telling a
      // reader "the suite is red" when the command does not exist sends them to debug the wrong
      // thing entirely.
      // NOT covered by this distinction: a command that is malformed rather than missing —
      // `a &&&& b`, an unbalanced quote — makes `sh` exit 2, which reads here as a red suite.
      // It is "a suite that never started" in substance, and FAIL is blocking, so the operator
      // is sent to debug something they cannot make green. Left as-is deliberately: every fix is
      // heuristic, and treating exit 2 as could-not-run would mask a suite that genuinely exits 2.
      // Written down rather than implied, because the comment below would otherwise read as if
      // the case were handled.
      // 127 is "command not found" and 126 is "found but not executable" — both come from the
      // SHELL, not from the suite, and reporting them as a red suite sends somebody to debug
      // tests that never ran. `e.status === undefined` is the spawn itself failing.
      const couldNotRun = e.status === undefined || e.status === 127 || e.status === 126;
      // command output: the next branch splits an Error MESSAGE for its first line, not a file.
      detail = e.code === 'ETIMEDOUT'
        ? `timed out after ${Math.round(SUITE_TIMEOUT_MS / 1000)}s`
        : (couldNotRun
          ? `could not run (exit ${e.status ?? '-'}) — ${e.status === 127 ? 'command not found' : e.status === 126 ? 'not executable' : String(e.message).split('\n')[0]}`
          : `exit ${e.status}`);
    }
    const secs = Math.round((Date.now() - started) / 1000);
    if (ok) add('suite-green', 'PASS', `\`${cmd}\` ran green in ${secs}s`);
    else if (detail.startsWith('could not run') || detail.startsWith('timed out')) {
      add('suite-green', 'MANUAL', `\`${cmd}\` ${detail} — this is not a red suite, and judging it as one would send you to debug the wrong thing`);
    } else add('suite-green', 'FAIL', `\`${cmd}\` ${detail} after ${secs}s`);
  } else {
    add('suite-green', 'MANUAL', 'the §6.1 full suite must have run green end to end in this session — if it cannot be run here, refuse the transition. `--run-suite` runs it instead, when §6.1 names the command');
  }
  add('adversarial-review', 'MANUAL', 'a clean /spec-verify must have marked every criterion satisfied, with a functional/E2E test for each user-facing or contract-level one');
}

// 4. Verified → Archived: is the branch actually merged?
if (forward && target === 'Archived') {
  const branch = spec.branch;
  if (!branch) {
    add('branch-merged', 'FAIL', 'no Branch recorded in the header table — cannot check whether it merged');
  } else if (!git(['rev-parse', '--is-inside-work-tree'])) {
    add('branch-merged', 'MANUAL', 'not a git work tree — confirm the merge by hand');
  } else {
    const head = git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
    const def = (head && head.replace(/^origin\//, ''))
      ?? ['main', 'master', 'develop'].find((b) => git(['rev-parse', '--verify', '--quiet', b]));
    const clean = branch.replace(/[`*]/g, '').trim();
    if (!def) {
      add('branch-merged', 'MANUAL', `could not determine the default branch — check \`git branch --merged\` for ${clean} by hand`);
    } else {
      const merged = (git(['branch', '--merged', def]) ?? '')
        // command output: `git branch --merged`, not a file somebody's editor wrote.
        .split('\n').map((l) => l.replace(/^[*+ ]+/, '').trim());
      if (merged.includes(clean)) {
        add('branch-merged', 'PASS', `${clean} is merged into ${def}`);
      } else {
        const contains = git(['branch', '--contains', clean]);
        add('branch-merged', 'FAIL', `${clean} is not in \`git branch --merged ${def}\``,
          contains ? [`branches containing it: ${contains.replace(/\s+/g, ' ').trim()}`] : []);
      }
    }
  }
  add('archive-move', 'MANUAL', `on pass, \`git mv ${specRel} specs/archive/${basename(specRel)}\` and fix links that pointed at it — the number is never reused`);
}

// ---------------------------------------------------------------------------- report

const failed = gates.filter((g) => g.verdict === 'FAIL');
const manual = gates.filter((g) => g.verdict === 'MANUAL');

if (JSON_OUT) {
  const base = defaultBranch();
  console.log(JSON.stringify({
    spec: specRel, title: spec.title, current, target,
    ok: failed.length === 0, gates,
    // What the gate actually read, for whoever records this verdict. Not shown in the human
    // output: a reader wants the capped `evidence` line, a record wants every path.
    tests: [...new Set(resolvedTests)].sort(),
    claimed: claimedNow(),
    baseBranch: base, baseRev: base ? (git(['rev-parse', base]) ?? null) : null,
    // Empty for `Approved`, and only for `Approved`. That transition certifies a human read the
    // CONTRACT — no code exists yet, so the branch diff is not its radius. Recording it anyway made
    // every approval read `stale` the moment implementation began, which is the one thing that was
    // supposed to happen next: a signal that fires on every success is one people stop reading.
    //
    // Nothing detectable is lost. `freshness()` checks the contract BEFORE the files
    // (`lib/evidence.mjs:200-209`), so a criterion softened or a §6 row repointed after approval
    // still reads `amended`; a record edited on disk still reads `unsound`. Only `stale` goes, and
    // for an approval `stale` could only ever mean "this spec is being built".
    //
    // Conditioned rather than deleted, deliberately: dropping the line would empty the radius for
    // `Implemented` and `Verified` too and turn their freshness check off silently.
    changed: target === 'Approved' ? [] : changedFiles(base, spec.branch),
  }, null, 2));
} else {
  const mark = { PASS: '✓', FAIL: '✗', MANUAL: '·' };
  console.log(`${specRel} — ${spec.title}`);
  console.log(`${current ?? '(no status)'} → ${target ?? '(none)'}\n`);
  for (const g of gates) {
    console.log(`  ${mark[g.verdict]} ${g.verdict.padEnd(6)} ${g.name.padEnd(18)} ${g.detail}`);
    for (const e of g.evidence) console.log(`             ${e}`);
  }
  console.log();
  if (failed.length) {
    console.log(`✗ ${failed.length} gate(s) failed — do not write the status. Report which, and the one command that produces the missing evidence.`);
  } else {
    console.log('✓ no mechanical gate failed.');
  }
  if (manual.length) {
    console.log(`· ${manual.length} gate(s) need judgement — this script does not decide them.`);
  }
}

process.exit(failed.length ? 1 : 0);
