#!/usr/bin/env node
// Check the MECHANICAL half of a /spec-advance lifecycle gate.
// Pure Node, no dependencies. Read-only. No network calls — nothing leaves this machine.
//
//   node spec-gate.mjs specs/0001-foo.md                  # gate for the next status
//   node spec-gate.mjs specs/0001-foo.md --to Verified    # gate for a named target
//   node spec-gate.mjs specs/0001-foo.md --json           # machine-readable
//   node spec-gate.mjs specs/0001-foo.md --root /path/to/repo
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
    if (a.startsWith('--')) continue;
    if (specArg === null) specArg = a;
  }
}

const ROOT = resolve(opts['--root'] ?? process.cwd());
const JSON_OUT = opts['--json'] === true;

if (!specArg) {
  console.error('usage: spec-gate.mjs <spec-file> [--to <Status>] [--root <dir>] [--json]');
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
const target = opts['--to'] ?? (current && LIFECYCLE.indexOf(current) < LIFECYCLE.length - 1
  ? LIFECYCLE[LIFECYCLE.indexOf(current) + 1]
  : null);

const gates = [];
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
  const lines = text.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^#{1,4}\\s*${n}[.)]?\\s`).test(l));
  if (start === -1) return null;
  const level = (lines[start].match(/^#+/) ?? ['##'])[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= level) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n');
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
  if (to === from) add('lifecycle', 'FAIL', `already ${current}`);
  else if (to < from) add('lifecycle', 'MANUAL', `moving backwards ${current} → ${target} — allowed, but it must add a Revisions row and un-tick criteria that no longer hold`);
  else if (to - from > 1) add('lifecycle', 'FAIL', `cannot skip: ${current} → ${target} passes ${LIFECYCLE.slice(from + 1, to).join(', ')} — run the gates in order`);
  else add('lifecycle', 'PASS', `${current} → ${target}`);
}

const forward = current && target && LIFECYCLE.indexOf(target) > LIFECYCLE.indexOf(current);

// 1. Draft → Approved: unfilled template, and whatever §8 still holds.
if (forward && target === 'Approved') {
  const placeholders = [];
  text.split('\n').forEach((line, i) => {
    if (/^\s*<!--/.test(line)) return;
    for (const m of line.matchAll(/<([a-z][a-z0-9 _/-]{2,40})>/gi)) {
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
    const bullets = s8.split('\n').filter((l) => /^\s*[-*]\s+\S/.test(l) && !/^\s*[-*]\s+(none|n\/a|—)\b/i.test(l));
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
        if (hit) found.push(`${t} → ${hit}`);
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
  add('suite-green', 'MANUAL', 'the §6.1 full suite must have run green end to end in this session — if it cannot be run here, refuse the transition');
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
  console.log(JSON.stringify({
    spec: specRel, title: spec.title, current, target,
    ok: failed.length === 0, gates,
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
