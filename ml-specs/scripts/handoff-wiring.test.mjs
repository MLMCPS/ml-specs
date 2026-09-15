// Wiring of /ml-specs:handoff, its template and the SessionStart notice hook — spec 0012.
//
// WHAT THIS FILE ASSERTS, AND WHAT IT DELIBERATELY DOES NOT
//
// Two kinds of assertion, split by what the subject is.
//
// STRUCTURAL, for the Markdown: a file exists, its frontmatter carries a key, a literal token is
// present, a stated count equals what is on disk, a citation lands where it claims. Every one of
// those IS the fact, with no interpretation in between — it catches deletion, reversion and drift,
// and makes NO claim to catch semantic inversion of the prose. The governing header at
// `repo-skills-wiring.test.mjs:10-24` records four adversarial passes that tried to hold
// directional properties of English with regexes, each finding prose that kept every asserted
// keyword while reversing the instruction, and a fourth that produced eight false positives. Spec
// 0012 follows that ruling: its review-only obligations (§4.6 rows 2, 9, 22, 24, 29, and AC20's
// "committing them is the repo's choice" clause) are recorded in the spec, not asserted here.
//
// BEHAVIOURAL, for the hook: `hooks/handoff-notice.sh` is executable bash, so it is RUN — against
// a real `git init`-ed fixture, by absolute path with `cwd` set, exactly as Claude Code runs it.
// Prose rules do not apply to a program that can simply be executed and watched.
//
// NON-VACUITY. `command`, `template` and `hookSource` below are read through `readPlugin`, which is
// deliberately NOT defensive: an absent file throws and every test in this file fails. AC8's "no
// ${CLAUDE_PLUGIN_ROOT}" and AC21's "the loop is untouched" are both trivially true on a branch
// where nothing was built, so each is reached only after those three reads have succeeded. Spec
// 0007 revision 11 is this repo's record of shipping the other kind of assertion — one that stayed
// green with the feature deleted.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, readFileSync, readdirSync, statSync,
  mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync, cpSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)));  // ml-specs/
const ROOT = dirname(PLUGIN);                                     // repo root
const VALIDATOR = join(ROOT, 'scripts', 'validate-plugin.mjs');
const HOOK = join(PLUGIN, 'hooks', 'handoff-notice.sh');

const readPlugin = (rel) => readFileSync(join(PLUGIN, rel), 'utf8');
const readRoot = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * `CLAUDE.md` and `docs/` are a GENERATED knowledge layer. They are committed in THIS repo, but the
 * plugin ships into repos where they are not, and the npm package excludes them — so read them
 * defensively: absent means "not applicable here", not "the assertion failed".
 */
const readGenerated = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null);

// The non-vacuity precondition, executed at module load: all three reads throw if nothing was built.
const command = readPlugin('commands/handoff.md');
const template = readPlugin('templates/handoff/TEMPLATE.md');
const hookSource = readPlugin('hooks/handoff-notice.sh');

const commandFiles = readdirSync(join(PLUGIN, 'commands')).filter((f) => f.endsWith('.md'));

/** Frontmatter keys of a prompt file, as a flat object. */
function frontmatter(text, label) {
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(fm, `${label} has no frontmatter block`);
  return Object.fromEntries(
    fm[1].split('\n').map((l) => l.match(/^([a-z-]+):\s*(.*)$/i)).filter(Boolean).map((m) => [m[1], m[2].trim()]),
  );
}

/** The real validator, over the real tree. */
function runValidator() {
  try {
    return { code: 0, stdout: execFileSync('node', [VALIDATOR], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status ?? 1, stdout: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

// --- the hook fixture --------------------------------------------------------
// There is no git fixture anywhere else in this repo — plugin-wiring.test.mjs:180-225 is the
// tmpdir precedent but creates no repo — so this establishes the pattern. No commit is made: the
// hook's only git call is `git rev-parse --show-toplevel`, which succeeds in an empty repo, so the
// suite needs no git identity.
function withRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sdd-handoff-'));
  try {
    // `-c` is a GIT-level option and must precede the subcommand; `git init -c …` is an unknown
    // switch (spec §6 writes it the other way round).
    execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', dir], { stdio: 'ignore' });
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Write a handoff note into a fixture, returning its absolute path. */
function writeNote(dir, name, body = '# Handoff\n') {
  mkdirSync(join(dir, '.claude', 'handoff'), { recursive: true });
  const abs = join(dir, '.claude', 'handoff', name);
  writeFileSync(abs, body);
  return abs;
}

/**
 * Run the hook the way Claude Code does: the script itself, by absolute path, with `cwd` set —
 * never `bash <path>` (which would make AC8's executable-bit assertion prove nothing) and never a
 * shell string (a path containing a space would silently change what runs).
 *
 * `ML_HANDOFF_MAX_AGE_DAYS` is DELETED from the child environment unless this call sets it, so the
 * "unset" branch cannot pass vacuously because a developer exported it.
 */
function runHook(cwd, { days } = {}) {
  const env = { ...process.env };
  delete env.ML_HANDOFF_MAX_AGE_DAYS;
  if (days !== undefined) env.ML_HANDOFF_MAX_AGE_DAYS = String(days);
  try {
    const stdout = execFileSync(HOOK, [], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('the handoff command is well-formed', () => {
  test('the command carries the frontmatter and body conventions', () => {
    // AC1. CONTRIBUTING.md:63-67 — frontmatter, what the command must NOT do stated up front, and
    // the literal $ARGUMENTS token. Presence, not meaning.
    const fields = frontmatter(command, 'handoff.md');
    assert.ok(fields.description && fields.description.length > 0, 'description is empty');
    assert.ok(fields['argument-hint'] && fields['argument-hint'].length > 0, 'argument-hint is empty');

    // Scoped to the OPENING BLOCK — the first two paragraphs of the body — so moving the
    // prohibition into a footnote fails. Same scoping and keyword alternation as
    // spec-explore-wiring.test.mjs:62-66.
    const body = command.slice(command.indexOf('\n---', 4) + 4);
    const opening = body.trim().split(/\n\s*\n/).slice(0, 2).join('\n');
    assert.match(opening, /do NOT|does NOT|must not|never/i,
      'the command must state up front what it does not do');

    assert.match(command, /\$ARGUMENTS/, 'the label is taken as the literal $ARGUMENTS token');
  });

  test('the no-agent reasoning is recorded in the file', () => {
    // AC2. The reasoning has to survive where the next author reads it, following
    // ml-specs/agents/spec-author.md:8-12. Pinned to the literal substring rather than to its
    // meaning: the phrase cannot be present while the rationale is reversed, which is the only
    // kind of prose assertion this repo's ruling allows (repo-skills-wiring.test.mjs:10-24).
    const comments = [...command.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]);
    assert.ok(comments.length > 0, 'handoff.md carries no HTML comment');
    assert.ok(comments.some((c) => c.includes('cannot see the parent session')),
      'no HTML comment records WHY this command delegates to no agent');
  });

  test('the command derives in-flight state from git, not memory', () => {
    // AC3. All three named individually, so a failure says which one went missing.
    for (const cmd of ['git status --short', 'git log --oneline', 'git rev-parse --abbrev-ref HEAD']) {
      assert.ok(command.includes(cmd), `the command no longer gathers state with \`${cmd}\``);
    }
  });

  test("the command's template reference resolves", () => {
    // AC4. Both halves: the literal reference, the file on disk, and the REAL validator — check 7
    // (validate-plugin.mjs:264-271) resolves every ${CLAUDE_PLUGIN_ROOT}/… a command names, so a
    // typo on either side is an error, not a runtime surprise in someone else's repo.
    assert.ok(command.includes('${CLAUDE_PLUGIN_ROOT}/templates/handoff/TEMPLATE.md'),
      'handoff.md does not reference the handoff template');
    assert.ok(existsSync(join(PLUGIN, 'templates', 'handoff', 'TEMPLATE.md')),
      'ml-specs/templates/handoff/TEMPLATE.md is missing');

    const r = runValidator();
    assert.equal(r.code, 0, `validator failed:\n${r.stdout}`);
    const unresolved = r.stdout.split('\n').filter((l) => /does not exist/.test(l));
    assert.deepEqual(unresolved, [], 'the validator reports an unresolved template reference');
  });

  test('the command pins the note path, slug and collision rule', () => {
    // AC5. Each clause is a separate token, so a failure names the clause that went missing rather
    // than reporting "the command changed".
    assert.ok(command.includes('.claude/handoff/<YYYY-MM-DD-HHMMSS>-<slug>.md'),
      'the note path form is no longer pinned');
    assert.ok(command.includes('git toplevel'),
      'the command must resolve the note against the git toplevel, not $PWD');
    assert.ok(command.includes('kebab-case'), 'the slug derivation is no longer stated');

    // Scoped to the collision clause itself: a file-global match for "never" is satisfied by the
    // prohibitions in the opening block, which are a different claim.
    const collision = command.split('\n').find((l) => /\bCollision\b/.test(l));
    assert.ok(collision, 'the command states no collision rule');
    assert.match(collision, /\bnever\b/i,
      'the collision rule must say a note is NEVER replaced (docs/PATTERNS.md:100)');

    // The suffix itself, which spec 0012 revision 7 exists for. `-2` sorts BEFORE the plain name
    // (`-` is 0x2D, `.` is 0x2E), so the hook's `sort | tail -1` would announce the OLDER note;
    // `_2` sorts after. AC13b proves the hook's half of this — this is the prose's half, and
    // without it the rule can revert in the command while every behavioural test stays green.
    assert.match(collision, /`_2`/,
      'the collision suffix must be `_2` — `-2` sorts before the plain name and inverts the hook');
  });

  test('the command names the next command in the literal bolded form', () => {
    // AC7. docs/PATTERNS.md:67 — a command ends by naming the next one. Asserted on the
    // bold-around-a-code-span form (spec-explore.md:67), not a bare token: spec 0007 revision 11
    // records a bare-token assertion staying green with the closing step deleted.
    assert.match(command, /\*\*`\/ml-specs:repo-status`\*\*/,
      'the command must NAME /ml-specs:repo-status as what comes next, not merely mention it');
  });

  test('notes are namespaced by default', () => {
    // AC7b, LITERAL ONLY. This test used to append a real-tree validator run and call it "a real
    // check rather than a prose match"; that claim was FALSE and /ml-specs:spec-verify said so —
    // the tree holds no handoff note, so the run exercises nothing about notes and stays green
    // with the template's marker deleted. The backstop is proven by AC7c below, which builds the
    // note the validator would have to see. What is left here is exactly what it can hold:
    // presence of the namespaced form, and of the word that names the rule.
    assert.ok(command.includes('/ml-specs:'), 'the command names no namespaced command form');
    assert.match(command, /namespaced/, 'the command must state that references are namespaced');
  });

  test('the allow-bare-commands backstop actually holds', () => {
    // AC7c. The real validator, run TWICE over a tree that actually contains a handoff note whose
    // body carries a bare `/spec-build` — the thing a human types into their own notes. Both
    // halves are required: "exits 0 with the marker" proves nothing unless "fails without it"
    // shows the validator would otherwise have errored.
    //
    // The tree is a COPY of this repo (minus .git/ and node_modules/) in a tmpdir, so the note is
    // never written into the working tree: validate-plugin.mjs resolves its root from its own
    // location, other test files run it concurrently against the real tree, and a throwaway note
    // sitting there for the length of this test would redden them at random.
    //
    // The "marker present" body is the SHIPPED TEMPLATE verbatim: delete
    // `<!-- allow-bare-commands -->` from ml-specs/templates/handoff/TEMPLATE.md and this half
    // goes red, which is what ties the backstop to the file that carries it.
    const dir = mkdtempSync(join(tmpdir(), 'sdd-handoff-validator-'));
    try {
      cpSync(ROOT, dir, {
        recursive: true,
        filter: (src) => !/(^|[\\/])(\.git|node_modules)$/.test(src),
      });
      const validator = join(dir, 'scripts', 'validate-plugin.mjs');
      const runIn = () => {
        try {
          return { code: 0, stdout: execFileSync('node', [validator], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
        } catch (e) {
          return { code: e.status ?? 1, stdout: `${e.stdout ?? ''}${e.stderr ?? ''}` };
        }
      };

      // The copy must be clean on its own, or neither half below means anything.
      const baseline = runIn();
      assert.equal(baseline.code, 0, `the copied tree does not validate before the note is added:\n${baseline.stdout}`);

      const rel = join('.claude', 'handoff', '2026-09-16-093000-backstop.md');
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      const trailer = '\nNext: run /spec-build, then /spec-verify.\n';

      // Without the marker: the validator MUST see the bare command and fail.
      const withoutMarker = template.split('\n').filter((l) => !l.includes('<!-- allow-bare-commands -->')).join('\n');
      assert.ok(!withoutMarker.includes('<!-- allow-bare-commands -->'), 'the marker was not removed from the fixture body');
      writeFileSync(abs, withoutMarker + trailer);
      const bare = runIn();
      assert.notEqual(bare.code, 0, `the validator accepted a bare /spec-build in a handoff note:\n${bare.stdout}`);
      assert.match(bare.stdout, /2026-09-16-093000-backstop\.md: line \d+: bare `\/spec-build`/,
        `the validator failed, but not for the bare command in the note:\n${bare.stdout}`);

      // With the marker — the template's own first line — the same tree is clean again.
      writeFileSync(abs, template + trailer);
      const marked = runIn();
      assert.equal(marked.code, 0,
        `the template's <!-- allow-bare-commands --> marker does not exempt a handoff note:\n${marked.stdout}`);
      assert.doesNotMatch(marked.stdout, /backstop\.md/, `the note is still reported:\n${marked.stdout}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the handoff template', () => {
  test('the template carries its header rows, five headings and the bare-command marker', () => {
    // AC6. The marker is the backstop of §4.2: the command writes namespaced forms, and this makes
    // a human typing `/spec-build` into their own note unable to redden anyone's build.
    for (const row of ['**Date**', '**Branch**', '**Spec**']) {
      assert.ok(template.includes(row), `the header table omits the ${row} row`);
    }
    for (const heading of ['## 1. Where this got to', '## 2. In flight', '## 3. Decided — and rejected',
      '## 4. Next step', '## 5. Landmines']) {
      assert.ok(template.includes(heading), `the template omits "${heading}"`);
    }
    assert.ok(template.includes('<!-- allow-bare-commands -->'),
      'the template must carry the file-scoped escape hatch (validate-plugin.mjs:440-441)');
  });
});

describe('the SessionStart notice hook', () => {
  test('the hook is executable, fails open, and carries no plugin-root token', () => {
    // AC8. A non-executable hook fails SILENTLY, which is why validate-plugin.mjs:300-301 errors on
    // one; asserted here directly too, since every behavioural test below runs the file itself.
    const abs = join(PLUGIN, 'hooks', 'handoff-notice.sh');
    assert.ok(existsSync(abs), 'ml-specs/hooks/handoff-notice.sh is missing');
    assert.ok(statSync(abs).mode & 0o111, 'the hook is not executable — chmod +x it');
    assert.ok(hookSource.startsWith('#!/usr/bin/env bash\n'), 'the hook has no bash shebang');
    assert.ok(hookSource.includes('set -uo pipefail'), 'the hook does not set -uo pipefail');

    // Fail open: exit 2 is reserved for secret-scan.sh (CONTRIBUTING.md:137-138), and a
    // session-start hook must never be the reason a session starts badly.
    const codes = [...hookSource.matchAll(/\bexit\s+(\d+)/g)].map((m) => m[1]);
    assert.ok(codes.length > 0, 'the hook contains no exit statement');
    assert.deepEqual([...new Set(codes)], ['0'], `the hook can exit non-zero: ${codes.join(', ')}`);

    // §4.6 row 10's arithmetic counts FILES containing the token; only hooks.json does, and the
    // documented "1 hook" figure depends on this file not carrying it.
    assert.ok(!hookSource.includes('CLAUDE_PLUGIN_ROOT'),
      'the hook must not carry ${CLAUDE_PLUGIN_ROOT}; the documented usage counts assume it does not');
  });

  test('hook: silent outside a git repo', () => {
    // AC9. The tmpdir must be PROVABLY outside any git repo first — a CI TMPDIR pointing inside a
    // working tree would make this pass for the wrong reason.
    const dir = mkdtempSync(join(tmpdir(), 'sdd-handoff-nogit-'));
    try {
      let insideRepo = true;
      try {
        execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, stdio: 'ignore' });
      } catch {
        insideRepo = false;
      }
      assert.equal(insideRepo, false, `${dir} is inside a git repo — this case would pass vacuously`);

      const r = runHook(dir);
      assert.equal(r.code, 0, 'the hook must fail open outside a git repo');
      assert.equal(r.stdout, '', `the hook spoke outside a git repo: ${r.stdout}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('hook: silent with no handoff directory', () => {
    // AC10. The default state of this hook is saying nothing (CONTRIBUTING.md:133-134).
    withRepo((dir) => {
      const r = runHook(dir);
      assert.equal(r.code, 0);
      assert.equal(r.stdout, '', `the hook spoke with no .claude/handoff/: ${r.stdout}`);
    });
  });

  test('hook: one line, with its imperative, for a fresh handoff', () => {
    // AC11. One line, naming the file, and telling the reader what to DO with it — the shape
    // knowledge-drift.sh:42 uses. A line that names the file but not what it is for is what
    // pinning the wording (§4.4 step 3) exists to prevent.
    withRepo((dir) => {
      const name = '2026-09-16-093000-resume-the-parser.md';
      writeNote(dir, name);
      const r = runHook(dir);
      assert.equal(r.code, 0);

      const lines = r.stdout.trim().split('\n').filter(Boolean);
      assert.equal(lines.length, 1, `expected exactly one line, got:\n${r.stdout}`);
      assert.ok(lines[0].includes(name), `the line does not name the note: ${lines[0]}`);
      assert.match(lines[0], /\bread it\b/i, 'the line must tell the reader to read the note');
      assert.match(lines[0], /\bdelete\b/i, 'the line must offer deleting it when that work is done');

      // The date is CAPTURED from its own clause and compared to the note's prefix. Asserting the
      // line merely "contains" the date is a TAUTOLOGY — the filename is already in the line and
      // already carries it, so the hook's `when="${base:0:10}"` can be mutated to a constant and
      // such an assertion stays green. /ml-specs:spec-verify found exactly that vacuity here.
      const stated = lines[0].match(/from (\S+) is waiting/);
      assert.ok(stated, `the line does not state the note's date in the pinned wording: ${lines[0]}`);
      assert.equal(stated[1], name.slice(0, 10),
        `the hook printed ${stated[1]}, which is not the note's own YYYY-MM-DD prefix`);
    });
  });

  test('hook: still speaks from a subdirectory', () => {
    // AC11b. THE ONLY TEST THAT CATCHES A MISSING `cd` TO THE GIT TOPLEVEL. Step 2's find takes a
    // RELATIVE path, so a hook that skips §4.4 step 1's cd goes silent for every session started
    // in a subdirectory — the common case in a monorepo — and every other case here runs from the
    // fixture root, which IS the toplevel and cannot discriminate.
    withRepo((dir) => {
      writeNote(dir, '2026-09-16-093000-resume-the-parser.md');
      mkdirSync(join(dir, 'sub'));
      const r = runHook(join(dir, 'sub'));
      assert.equal(r.code, 0);
      const lines = r.stdout.trim().split('\n').filter(Boolean);
      assert.equal(lines.length, 1,
        `the hook went silent in a subdirectory — it is not resolving the git toplevel:\n${r.stdout}`);
      assert.ok(lines[0].includes('2026-09-16-093000-resume-the-parser.md'));
    });
  });

  test('hook: an old handoff is silent unless the age is raised', () => {
    // AC12. BOTH halves are required: asserting only the silent branch passes with the hook's
    // output statement deleted entirely. The note is aged with utimesSync, which is why the age
    // check measures mtime — a filename-date scheme would need non-portable `date` arithmetic
    // inside a script whose first duty is to fail open (§4.4).
    withRepo((dir) => {
      const note = writeNote(dir, '2026-08-17-120000-stale-work.md');
      const t = Date.now() / 1000 - 30 * 86400;
      utimesSync(note, t, t);

      const unset = runHook(dir);                 // ML_HANDOFF_MAX_AGE_DAYS deleted from the child env
      assert.equal(unset.code, 0);
      assert.equal(unset.stdout, '', `a 30-day-old note was surfaced at the default window:\n${unset.stdout}`);

      const raised = runHook(dir, { days: 60 });
      assert.equal(raised.code, 0);
      const lines = raised.stdout.trim().split('\n').filter(Boolean);
      assert.equal(lines.length, 1, `expected one line at ML_HANDOFF_MAX_AGE_DAYS=60, got:\n${raised.stdout}`);
      assert.ok(lines[0].includes('2026-08-17-120000-stale-work.md'),
        `the line does not name the note: ${lines[0]}`);
    });
  });

  test('hook: names the newest of several', () => {
    // AC13. Written in REVERSE lexical order, so the newest mtime is the lexically FIRST note: a
    // hook that picked by mtime instead of by the sortable name would name the wrong one.
    withRepo((dir) => {
      writeNote(dir, '2026-09-16-180000-latest.md');
      writeNote(dir, '2026-09-14-090000-middle.md');
      writeNote(dir, '2026-09-10-080000-oldest.md');

      const r = runHook(dir);
      assert.equal(r.code, 0);
      const lines = r.stdout.trim().split('\n').filter(Boolean);
      assert.equal(lines.length, 1, `expected one line, got:\n${r.stdout}`);
      assert.ok(lines[0].includes('2026-09-16-180000-latest.md'),
        `the hook named the wrong note: ${lines[0]}`);
    });
  });

  test('hook: names the suffixed note on a same-second collision', () => {
    // AC13b. THE CASE THAT WAS MISSING, and the defect it hid: every other fixture here uses
    // distinct timestamp prefixes, so nothing exercised the collision path at all. The command's
    // original rule appended `-2`, and `-` (0x2D) sorts BEFORE `.` (0x2E) — so `…-work-2.md` <
    // `…-work.md` and `sort | tail -1` announced the note written FIRST. The suffix is `_2`
    // (0x5F, after `.`) for exactly this reason, and this test is what holds it.
    //
    // Both notes share one second, which is the only way the suffix is ever reached in practice;
    // the plain note is written first and the suffixed one second, as the command would write it.
    withRepo((dir) => {
      writeNote(dir, '2026-09-16-093000-work.md');
      writeNote(dir, '2026-09-16-093000-work_2.md');

      const r = runHook(dir);
      assert.equal(r.code, 0);
      const lines = r.stdout.trim().split('\n').filter(Boolean);
      assert.equal(lines.length, 1, `expected one line, got:\n${r.stdout}`);
      assert.ok(lines[0].includes('2026-09-16-093000-work_2.md'),
        `the hook named the note written FIRST — the collision suffix does not sort after the plain name: ${lines[0]}`);
    });
  });

  test('hooks.json registers the new SessionStart hook as a second array element', () => {
    // AC14. A second ELEMENT in the existing group, not a second group — so the manifest grows by
    // one line and hooks.md's citation shifts by one, not four (§4.4). Plus the real validator,
    // which checks the script exists and is executable (validate-plugin.mjs:299-301).
    const manifest = JSON.parse(readPlugin('hooks/hooks.json'));
    const groups = manifest.hooks.SessionStart;
    assert.equal(groups.length, 1, 'SessionStart must stay ONE group with two hooks in it');
    assert.equal(groups[0].hooks.length, 2, 'the SessionStart group does not hold two hooks');
    assert.equal(groups[0].hooks[1].type, 'command');
    assert.equal(groups[0].hooks[1].command, '${CLAUDE_PLUGIN_ROOT}/hooks/handoff-notice.sh',
      'the second SessionStart hook is not the handoff notice, in the only permitted path form');

    const r = runValidator();
    assert.equal(r.code, 0, `validator failed:\n${r.stdout}`);
  });

  test('knowledge-drift.sh names commands that exist, at an unchanged line count', () => {
    // AC15. The sibling hook told every adopting repo to run two commands that have not existed
    // since the /ml-specs: namespacing. Fixed here under the "adjacent to the file being edited"
    // precedent (specs/0009:99).
    const drift = readPlugin('hooks/knowledge-drift.sh');
    for (const stale of ['sdd-toolkit', '/sdd-doctor', '/sdd-refresh']) {
      assert.ok(!drift.includes(stale),
        `knowledge-drift.sh still says ${stale} — including the header comment`);
    }
    assert.ok(drift.includes('/ml-specs:repo-doctor'), 'knowledge-drift.sh must name /ml-specs:repo-doctor');
    assert.ok(drift.includes('/ml-specs:repo-refresh'), 'knowledge-drift.sh must name /ml-specs:repo-refresh');

    // SDD_DRIFT_THRESHOLD is deliberately NOT renamed (§4.4): it is documented at
    // ml-specs/README.md:225 and may already be set in an adopting repo's environment.
    assert.ok(drift.includes('SDD_DRIFT_THRESHOLD'),
      'SDD_DRIFT_THRESHOLD must not be renamed — that is a breaking change with its own migration');

    // EXACTLY 43 lines. docs/ARCHITECTURE.md:37, docs/architecture/prompt-surface.md:11 and
    // docs/architecture/hooks.md:7 all cite knowledge-drift.sh:27, and knowledge-check.mjs:119-123
    // errors only when a cited line EXCEEDS the file length — so a shift rots all three silently
    // while CI stays green.
    const lines = drift.split('\n');
    if (lines.at(-1) === '') lines.pop();
    assert.equal(lines.length, 43, 'knowledge-drift.sh changed length; three docs cite :27');
  });
});

describe('the surfaces the gates do not watch', () => {
  test('the ungated command-count sites were updated too', (t) => {
    // AC17. Five of the six command-count sites are gated by repo-skills-wiring.test.mjs:217-235
    // and :261-271; ml-specs/mcp/README.md:55 and README.md's tree comment are not, and are what
    // this criterion exists for — the mcp README was missed once already, by spec 0007.
    //
    // Derived from disk, never from the digit typed here: a count asserted against a literal goes
    // stale the next time a command lands; one asserted against reality cannot.
    const n = commandFiles.length;

    const mcpReadme = readPlugin('mcp/README.md');
    const claimed = mcpReadme.match(/all (\d+) of them/);
    assert.ok(claimed, 'ml-specs/mcp/README.md no longer states the served-prompt count');
    assert.equal(Number(claimed[1]), n, `ml-specs/mcp/README.md claims ${claimed[1]} commands, not ${n}`);

    const mcpPrompts = readPlugin('README.md').match(/all (\d+) commands as MCP prompts/);
    assert.ok(mcpPrompts, 'ml-specs/README.md no longer states the MCP-prompt count');
    assert.equal(Number(mcpPrompts[1]), n, `ml-specs/README.md claims ${mcpPrompts[1]} commands, not ${n}`);

    // Scoped to the COMMANDS half of the tree: a file-global grep is satisfied by the marketplace
    // table row at README.md:15, which is a different site with its own review obligation.
    const rootReadme = readRoot('README.md');
    const tree = rootReadme.slice(rootReadme.indexOf('├── commands/'), rootReadme.indexOf('├── skills/'));
    assert.ok(tree.length > 0, "README.md's commands tree comment could not be located");
    assert.match(tree, /(^|[^\w-])handoff(?![\w-])/, "README.md's commands tree comment omits handoff");

    const skipped = [];
    for (const rel of ['CLAUDE.md', 'docs/ARCHITECTURE.md', 'docs/architecture/prompt-surface.md']) {
      const text = readGenerated(rel);
      if (!text) { skipped.push(rel); continue; }
      const m = text.match(/(\d+) commands, \d+ skill/);
      assert.ok(m, `${rel} states no roster command count`);
      assert.equal(Number(m[1]), n, `${rel} claims ${m[1]} commands, not ${n}`);
    }
    const surface = readGenerated('docs/architecture/prompt-surface.md');
    if (surface) {
      const heading = surface.match(/## Commands \(`ml-specs\/commands\/`, (\d+) files\)/);
      assert.ok(heading, 'prompt-surface.md has no "## Commands (…, N files)" heading');
      assert.equal(Number(heading[1]), n, `the Commands heading claims ${heading[1]} files, not ${n}`);
    }
    if (skipped.length) t.diagnostic(`skipped (absent generated layer): ${skipped.join(', ')}`);
  });

  test('the templates shard counts tracked files and maps the new template', (t) => {
    // AC19. Counted as TRACKED files, not readdirSync: macOS leaves a .DS_Store under
    // ml-specs/templates/, so the on-disk count is 19 while the shipped set is 18.
    const shard = readGenerated('docs/architecture/templates.md');
    if (!shard) return t.diagnostic('docs/architecture/templates.md absent (generated layer) — skipped');

    const tracked = execFileSync('git', ['ls-files', 'ml-specs/templates'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n').filter(Boolean).length;
    const claimed = shard.match(/(\d+) files under `ml-specs\/templates\/`/);
    assert.ok(claimed, 'templates.md no longer states the template count');
    assert.equal(Number(claimed[1]), tracked,
      `templates.md claims ${claimed[1]} templates, git ls-files reports ${tracked}`);

    // The mapping table is headed "the command that writes it" (:19-20), so the row must name the
    // command — and this template is read and filled in place rather than copied.
    const table = shard.slice(shard.indexOf('| Template | Written by |'), shard.indexOf('## Conventions'));
    assert.ok(table.length > 0, 'the template mapping table could not be located');
    assert.match(table, /\| `handoff\/TEMPLATE\.md` \| `ml-specs\/commands\/handoff\.md:\d+`/,
      'the mapping table has no handoff/TEMPLATE.md row citing the command that writes it');
  });

  test('repo-init and the CLAUDE fragment document the convention, and both adopting commands name three hooks', () => {
    // AC20. The directional half — "committing them is the repo's choice" — is a REVIEW-only
    // obligation (§4.6), for the reason recorded at repo-skills-wiring.test.mjs:10-24.
    const repoInit = readPlugin('commands/repo-init.md');
    const fragment = readPlugin('templates/CLAUDE.fragment.md');
    for (const [label, text] of [['repo-init.md', repoInit], ['CLAUDE.fragment.md', fragment]]) {
      assert.ok(text.includes('.claude/handoff/'), `${label} does not name the handoff directory`);
      assert.ok(text.includes('/ml-specs:handoff'), `${label} does not name the command that writes it`);
    }

    // The step is APPENDED LAST — after the final numbered step and before the REPORT heading —
    // so none of the eleven repo-init.md:NN citations in docs/architecture/templates.md:22-33 or
    // the two in docs/PATTERNS.md shift. Asserted structurally: the last numbered step before the
    // Phase 4 heading must BE the handoff step.
    const lines = repoInit.split('\n');
    const phase4 = lines.findIndex((l) => /^## Phase 4/.test(l));
    assert.ok(phase4 > 0, 'repo-init.md has no "## Phase 4" heading');
    const stepStarts = lines.map((l, i) => (/^\d+\.\s/.test(l) ? i : -1)).filter((i) => i >= 0 && i < phase4);
    assert.ok(stepStarts.length > 0, 'repo-init.md has no numbered steps before Phase 4');
    const lastStep = lines.slice(stepStarts.at(-1), phase4).join('\n');
    assert.ok(lastStep.includes('.claude/handoff/'),
      'the handoff step is not the LAST numbered step before the REPORT phase — inserting it earlier shifts every repo-init.md:NN citation');

    // And the citations themselves still land where they claim: every repo-init line cited by the
    // templates shard must still be a ${CLAUDE_PLUGIN_ROOT}/templates/… line. knowledge-check.mjs
    // only bounds-checks, so nothing else catches a citation that merely moved.
    const shard = readGenerated('docs/architecture/templates.md');
    if (shard) {
      const cited = [...shard.matchAll(/ml-specs\/commands\/repo-init\.md:(\d+)/g)].map((m) => Number(m[1]));
      assert.ok(cited.length >= 11, `expected the eleven repo-init citations, found ${cited.length}`);
      for (const n of cited) {
        assert.match(lines[n - 1] ?? '', /\$\{CLAUDE_PLUGIN_ROOT\}\/templates\//,
          `docs/architecture/templates.md cites repo-init.md:${n}, which is now: ${lines[n - 1]}`);
      }
    }

    // Both commands that tell an adopting repo which hooks ship must name THREE.
    for (const [rel, text] of [['commands/repo-init.md', repoInit], ['commands/repo-adopt.md', readPlugin('commands/repo-adopt.md')]]) {
      const roster = text.match(/plugin's own hooks \(([^)]*)\)/s);
      assert.ok(roster, `${rel} no longer enumerates the plugin's own hooks`);
      for (const hook of [/drift/i, /handoff/i, /secret/i]) {
        assert.match(roster[1], hook, `${rel}'s hook roster omits ${hook} — it names ${roster[1]}`);
      }
    }
  });

  test('both hook rosters name the handoff notice', () => {
    // AC23. README.md's tree comment and ml-specs/README.md's Hooks bullet list — both COMMITTED,
    // both shipped (the second reaches npm and the public mirror), and neither gated.
    const rootReadme = readRoot('README.md');
    const hooksLine = rootReadme.split('\n').find((l) => l.includes('├── hooks/'));
    assert.ok(hooksLine, "README.md's hooks tree line could not be located");
    assert.match(hooksLine, /handoff/, `README.md's hooks line omits the handoff notice: ${hooksLine}`);

    const readme = readPlugin('README.md');
    const bullets = readme.slice(readme.indexOf('**Hooks** (`hooks/`)'), readme.indexOf('**CI gate**'));
    assert.ok(bullets.length > 0, "ml-specs/README.md's Hooks bullet list could not be located");
    assert.match(bullets, /handoff/i, "the Hooks bullet list does not name the handoff notice hook");
    assert.match(bullets, /`SessionStart`/, 'the new bullet must name the event, like the other two');
    assert.ok(bullets.includes('ML_HANDOFF_MAX_AGE_DAYS'),
      'the Hooks bullet list does not name the ML_HANDOFF_MAX_AGE_DAYS tunable');
  });

  test('the hooks shard and the router count what ships', (t) => {
    // AC22. Three ungated sites, all of which go quietly wrong on install if missed.
    const shard = readGenerated('docs/architecture/hooks.md');
    const arch = readGenerated('docs/ARCHITECTURE.md');
    const skipped = [];
    if (shard) {
      assert.match(shard, /^> Shard of .*\. Four files\./m,
        'docs/architecture/hooks.md still says three files ship');
      const table = shard.slice(shard.indexOf('| Hook | Event | File |'), shard.indexOf('Manifest:'));
      const rows = table.split('\n').filter((l) => /^\| .* \| .* \| `ml-specs\/hooks\//.test(l));
      assert.equal(rows.length, 3, `the registered-hooks table has ${rows.length} rows, expected 3`);
      assert.ok(rows.some((r) => r.includes('`ml-specs/hooks/handoff-notice.sh`') && r.includes('SessionStart')),
        'the registered-hooks table has no SessionStart row for handoff-notice.sh');
    } else skipped.push('docs/architecture/hooks.md');

    if (arch) {
      const scripts = arch.match(/(\d+) hook scripts/);
      assert.ok(scripts, 'docs/ARCHITECTURE.md no longer counts the hook scripts');
      assert.equal(Number(scripts[1]),
        readdirSync(join(PLUGIN, 'hooks')).filter((f) => f.endsWith('.sh')).length,
        `docs/ARCHITECTURE.md claims ${scripts[1]} hook scripts`);

      const row = arch.split('\n').find((l) => l.startsWith('| Hooks |'));
      assert.ok(row, "docs/ARCHITECTURE.md's router has no Hooks row");
      for (const hook of [/drift/i, /handoff/i, /secret/i]) {
        assert.match(row, hook, `the router's Hooks row omits ${hook}: ${row}`);
      }
    } else skipped.push('docs/ARCHITECTURE.md');
    if (skipped.length) t.diagnostic(`skipped (absent generated layer): ${skipped.join(', ')}`);
  });

  test("the hooks.md manifest range ends at the final hook group's closing brace", (t) => {
    // AC22b. THE ONE RIPPLE ROW THAT ROTS SILENTLY: knowledge-check.mjs:119-123 errors only when a
    // cited line EXCEEDS the file length, so a range that is merely too short is invisible to CI.
    //
    // Located STRUCTURALLY, never by `wc -l`: B is the line number of the LAST line matching
    // /^ {6}\}$/ — the closing brace of the final hook-group object, which is the end of the
    // manifest body. (`hooks.hooks` closes with `}`, not `]`; the anchor is the hook group, not the
    // event array.) That is 21 today while `wc -l` is 24 — the two differ by three, and only this
    // one describes what the citation is about.
    //
    // Anchored on the literal `Manifest:` line, NOT on a line number: the new table row shifts it.
    const shard = readGenerated('docs/architecture/hooks.md');
    if (!shard) return t.diagnostic('docs/architecture/hooks.md absent (generated layer) — skipped');

    const manifestLine = shard.split('\n').find((l) => l.startsWith('Manifest:'));
    assert.ok(manifestLine, 'docs/architecture/hooks.md has no Manifest: line');
    const cited = manifestLine.match(/ml-specs\/hooks\/hooks\.json:(\d+)-(\d+)/);
    assert.ok(cited, `the Manifest line cites no hooks.json range: ${manifestLine}`);

    const hooksJson = readPlugin('hooks/hooks.json').split('\n');
    const closers = hooksJson.map((l, i) => (/^ {6}\}$/.test(l) ? i + 1 : -1)).filter((i) => i > 0);
    assert.ok(closers.length > 0, 'hooks.json has no hook-group closing brace at six spaces of indent');
    assert.equal(Number(cited[2]), closers.at(-1),
      `hooks.md cites hooks.json:${cited[1]}-${cited[2]}, but the manifest body ends at line ${closers.at(-1)}`);

    // NOT AN ACCEPTANCE CRITERION — an omission found while building. docs/PATTERNS.md cites the
    // ${CLAUDE_PLUGIN_ROOT} lines of hooks.json by number, and the new element pushed secret-scan
    // down one. Same silent-rot class as the row above, and the spec's ripple table missed it.
    const patterns = readGenerated('docs/PATTERNS.md');
    if (!patterns) return;
    const usage = patterns.match(/ml-specs\/hooks\/hooks\.json:([\d,]+)/);
    assert.ok(usage, 'docs/PATTERNS.md no longer cites hooks.json as a ${CLAUDE_PLUGIN_ROOT} example');
    for (const n of usage[1].split(',').map(Number)) {
      assert.match(hooksJson[n - 1] ?? '', /\$\{CLAUDE_PLUGIN_ROOT\}/,
        `docs/PATTERNS.md cites hooks.json:${n} as a \${CLAUDE_PLUGIN_ROOT} use; that line is: ${hooksJson[n - 1]}`);
    }
  });
});

describe('the loop is untouched', () => {
  test('/ml-specs:handoff is in no loop chain and no loop roster', (t) => {
    // AC21. /ml-specs:handoff is deliberately OUTSIDE the SDD loop, like /ml-specs:code,
    // /ml-specs:fix and /ml-specs:explain. Adding it to a chain would teach a non-loop command as a
    // loop step — and it is not a loop step because it changes nothing at all.
    //
    // The COUNT is what makes this non-vacuous: an absence assertion alone passes on a branch where
    // nothing was built, which is why `command` is read non-defensively at module load and the ten
    // chain heads are COUNTED here rather than only checked for absence.
    assert.ok(command.length > 0, 'commands/handoff.md is empty — nothing to keep out of the loop');

    const HEAD = /`?\/ml-specs:spec-explore`?\s+\(optional\)\s*→/;
    const chains = [
      ['CLAUDE.md', 1],                                  // generated, skipped when absent
      ['ml-specs/templates/CLAUDE.fragment.md', 1],
      ['ml-specs/README.md', 2],                         // the roster head and the closing chain
      ['CONTRIBUTING.md', 1],
      ['TEAM-SETUP.md', 1],
      ['.github/mirror-README.md', 1],
      ['ml-specs/commands/repo-init.md', 1],
      ['examples/promo-service/CLAUDE.md', 1],
      ['ml-specs/mcp/README.md', 1],
    ];
    const skipped = [];
    let total = 0;
    for (const [rel, expected] of chains) {
      const text = rel === 'CLAUDE.md' ? readGenerated(rel) : readRoot(rel);
      if (!text) { skipped.push(rel); continue; }
      const heads = text.split('\n').filter((l) => HEAD.test(l));
      assert.equal(heads.length, expected,
        `${rel}: expected ${expected} chain head(s) reading "/ml-specs:spec-explore (optional) →", found ${heads.length}`);
      for (const line of heads) {
        assert.ok(!line.includes('/ml-specs:handoff'),
          `${rel}: a loop chain names /ml-specs:handoff, which is not a loop step:\n  ${line.trim()}`);
      }
      total += heads.length;
    }
    // Ten chains when the generated knowledge layer is present, nine on a clean clone — the rule at
    // spec-explore-wiring.test.mjs:283.
    assert.equal(total, skipped.length ? 9 : 10, `chain count is ${total}; skipped: ${skipped.join(', ')}`);
    if (skipped.length) t.diagnostic(`skipped (absent): ${skipped.join(', ')}`);

    // The loop-team tables map the SDD phases. This command brings no agent and is no phase.
    for (const rel of ['specs/AGENTS.md', 'ml-specs/templates/specs/AGENTS.md']) {
      assert.ok(!readRoot(rel).includes('/ml-specs:handoff'),
        `${rel} names /ml-specs:handoff; it is not a loop step`);
    }
  });
});
