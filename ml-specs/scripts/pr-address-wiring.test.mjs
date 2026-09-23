// Wiring of /ml-specs:pr-address, its CLI and the knowledge layer around them — spec 0014.
//
// WHAT THIS FILE ASSERTS, AND WHAT IT DELIBERATELY DOES NOT
//
// Structural facts only: a file exists, its frontmatter carries a key, a literal token is present,
// a machine-readable marker names both routing destinations, a roster lists the command, a stated
// count equals what is on disk, the real validator exits 0. Every assertion here IS the fact, with
// no interpretation in between — it catches deletion, reversion and drift.
//
// It makes NO claim to catch semantic inversion of the prompt prose. That the command actually
// instructs the step-4 human review, actually refuses a contract-changing comment, and actually
// forbids AI attribution cannot be held by a regex: the standing ruling at
// `repo-skills-wiring.test.mjs:10-24` records four adversarial passes that failed, because "do
// **not** stop and show the human" keeps every asserted keyword while reversing the instruction.
// Spec 0011 made the same call (`explain-wiring.test.mjs:14-16`). Those are review obligations,
// recorded in spec 0014 §5. The ENFORCEABLE half of the gate is not prose at all — it lives in
// `lib/scm.mjs` as `governedReply()` and is asserted by `lib/scm.test.mjs` AC17-AC20.
//
// AC32 is the exception the ruling itself prescribes: rather than parsing a sentence, the command
// file carries an explicit machine-readable marker and this reads that. A file-global check for the
// two command names would be vacuous — `/ml-specs:spec` appears elsewhere in the file, so deleting
// the refusal bullet would leave it green. That is the spec 0007 revision 11 shape.
//
// NON-VACUITY. `command` is read through `readPlugin`, which is deliberately NOT defensive: on a
// branch where nothing was built the read throws and every test in this file fails, rather than
// the absence assertions (AC31's "no absolute path") passing trivially. `CLAUDE.md` and `docs/` are
// a GENERATED layer — absent from a clean clone and from the npm package — so they are read
// defensively, matching `explain-wiring.test.mjs:40-45`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)));  // ml-specs/
const ROOT = dirname(PLUGIN);                                     // repo root
const VALIDATOR = join(ROOT, 'scripts', 'validate-plugin.mjs');
const SPEC_FILE = 'specs/0014-pr-address-review-feedback.md';

const readPlugin = (rel) => readFileSync(join(PLUGIN, rel), 'utf8');
const readRoot = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const readGenerated = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null);

// The non-vacuity precondition, executed at module load: both throw if the feature is absent.
const command = readPlugin('commands/pr-address.md');
const cli = readPlugin('scripts/pr-address.mjs');

/** Frontmatter keys of a prompt file, as a flat object. */
function frontmatter(text, label) {
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(fm, `${label} has no frontmatter block`);
  return Object.fromEntries(
    fm[1].split('\n').map((l) => l.match(/^([a-z-]+):\s*(.*)$/i)).filter(Boolean).map((m) => [m[1], m[2].trim()]),
  );
}

/**
 * The numbered steps of the command, in FILE ORDER, as { n, title, body }.
 *
 * AC39 is about ORDER, so it is derived from the step numbers rather than from
 * two greps for two strings: "the gate is mentioned and coder is mentioned"
 * passes in either order, which is the arrangement the security review rejected.
 */
function steps(text) {
  const heads = [...text.matchAll(/^## (\d+)\. (.+)$/gm)];
  assert.ok(heads.length > 0, 'pr-address.md has no numbered steps');
  return heads.map((h, i) => ({
    n: Number(h[1]),
    title: h[2].trim(),
    body: text.slice(h.index, i + 1 < heads.length ? heads[i + 1].index : text.length),
  }));
}

const mjs = (dir) => readdirSync(join(PLUGIN, dir)).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'));

describe('the command file is well-formed', () => {
  test('AC29 — frontmatter carries a description and an argument-hint, and the body takes $ARGUMENTS', () => {
    const fields = frontmatter(command, 'pr-address.md');
    assert.ok(fields.description && fields.description.length > 0, 'description is empty');
    assert.ok(fields['argument-hint'] && fields['argument-hint'].length > 0, 'argument-hint is empty');
    assert.match(command, /\$ARGUMENTS/, "the user's input is passed as the literal $ARGUMENTS token");
  });

  test('AC30 — the literal **coder** is present, which two separate consumers require', () => {
    // ONE string, TWO consumers. scripts/validate-plugin.mjs:227-228 accepts an imperative verb
    // plus the BOLDED name as an invocation — a backticked mention is a description, and an agent
    // no command invokes is a check-6 hard error. agentAppendix() (mcp/ml-specs-server.mjs:575)
    // inlines the agent's instructions only when `body.includes('**coder**')`. Written "use the
    // coder agent", every non-Claude-Code MCP client receives that sentence with NO instructions
    // attached: a silent no-op.
    assert.ok(command.includes('**coder**'),
      'agentAppendix() keys on the literal **coder**; without it MCP clients get a no-op');
    assert.match(command, /\b(use|spawn|run|delegate to|hand off to)\s+(the\s+)?\*\*coder\*\*/i,
      'the command must INVOKE coder in the bolded idiom the validator accepts');
  });

  test('AC31 — the CLI is referenced through ${CLAUDE_PLUGIN_ROOT}, never an absolute path', () => {
    // Runtime substitution, never a build-time rewrite: the plugin installs from a git
    // marketplace, a local directory, or any machine (ml-specs/.mcp.json:1-8).
    assert.ok(command.includes('${CLAUDE_PLUGIN_ROOT}/scripts/pr-address.mjs'),
      'the command must invoke the CLI through ${CLAUDE_PLUGIN_ROOT}');
    for (const m of command.matchAll(/(?<![\w${}:.-])\/(?:Users|home|opt|usr|var|tmp|private)\//g)) {
      assert.fail(`the command carries a literal absolute path: ${m[0]}`);
    }
  });

  test('AC32 — the triage routes are a machine-readable marker, not a sentence to parse', () => {
    const MARKER = '<!-- triage-routes: contract-change=/ml-specs:spec defect=/ml-specs:fix -->';
    assert.ok(command.includes(MARKER), `the routing marker is missing or reworded:\n  expected ${MARKER}`);

    // Parsed, not just matched: the assertion is that the marker NAMES both destinations, so a
    // marker emptied to `contract-change= defect=` fails rather than passing on its own shape.
    const routes = Object.fromEntries(
      [...command.match(/<!--\s*triage-routes:(.*?)-->/)[1].matchAll(/([a-z-]+)=(\S+)/g)]
        .map((m) => [m[1], m[2]]),
    );
    assert.equal(routes['contract-change'], '/ml-specs:spec',
      'a contract-changing comment must route to /ml-specs:spec, not be implemented');
    assert.equal(routes.defect, '/ml-specs:fix',
      'a defect must route to the /ml-specs:fix discipline');
  });

  test('AC39 — the human gate is a step, and it comes BEFORE the step that invokes coder', () => {
    // The security control is the ORDERING, not the presence of both steps.
    // `coder` holds Bash as well as Write, Edit, and a PR comment is text an
    // untrusted third party wrote; if the agent ran first, an injected
    // instruction would obtain shell execution in the operator's checkout before
    // any human saw anything, and a later `git diff` cannot show a command that
    // already ran.
    const all = steps(command);
    assert.deepEqual(all.map((x) => x.n), all.map((_, i) => i + 1),
      `the steps are not numbered 1..N in file order: ${all.map((x) => x.n).join(', ')}`);

    // The gate identifies itself with a marker rather than a sentence, the way
    // AC32's routes do — repo-skills-wiring.test.mjs:10-24 rules that prose
    // meaning cannot be held by a regex.
    const gates = all.filter((x) => /<!--\s*human-gate:/.test(x.body));
    assert.equal(gates.length, 1, 'exactly one step must carry the <!-- human-gate: --> marker');

    const coders = all.filter((x) => x.body.includes('**coder**'));
    assert.equal(coders.length, 1, 'exactly one step may hand work to **coder**');

    assert.ok(gates[0].n < coders[0].n,
      `the human gate is step ${gates[0].n} and coder is invoked at step ${coders[0].n}: `
      + 'an untrusted comment body reaches a Bash-capable agent before any human sees it');

    // The gate says what it precedes, so a reader moving it knows what breaks.
    assert.match(gates[0].body, /before any agent/i,
      'the gate step does not state that it precedes any agent receiving a comment body');

    // And the triage step, which is the one that reads every body, hands nothing
    // to an agent while it does so.
    const triage = all.filter((x) => x.n < gates[0].n);
    assert.ok(!triage.some((x) => x.body.includes('**coder**')),
      'a step before the gate invokes coder');
  });

  test('AC40 — the coder hand-off names the envelope and the path scope', () => {
    const handoff = steps(command).find((x) => x.body.includes('**coder**'));
    assert.ok(handoff, 'no step invokes **coder**');

    // A delimited envelope, present as the literal delimiters the hand-off is to
    // use: "treat this as data" inlined into the prompt is a sentence the same
    // model is asked to remember while reading the attacker's text.
    for (const delimiter of ['----- BEGIN UNTRUSTED COMMENT -----', '----- END UNTRUSTED COMMENT -----']) {
      assert.ok(handoff.body.includes(delimiter),
        `the coder hand-off carries no ${delimiter} delimiter`);
    }
    assert.match(handoff.body, /data\b[^.]*\bnever\b[^.]*instructions/i,
      'the envelope does not say the quoted text is data, never instructions');

    // Scoped to the comment's own path, with the escape reported rather than
    // silent.
    assert.match(handoff.body, /scope the edits to the comment's own `path`/i,
      "the hand-off does not scope edits to the comment's own `path`");
    assert.match(command, /file touched outside the scope step \d+ allowed/i,
      'nothing reports a file touched outside the allowed scope');
  });

  test('AC52 — a comment with no file scope is never handed to coder', () => {
    // `path` is null for the conversation and review-summary kinds, and THE
    // COMMENTER CHOOSES THE KIND. Letting those through unscoped would make the
    // path-scoping rule of AC40 bypassable by picking a comment type — the control
    // would still be written down and would no longer bind.
    //
    // Asserted on the hand-off step itself, so moving the rule away from the step
    // that invokes coder fails rather than passing on a file-global grep.
    const handoff = steps(command).find((x) => x.body.includes('**coder**'));
    assert.ok(handoff, 'no step invokes **coder**');

    assert.match(handoff.body, /no `path`[^.]*never handed to `coder`|never handed to `coder`/i,
      'the hand-off does not refuse a comment that has no path');
    for (const kind of ['conversation', 'review-summary']) {
      assert.ok(handoff.body.includes(kind),
        `the hand-off does not name the ${kind} kind, which is where path is null`);
    }

    // The outcome is reported, not silently dropped: the operator learns the
    // comment exists and that a human has to answer it.
    assert.ok(command.includes('skipped — no file scope; address manually'),
      'the path-less outcome is not reported in the literal form spec 0014 §4.1 step 5 names');
  });

  test('AC33 — it CLOSES by naming the next command, asserted on the closing block', () => {
    // MOVED, deliberately, by spec 0022 (its §3 and AC7). This used to pin the LAST LINE of the
    // file. Spec 0022 appends a closing-options block under the same `## 9.` heading, so "the last
    // line names /code-review" became false the moment the block grew — and 0022 declared that up
    // front rather than discovering it here. What AC33 protects is unchanged: the command does not
    // end without naming where to go. The unit is now the closing SECTION, which still contains the
    // prose next-step line.
    const close = command.slice(command.indexOf('## 9.'));
    assert.ok(command.includes('## 9.'), 'the closing section (## 9.) is gone');
    assert.match(close, /`\/code-review`/,
      `the closing block must name /code-review; it is:\n${close}`);
    // The two-step close pr.md uses: review the commits, then archive once merged.
    assert.match(close, /`\/ml-specs:spec-advance [^`]*Archived`/,
      `the closing block must also name the archive step; it is:\n${close}`);
    // And it is still the LAST section. A "close" that another section follows is not one, which
    // is the half the old last-line assertion carried for free and this would otherwise drop.
    assert.ok(!close.slice('## 9.'.length).includes('\n## '),
      'another section follows the close, so `## 9.` is no longer where the command ends');
  });

  test('AC54 — every host-supplied column of the list table goes through printable()', () => {
    // BOTH existing call sites were deletable with the suite green, and the
    // path:line column had no coverage at all — `c.path` is host-supplied (an ADO
    // threadContext.filePath is whatever the host returned) and was printed raw.
    // printable()'s own behaviour is a unit test (lib/pr-address.test.mjs); what
    // cannot be seen from there is whether the CLI still CALLS it, because under
    // --dry-run the list path prints no comment line for a subprocess to read.
    const start = cli.indexOf('for (const c of ordered) {');
    const end = cli.indexOf('if (!ordered.length)');
    assert.ok(start !== -1 && end > start, 'the list print loop could not be located');
    const loop = cli.slice(start, end);

    assert.match(loop, /const where = printable\(/,
      'the path:line column is printed raw — a commenter owns the operator\'s escape sequences');
    assert.match(loop, /printable\(c\.body/, 'the body column is printed raw');
    assert.match(loop, /printable\(c\.author\)/, 'the author column is printed raw');
    // And the column the loop prints IS the stripped one, not a second variable.
    assert.match(loop, /\$\{where\.padEnd\(/, 'the printed path:line column is not the stripped `where`');
  });

  test('AC53 — the reply run reports what the fold says, and the CLI cannot claim a delivery itself', () => {
    // THE MUTATION THIS PINS. Rewriting the catch around governedReply() to report
    // every refusal as `posted: true` exited 0 with 331/331 green: the fold is
    // unit-tested (lib/pr-address.test.mjs AC53), but a CLI that stopped using it
    // would pass that test while lying to the operator.
    assert.ok(cli.includes('foldResults('), 'the CLI no longer folds its outcomes through foldResults()');
    // SET, not called (AC67): process.exit() drops whatever console.log has queued,
    // and a --json summary larger than the pipe buffer is queued rather than
    // written. The fold is still the one source of the exit code.
    assert.match(cli, /process\.exitCode = folded\.exit/,
      'the exit code does not come from the fold, so the report and the exit can disagree');

    // The refusal is recorded AS THE ERROR — the fold reads `error` and nothing
    // else can override it.
    const catchBlock = cli.slice(cli.indexOf('} catch (e) {', cli.indexOf('gate.replyFor(')));
    assert.match(catchBlock.slice(0, 500), /error: e[,\s}]/,
      'a governedReply refusal is not recorded as an error, so the fold cannot see it');

    // And the CLI never CONSTRUCTS a delivery claim of its own: `posted` exists
    // only as a bucket the fold produced. Comment lines are exempt — this is about
    // what the code does, and the prose above the loop explains the mutation.
    for (const [i, line] of cli.split('\n').entries()) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      assert.ok(!line.includes('posted:'),
        `pr-address.mjs:${i + 1} builds its own posted claim — that is foldResults' job:\n  ${line.trim()}`);
    }
  });

  test('AC58 — the reply output path strips host-derived text too, not just the list table', () => {
    // printable() guarded the `list` path only. `folded.failed[].reason` carries a
    // governedReply refusal — which quotes the HOST's own error, and lib/http.mjs:27
    // puts up to 500 characters of response body in it with C0/C1 intact — and
    // `warn()` prints the lib's warnings the same way. The reply path is as much a
    // terminal sink as the table above it.
    const start = cli.indexOf('for (const f of folded.failed) {');
    const end = cli.indexOf('printTranscript(transport, C);', start);
    assert.ok(start !== -1 && end > start, 'the reply print block could not be located');
    const block = cli.slice(start, end);

    assert.match(block, /printable\(f\.reason\)/, 'a refusal reason is printed raw');
    assert.match(block, /printable\(s\.reason\)/, 'an already-answered reason is printed raw');

    const warnLine = cli.split('\n').find((l) => l.startsWith('const warn ='));
    assert.ok(warnLine, 'the warn() helper could not be located');
    assert.match(warnLine, /printable\(w\)/, 'warn() prints the host\'s warnings raw');

    // AND THE --json BRANCHES, on both subcommands. JSON.stringify escapes C0 but
    // passes C1 THROUGH — \x9b is a single-byte CSI — so `--json` was the one
    // output still handing a commenter the operator's escape sequences, on the
    // reply summary (which carries failed[].reason) and on the list payload.
    const dumps = cli.split('\n').filter((l) => l.includes('console.log(') && l.includes('JSON.stringify('));
    assert.ok(dumps.length >= 2, `only ${dumps.length} --json output sites found; the CLI has changed shape`);
    for (const line of dumps) {
      // printableJson, NOT printable (AC66). printable strips C0, and C0 includes
      // `\n`: over a serialized document it deleted the formatter's own newlines,
      // collapsed the payload onto one line and made `null, 2` dead — while adding
      // nothing, since JSON.stringify has already escaped C0 inside every string.
      // The C1 half is what this sink owes, and printableJson keeps it.
      assert.match(line, /printableJson\(JSON\.stringify\(/,
        `a --json payload is printed raw, C1 and all:\n  ${line.trim()}`);
    }
  });

  test('AC67 — no success path calls process.exit(), because that truncates a piped payload', () => {
    // MEASURED: 70000 bytes into a pipe, 65536 out. process.exit() abandons what
    // console.log has queued, and a write larger than the pipe buffer is queued
    // rather than finished. Step 2 of the command PIPES `list --json` to the agent,
    // so a busy pull request yielded JSON cut mid-token — and the same shape sat on
    // the reply summary.
    //
    // The delivery itself is asserted end to end in scripts.test.mjs, over a pipe
    // and past the buffer. This is the structural half: the `list` payload cannot
    // be made large enough offline (under --dry-run the recorder supplies no
    // comments), so what is pinned here is that neither success path has grown an
    // exit call back.
    // Comment lines are exempt: this is about what the code DOES, and the prose at
    // both sinks explains why the call is gone.
    const code = cli.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!/process\.exit\(0\)/.test(code),
      'a success path calls process.exit(0), which truncates a piped payload at the pipe buffer');
    assert.ok(!/process\.exit\(folded\.exit\)/.test(code),
      'the reply summary is followed by process.exit(), which truncates it at the pipe buffer');
    // The refusal paths still exit immediately, and must: they print a short
    // message to stderr and nothing downstream is reading a payload from them.
    assert.ok(/process\.exit\(2\)/.test(code),
      'the usage/credential refusals no longer exit 2; spec-gate.mjs:21 is the convention');
  });

  test('AC59 — the gate is constructed from the value --head carried, and nothing else', () => {
    // THE MUTATION THIS PINS: `governedReply(base, { localHead: 'forged' })` leaves
    // the whole suite green. The --json summary reports the CLI's own `head`
    // constant rather than anything the gate received, so the two can decouple in
    // silence — and a gate whose localHead never equals the pushed head refuses
    // every reply forever, which is the failure revision 10 of spec 0014 exists to
    // prevent.
    assert.match(cli, /const head = flag\('head'\);/,
      "--head is no longer read into the constant the gate is built from");
    assert.match(cli, /governedReply\(base,\s*\{\s*localHead:\s*head\s*\}\)/,
      'the gate is not constructed as governedReply(base, { localHead: head })');
    // And only once: a second construction could quietly be the one that runs.
    assert.equal(cli.split('localHead').length - 1, 1,
      'localHead is mentioned more than once in the CLI, so the pin above may not be the live one');
  });

  test('AC59 — the authorship check compares authorKey, with no fallback to the display name', () => {
    // AC51 says "no fallback", and adding `|| c.author` survives the suite today:
    // AC41's forged comment carries a non-empty authorKey, so the fallback is never
    // reached there. A display name is self-settable on an MSA-backed ADO
    // organisation, so a fallback would hand the whole check to the commenter.
    //
    // SCANNED ONE FRAME EARLIER TOO. Pinning `sameAuthor(...)` alone left the
    // fallback expressible at its CALLER: `ownReply(c.body, c.authorKey || c.author,
    // self)` survived the suite, because by the time sameAuthor sees the argument
    // the display name is already in it. Every function on the authorship path is
    // held to the same rule, or the rule just moves up a line.
    const source = readPlugin('scripts/lib/scm.mjs');
    const code = source.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
    for (const fn of ['sameAuthor', 'ownReply']) {
      const calls = code.flatMap((l) =>
        [...l.matchAll(new RegExp(`\\b${fn}\\(([^)]*)\\)`, 'g'))].map((m) => m[1]));
      assert.ok(calls.length >= 1, `${fn} is never called; the authorship check has moved`);
      for (const args of calls) {
        assert.ok(/\bauthorKey\b/.test(args), `${fn} is not compared on authorKey: ${fn}(${args})`);
        assert.ok(!/\|\||\?\?/.test(args), `${fn} has a fallback argument: ${fn}(${args})`);
        assert.ok(!/\bauthor\b/.test(args), `${fn} sees a display name: ${fn}(${args})`);
      }
    }
    assert.ok(code.filter((l) => /\bsameAuthor\(/.test(l)).length >= 2,
      'sameAuthor is called fewer than twice; the check has moved');
  });

  test('AC59 — the list path is built on readOnlyScm(base), which has no way to post', () => {
    // §4.1 step 2 and §7 both lean on the read path being STRUCTURALLY unable to
    // write; AC21 pins the facade's shape, not the CLI's use of it, so replacing
    // `readOnlyScm(base)` with `base` survives the suite. This is that half.
    const start = cli.indexOf("if (action === 'list') {");
    const end = cli.indexOf('// --- reply', start);
    assert.ok(start !== -1 && end > start, 'the list block could not be located');
    const block = cli.slice(start, end);

    assert.match(block, /const scm = readOnlyScm\(base\);/,
      'the list path no longer takes the read-only view, so it can post');
    assert.match(block, /scm\.listReviewComments\(/, 'the list path does not read through the read-only view');
    assert.ok(!/\bbase\.[a-zA-Z]/.test(block),
      'the list path reaches past the read-only view to the raw adapter');
  });

  test('the CLI it names exists and declares the same two subcommands', () => {
    // Derived from the command file, so this fails if either side is renamed rather than
    // restating two literals typed here.
    assert.match(cli, /^#!\/usr\/bin\/env node/, 'the CLI has no shebang');
    for (const sub of ['list', 'reply']) {
      assert.ok(command.includes(`/scripts/pr-address.mjs ${sub} `),
        `the command never invokes "${sub}"`);
      assert.ok(cli.includes(`pr-address.mjs ${sub} `), `the CLI documents no "${sub}" usage`);
    }
  });
});

describe('manifests, rosters and the counts the gates do not watch', () => {
  test('AC34 — both manifest descriptions name the command, and the real validator exits 0', () => {
    // scripts/validate-plugin.mjs:140-177 (check 3) HARD-ERRORS when either description omits a
    // command in ml-specs/commands/: that list is how a user discovers the command in the
    // marketplace and in /plugin, and nothing else keeps it in step with disk.
    for (const [label, rel] of [['plugin.json', 'ml-specs/.claude-plugin/plugin.json'],
                                ['marketplace.json', '.claude-plugin/marketplace.json']]) {
      const text = readRoot(rel);
      assert.ok(text.includes('/ml-specs:pr-address'), `${label}'s description does not name /ml-specs:pr-address`);
    }

    // "Exits 0" is a STANDING invariant, true before this spec too; the description clause above
    // is the feature-specific half.
    let code = 0;
    try {
      execFileSync('node', [VALIDATOR], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      code = e.status ?? 1;
      assert.fail(`the validator failed (${code}):\n${e.stdout ?? ''}${e.stderr ?? ''}`);
    }
    assert.equal(code, 0);
  });

  test('AC70 — no .mjs under scripts/ carries a control character', () => {
    // A literal NUL, used as the cache-key separator in lib/scm.mjs, made that file
    // BINARY TO GREP: `grep -c governedReply ml-specs/scripts/lib/scm.mjs` printed
    // nothing at all, because grep reports a binary file rather than matching in
    // it. This repo's knowledge layer and house style rest on `file:line` citation
    // — CLAUDE.md's token-discipline rule, every `docs/` reference, and the doc
    // gate in .github/workflows/knowledge-layer.yml — and every tool that produces
    // one (grep, ripgrep, git grep, a diff viewer) stops at a NUL. lib/pr-address.mjs
    // carried the other form: a comment EXPLAINING the escape `\u001b` contained a
    // real ESC character.
    //
    // A control character in source is never load-bearing: one that is meant is
    // written as an escape sequence. Tab, newline and carriage return are the three
    // that are ordinary text, so they are the three exempted.
    //
    // Whole tree, not one file: this is a class, and the round-20 fix that closed
    // the id collision on ADO alone is the standing lesson about fixing only the
    // instance a report happened to name.
    const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

    const scripts = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.mjs')) scripts.push(full);
      }
    };
    walk(join(PLUGIN, 'scripts'));

    // NON-VACUITY: a walk that found nothing would pass silently, which is the
    // failure mode a structural scan has.
    assert.ok(scripts.length >= 30, `only ${scripts.length} .mjs files were scanned under scripts/`);
    assert.ok(scripts.some((f) => f.endsWith(join('lib', 'scm.mjs'))), 'lib/scm.mjs was not scanned');

    const offenders = [];
    for (const file of scripts) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        for (const ch of line) {
          if (!CONTROL.test(ch)) continue;
          offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1} carries U+`
            + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'));
        }
      });
    }
    assert.deepEqual(offenders, [],
      'a control character makes these files binary to grep, which breaks the file:line citation '
      + `the knowledge layer is built on:\n  ${offenders.join('\n  ')}`);

    // And the scanner itself is not vacuous: it catches what it exists to catch,
    // and leaves ordinary whitespace alone.
    assert.ok(CONTROL.test(String.fromCharCode(0)), 'the scan would not have caught a NUL');
    assert.ok(CONTROL.test(String.fromCharCode(27)), 'the scan would not have caught an ESC');
    assert.ok(!CONTROL.test('\t'), 'a tab is ordinary text');
    assert.ok(!CONTROL.test('\r\n'), 'a line ending is ordinary text');
  });

  test('AC35 — the ungated roster surfaces name the command', () => {
    // ml-specs/README.md is COMMITTED and ships to npm and the public mirror, so this always has
    // teeth. Scoped to the command roster: the marketplace row and the tree comment are separate
    // sites, and a file-global grep would be satisfied by any one of them.
    const readme = readPlugin('README.md');
    const roster = readme.slice(readme.indexOf('**Commands** (`commands/`)'),
      readme.indexOf('**Skills** (`skills/`)'));
    assert.ok(roster.length > 0, "ml-specs/README.md's command roster could not be located");
    assert.match(roster, /^- `\/ml-specs:pr-address [^`]*` —/m,
      "ml-specs/README.md's command roster has no /ml-specs:pr-address bullet");

    const rootReadme = readRoot('README.md');
    const marketplace = rootReadme.slice(rootReadme.indexOf('| Plugin | What it gives the team |'),
      rootReadme.indexOf('## Install'));
    assert.ok(marketplace.length > 0, "README.md's marketplace table could not be located");
    assert.ok(marketplace.includes('/ml-specs:pr-address'), "README.md's marketplace row omits the command");

    // Scoped to the COMMANDS half of the tree: a file-global grep is satisfied by the marketplace
    // row above, which is a different site.
    const tree = rootReadme.slice(rootReadme.indexOf('├── commands/'), rootReadme.indexOf('├── skills/'));
    assert.ok(tree.length > 0, "README.md's commands tree comment could not be located");
    assert.match(tree, /(^|[^\w-])pr-address(?![\w-])/, "README.md's commands tree comment omits pr-address");
  });

  test('AC35 — the scripts shard\'s CLI and lib counts equal what is on disk', (t) => {
    // Derived from disk, never from a digit typed here. Both numbers in this shard were ALREADY
    // stale before spec 0014 — it claimed 9 CLIs while 10 existed — which is exactly why this is
    // asserted against reality rather than incremented.
    const shard = readGenerated('docs/architecture/scripts.md');
    if (!shard) return t.diagnostic('docs/architecture/scripts.md absent (generated layer) — skipped');

    const clis = mjs('scripts').length;
    for (const re of [/\(\s*(\d+)\s+CLIs \+ `lib\/`\)/, /## Plugin CLIs \(`ml-specs\/scripts\/`, (\d+)\)/]) {
      const m = shard.match(re);
      assert.ok(m, `docs/architecture/scripts.md no longer states the CLI count for ${re}`);
      assert.equal(Number(m[1]), clis, `the shard claims ${m[1]} CLIs, ml-specs/scripts/ holds ${clis}`);
    }
    assert.ok(shard.includes('pr-address.mjs'), 'the Plugin CLIs table has no pr-address row');

    const libFiles = mjs('scripts/lib');
    const colocated = libFiles.filter((f) =>
      existsSync(join(PLUGIN, 'scripts', 'lib', f.replace(/\.mjs$/, '.test.mjs')))).length;
    const modules = shard.match(/`lib\/` holds (\d+) modules/);
    assert.ok(modules, 'the shard no longer states the lib/ module count');
    assert.equal(Number(modules[1]), libFiles.length,
      `the shard claims ${modules[1]} lib modules, disk holds ${libFiles.length}`);
    const tested = shard.match(/(\d+) of them have a colocated `\.test\.mjs`/);
    assert.ok(tested, 'the shard no longer states how many lib modules are tested');
    assert.equal(Number(tested[1]), colocated,
      `the shard claims ${tested[1]} colocated tests, disk holds ${colocated}`);
  });

  test('AC36 — the commit/push carve-out is recorded on both sides of the rule it breaks', (t) => {
    // Spec 0014 §7 leans on this as one of two mitigations for diverging from a standing rule, and
    // every other row of that table names its evidence. Striking it ships the divergence
    // unrecorded.
    const pr = readPlugin('commands/pr.md');
    assert.ok(pr.includes('/ml-specs:pr-address'),
      'ml-specs/commands/pr.md forbids commit and push and does not name the one command that does');
    assert.ok(pr.includes(SPEC_FILE), `ml-specs/commands/pr.md's carve-out does not cite ${SPEC_FILE}`);

    const claude = readGenerated('CLAUDE.md');
    if (!claude) return t.diagnostic('CLAUDE.md absent (generated layer) — its carve-out check skipped');
    // Scoped to the git section, which is the section that states the rule.
    const start = claude.indexOf('## Git & PR workflow');
    assert.notStrictEqual(start, -1, 'CLAUDE.md has no "## Git & PR workflow" section');
    const nextHeading = claude.indexOf('\n## ', start + 4);
    const section = nextHeading === -1 ? claude.slice(start) : claude.slice(start, nextHeading);
    assert.ok(section.includes('/ml-specs:pr-address'), "CLAUDE.md's git section does not name the carve-out");
    assert.ok(section.includes(SPEC_FILE), `CLAUDE.md's git section does not cite ${SPEC_FILE}`);
  });

  test('AC37 — the ${CLAUDE_PLUGIN_ROOT} breakdown moved with the command that forced it', (t) => {
    // AC31 requires pr-address.md to carry the token, so this count moves whether or not anyone
    // remembers. Leaving it is a RED SUITE, not a stale doc —
    // repo-skills-wiring.test.mjs:237-258 gates it. Derived here with the same arithmetic, so the
    // two cannot disagree about what "actual" means.
    const cmds = readdirSync(join(PLUGIN, 'commands')).filter((f) => f.endsWith('.md'))
      .filter((f) => readPlugin(`commands/${f}`).includes('CLAUDE_PLUGIN_ROOT')).length;
    const hooks = readdirSync(join(PLUGIN, 'hooks'))
      .filter((f) => readFileSync(join(PLUGIN, 'hooks', f), 'utf8').includes('CLAUDE_PLUGIN_ROOT')).length;
    const mcp = ['.mcp.json', 'templates/mcp/.mcp.json']
      .filter((r) => existsSync(join(PLUGIN, r)) && readPlugin(r).includes('CLAUDE_PLUGIN_ROOT')).length;
    const total = cmds + hooks + mcp;

    assert.ok(readPlugin('commands/pr-address.md').includes('CLAUDE_PLUGIN_ROOT'),
      'pr-address.md must carry the token — it is what moves this count');

    const skipped = [];
    for (const rel of ['docs/ARCHITECTURE.md', 'docs/architecture/prompt-surface.md']) {
      const text = readGenerated(rel);
      if (!text) { skipped.push(rel); continue; }
      const flat = text.replace(/[*`]/g, '').replace(/\s+/g, ' ');
      const m = flat.match(/(\d+)\s+files\s*\((\d+)\s+commands|(\d+)\s+commands,\s*\d+\s+hooks?,[^.]{0,40}?\((\d+)\s+files\)/);
      assert.ok(m, `${rel} states no \${CLAUDE_PLUGIN_ROOT} usage breakdown`);
      const [claimedTotal, claimedCmds] = m[1] ? [Number(m[1]), Number(m[2])] : [Number(m[4]), Number(m[3])];
      assert.equal(claimedCmds, cmds, `${rel}: claims ${claimedCmds} commands use the token, actual ${cmds}`);
      assert.equal(claimedTotal, total, `${rel}: claims ${claimedTotal} files total, actual ${total}`);
    }
    if (skipped.length) t.diagnostic(`skipped (absent generated layer): ${skipped.join(', ')}`);
  });

  test('AC37 — the suite that gates those counts is itself green', () => {
    // Named by the criterion. It is a child process on purpose: the point is that the GATE passes,
    // not that this file's re-derivation of the arithmetic agrees with itself.
    try {
      execFileSync('node', ['--test', 'ml-specs/scripts/repo-skills-wiring.test.mjs'],
        { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      assert.fail(`repo-skills-wiring.test.mjs is red:\n${e.stdout ?? ''}${e.stderr ?? ''}`);
    }
  });
});
