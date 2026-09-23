// Script-level behaviour: what each CLI does at its boundaries.
//
// The lib tests cover the logic; these cover the decision a script makes about
// whether to act at all. That is where the interesting bugs live — a script that
// notices a precondition is violated, says so in prose, and proceeds anyway
// passes every unit test its lib has.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));

function repo(specs = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sdd-scripts-'));
  mkdirSync(join(dir, 'specs'), { recursive: true });
  mkdirSync(join(dir, 'docs'), { recursive: true });
  for (const [name, body] of Object.entries(specs)) writeFileSync(join(dir, 'specs', name), body);
  return dir;
}

/**
 * Run a script; return { code, stdout, stderr } instead of throwing on non-zero.
 *
 * `env` REPLACES the child's environment rather than extending it. The scripts
 * that read credentials (pr-address.mjs) decide what to do from whether a
 * variable is set, so inheriting the caller's shell would give a maintainer with
 * ADO_PAT exported a different result from CI. PATH is carried through because
 * the child is `node`.
 */
function run(script, args, cwd, env = null) {
  const options = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  if (env) options.env = { PATH: process.env.PATH, ...env };
  try {
    const stdout = execFileSync('node', [join(SCRIPTS, script), ...args], options);
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

const spec = ({ status = 'Approved', criteria = '- [ ] **AC1** — Given x, when y, then z.' }) =>
  `# Spec: Fixture\n\n| | |\n|---|---|\n| **Ticket** | PAY-1 |\n| **Status** | ${status} |\n\n## 5. Acceptance criteria\n\n${criteria}\n`;

describe('spec-brief refuses rather than warns', () => {
  test('an approved spec with NO criteria is refused', () => {
    // A brief exists to state the definition of done. Without criteria there is
    // none, so emitting one under a heading that claims to supply it is worse
    // than refusing. spec-gate.mjs fails this spec; the two must agree.
    const dir = repo({ '0200-none.md': spec({ criteria: '' }) });
    const r = run('spec-brief.mjs', ['0200'], dir);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /no acceptance criteria/);
    assert.doesNotMatch(r.stdout, /Definition of done/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('spec-gate and spec-brief agree on that spec', () => {
    const dir = repo({ '0200-none.md': spec({ criteria: '' }) });
    assert.equal(run('spec-gate.mjs', ['specs/0200-none.md'], dir).code,
                 run('spec-brief.mjs', ['0200'], dir).code);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a Draft spec is refused — the contract is still being negotiated', () => {
    const dir = repo({ '0201-draft.md': spec({ status: 'Draft' }) });
    const r = run('spec-brief.mjs', ['0201'], dir);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /before the approval gate/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('an approved spec with criteria produces a brief pairing each with its test case', () => {
    const dir = repo({ '0202-ok.md': spec({}) });
    const r = run('spec-brief.mjs', ['0202'], dir);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /\*\*AC-1\*\* \(TC-0202\.1\)/);
    assert.match(r.stdout, /Definition of done/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('spec-trace', () => {
  test('a suffixed spec id is a distinct spec, not a clash', () => {
    const dir = repo({ '0165b-follow-up.md': spec({}) });
    const r = run('spec-trace.mjs', ['0165b'], dir);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /SPEC-0165b/);
    assert.match(r.stdout, /TC-0165b\.1/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a hand-typed ticket is reported unverifiable, not counted as passing', () => {
    const dir = repo({ '0203-x.md': spec({}) });
    const r = run('spec-trace.mjs', ['0203'], dir);
    assert.match(r.stdout, /cannot be verified from the repo/);
    assert.match(r.stdout, /chain intact/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('no matching spec is an error, not an empty pass', () => {
    const dir = repo({ '0204-x.md': spec({}) });
    assert.equal(run('spec-trace.mjs', ['9999'], dir).code, 1);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('spec-fanout never gives a false all-clear', () => {
  const estate = `| Event / queue / topic | Producer | Consumer | Notes | Evidence |
|---|---|---|---|---|
| \`payment.captured\` | svc-a | svc-b (\`Listener\`) | n | e |`;

  test('asked who breaks with no estate index, it refuses rather than reporting none', () => {
    // An empty list plus a zero exit reads as "nothing else is affected". That is
    // the most expensive wrong answer this script can give.
    const dir = repo({ '0001-x.md': spec({}) });
    const r = run('spec-fanout.mjs', ['0001', 'payment.captured', '--plan'], dir);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /cannot say who else breaks/);
    assert.match(r.stderr, /indistinguishable from "nothing is affected"/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a spec that fans out to nothing says which reason, not an empty plan', () => {
    const dir = repo({ '0001-x.md': spec({}) });
    const r = run('spec-fanout.mjs', ['0001', '--plan'], dir);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /fans out to nothing/);
    assert.doesNotMatch(r.stdout, /would open/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('with an index present it plans normally', () => {
    const dir = repo({ '0001-x.md': spec({}) });
    writeFileSync(join(dir, 'docs', 'ESTATE.md'), estate);
    const r = run('spec-fanout.mjs', ['0001', 'payment.captured', '--plan'], dir);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /svc-b/);
    assert.match(r.stdout, /consumes payment\.captured/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('every target shares one branch name', () => {
    const dir = repo({ '0001-x.md': spec({}) });
    writeFileSync(join(dir, 'docs', 'ESTATE.md'), estate);
    const out = run('spec-fanout.mjs', ['0001', 'payment.captured', '--plan'], dir).stdout;
    const branches = [...out.matchAll(/feat\/0001-[a-z-]+/g)].map((m) => m[0]);
    assert.ok(branches.length > 0);
    assert.equal(new Set(branches).size, 1);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('nfr-compile', () => {
  const NFRS = `| NFR | Kind | Statement | Metric | Op | Value | Unit | Applies to |
|-----|------|-----------|--------|----|-------|------|------------|
| NFR-01 | performance | responsive | p95 | < | 300 | ms | svc-a |
| NFR-02 | security | no findings |  |  |  |  | * |`;

  test('an NFR with no measurable threshold makes the run fail', () => {
    const dir = repo({});
    writeFileSync(join(dir, 'docs', 'NFRS.md'), NFRS);
    const r = run('nfr-compile.mjs', [], dir);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /NFR-02[\s\S]*refused/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('dry run writes nothing', () => {
    const dir = repo({});
    writeFileSync(join(dir, 'docs', 'NFRS.md'),
      NFRS.split('\n').filter((l) => !l.includes('NFR-02')).join('\n'));
    run('nfr-compile.mjs', [], dir);
    assert.throws(() => execFileSync('cat', [join(dir, 'docs', 'CONSTRAINTS.md')], { stdio: 'ignore' }));
    rmSync(dir, { recursive: true, force: true });
  });

  test('--apply writes the constraint and reports what changed', () => {
    const dir = repo({});
    writeFileSync(join(dir, 'docs', 'NFRS.md'),
      NFRS.split('\n').filter((l) => !l.includes('NFR-02')).join('\n'));
    const r = run('nfr-compile.mjs', ['--apply'], dir);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /knowledge layer updated/);
    // second run is a no-op and must say so rather than claiming a write
    assert.match(run('nfr-compile.mjs', ['--apply'], dir).stdout, /already current/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('spec-gate does not invent a test from a glob', () => {
  // Spec 0007 AC20. Found by running 0007's own Approved -> Implemented gate: claimedTests()
  // harvests filename-with-extension tokens out of section 6, and its character class excludes
  // `*`, so a glob QUOTED IN PROSE matched from the dot onward and produced a stem-less
  // `.test.mjs`. No spec claimed that file, so tests-exist failed and blocked a legitimate
  // transition — the precise outcome claimedTests()'s own contract says is worse than a miss.
  //
  // Asserted on a section 6 that ALSO names a real test, so a pass proves the phantom is gone
  // rather than proving the gate went blind: strip the real test and this must go red.
  const withSection6 = (s6) =>
    `# Spec: Fixture\n\n| | |\n|---|---|\n| **Ticket** | PAY-1 |\n| **Status** | Approved |\n\n`
    + `## 5. Acceptance criteria\n\n- [x] **AC1** — Given x, when y, then z.\n\n`
    + `## 6. Test plan\n\n${s6}\n`;

  test('a quoted glob in section 6 is not treated as a claimed test', () => {
    const dir = repo({
      '0201-glob.md': withSection6(
        "New tests live in `scripts/spec-gate-fixture.test.mjs`. The name matches the\n"
        + "`'scripts/*.test.mjs'` glob at `package.json:7`, so the runner picks it up.",
      ),
    });
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    writeFileSync(join(dir, 'scripts', 'spec-gate-fixture.test.mjs'), '// fixture\n');

    const r = run('spec-gate.mjs', ['specs/0201-glob.md', '--to', 'Implemented'], dir);
    // The phantom, when present, is listed on its own indented line as a bare stem-less token.
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, /^\s+\.test\.mjs\s*$/m,
      `a stem-less .test.mjs was harvested from the glob:\n${r.stdout}`);
    assert.match(r.stdout, /PASS\s+tests-exist/, `tests-exist did not pass:\n${r.stdout}`);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a genuinely missing test still fails the gate', () => {
    // The other half: the fix must not make tests-exist unable to fail.
    const dir = repo({
      '0202-missing.md': withSection6('| AC1 | unit | `scripts/nope.test.mjs` |'),
    });
    const r = run('spec-gate.mjs', ['specs/0202-missing.md', '--to', 'Implemented'], dir);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /FAIL\s+tests-exist/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('pr-address decides whether it can run before it acts', () => {
  // WHY THESE ASSERT ONLY EXIT CODES AND STREAMS. recorder() lives in the CHILD
  // process, so an execFileSync test can never inspect it — a --dry-run
  // transcript proves that --dry-run works, not that a guard refused. Every
  // "issues no request" property is asserted in-process against the lib instead
  // (lib/scm.test.mjs AC17-AC21, lib/pr-address.test.mjs AC22-AC24).
  //
  // Each run passes an EXPLICIT env. These tests turn on whether credentials are
  // set, so inheriting the shell would give a maintainer with ADO_PAT exported a
  // different answer from CI.
  const NO_CREDENTIALS = {};
  const GITHUB = { SDD_SCM_TOOL: 'github', GITHUB_OWNER: 'motivity', GITHUB_TOKEN: 'ghp_x' };

  const withFrom = (entries) => {
    const dir = repo({});
    const file = join(dir, 'replies.json');
    writeFileSync(file, JSON.stringify(entries));
    return { dir, file };
  };

  test('AC25 — a reply batch in which nothing was delivered posts nothing, names every entry, and exits 1', () => {
    // THE MECHANISM, stated honestly. The comment that stood here claimed the
    // head-sha refusal fired, and it never executes: under --dry-run the recorder
    // supplies no COMMENTS either, so planReplies matches no entry and the run
    // fails before governedReply is reached. Deleting the refusal left the old
    // test green, which is why the criterion no longer claims it.
    //
    // The head-sha refusal itself is exercised in-process by AC17/AC18, where the
    // transport is injectable; that the operator's --head reaches the gate as
    // localHead is AC45; that a refusal can never be reported as a delivery is
    // AC53. Together those close the chain this test cannot.
    //
    // What IS asserted here is the CLI's own accounting: nothing was posted, every
    // entry is named with its reason, and a batch where nothing landed exits 1 (a
    // failure, spec-gate.mjs:21) rather than a silent 0.
    const { dir, file } = withFrom([{ commentId: '42', body: 'Renamed in a1b2c3d.' }]);
    const r = run('pr-address.mjs',
      ['reply', '7', '--repo', 'api-neelias', '--from', file, '--head', 'aaa', '--json', '--dry-run'],
      dir, NO_CREDENTIALS);
    assert.equal(r.code, 1, `expected a failure, got ${r.code}\n${r.stdout}${r.stderr}`);

    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.posted, [], 'the run claimed a delivery it never made');
    assert.deepEqual(out.failed.map((x) => x.commentId), ['42']);
    assert.match(out.failed[0].reason, /not on this pull request/);
    // The exit code and the report come from ONE fold, so they cannot disagree.
    assert.equal(out.exit, 1);
    rmSync(dir, { recursive: true, force: true });
  });

  test('AC66 — a --json payload keeps its newlines, and is still valid JSON', () => {
    // printable() strips C0, and C0 INCLUDES `\n`, so `printable(JSON.stringify(x,
    // null, 2))` collapsed the whole document onto one line: the `null, 2` argument
    // was dead and a piped payload arrived as one enormous line. It stayed green
    // because collapsed JSON still PARSES — which is why the wiring test asserting
    // "printable( is present" could not see it either. Both are asserted here.
    const { dir, file } = withFrom([{ commentId: '42', body: 'Renamed in a1b2c3d.' }]);
    const r = run('pr-address.mjs',
      ['reply', '7', '--repo', 'api-neelias', '--from', file, '--head', 'aaa', '--json', '--dry-run'],
      dir, GITHUB);

    assert.doesNotThrow(() => JSON.parse(r.stdout), `the --json payload is not valid JSON:\n${r.stdout}`);
    assert.ok(r.stdout.split('\n').length > 5,
      `the --json payload was collapsed onto ${r.stdout.split('\n').length} line(s), so null, 2 is dead:\n${r.stdout}`);
    // Indentation is part of it: two spaces per level is what `null, 2` asks for.
    assert.match(r.stdout, /\n  "repo":/, `the payload is not indented:\n${r.stdout}`);

    // And the list verb's --json path is valid JSON too, on the same sink.
    const list = run('pr-address.mjs', ['list', '7', '--repo', 'api-neelias', '--json', '--dry-run'],
      dir, GITHUB);
    assert.equal(list.code, 0, `${list.stdout}${list.stderr}`);
    assert.deepEqual(JSON.parse(list.stdout), []);
    rmSync(dir, { recursive: true, force: true });
  });

  test('AC67 — a payload larger than the pipe buffer is delivered WHOLE, on both verbs', () => {
    // MEASURED, with this exact harness: 70000 bytes written to a pipe, 65536 read
    // back, when the writer calls process.exit() straight after console.log. The
    // write does not fail — it is QUEUED, and process.exit() abandons the queue.
    // Step 2 of /ml-specs:pr-address pipes `list --json` into the agent, so a busy
    // pull request handed it JSON cut mid-token; the reply summary had the same
    // shape. run() gives the child a pipe for stdout, which is what makes this
    // observable at all.
    const BUFFER = 65536;

    // The reply verb, through the --json sink. Each unmatched entry contributes a
    // failed[] row naming its own id, so the payload is driven past the buffer by
    // the INPUT rather than by a fixture — and JSON.parse is the assertion, because
    // a truncated document cannot parse however it was cut.
    const entries = Array.from({ length: 900 }, (_, i) => ({
      commentId: String(100000000000000 + i), body: `Addressed in a1b2c3d${i}.` }));
    const { dir, file } = withFrom(entries);
    const reply = run('pr-address.mjs',
      ['reply', '7', '--repo', 'api-neelias', '--from', file, '--head', 'aaa', '--json', '--dry-run'],
      dir, GITHUB);

    // The parse is the assertion: a payload cut at the buffer cannot parse, however
    // it was cut. The size check below is the non-vacuity half — a payload that
    // never exceeded the buffer would parse either way and prove nothing.
    let parsed;
    try {
      parsed = JSON.parse(reply.stdout);
    } catch (e) {
      assert.fail(`the --json payload did not arrive whole (${reply.stdout.length} bytes`
        + `${reply.stdout.length === BUFFER ? ', exactly the pipe buffer' : ''}): ${e.message}`);
    }
    assert.ok(reply.stdout.length > BUFFER,
      `the payload is only ${reply.stdout.length} bytes, so it never reached the pipe buffer`);
    assert.equal(parsed.failed.length, entries.length,
      `${parsed.failed.length} of ${entries.length} entries survived the pipe`);
    assert.equal(parsed.failed[entries.length - 1].commentId, entries[entries.length - 1].commentId,
      'the last entry did not make it through the pipe');
    assert.equal(reply.code, 1, 'the exit code is still the fold\'s, now that it is set rather than called');

    // The list verb's own sink, past the same buffer: the transcript --dry-run
    // prints is driven by the repository name, which is the only input large
    // enough to reach it offline (the recorder supplies no comments, so the --json
    // payload itself is always `[]` here — see the structural pin in
    // pr-address-wiring.test.mjs for the half this cannot cover).
    const huge = 'r'.repeat(80000);
    const list = run('pr-address.mjs', ['list', '7', '--repo', `${huge}END`, '--dry-run'], dir, GITHUB);
    assert.equal(list.code, 0, `${list.stderr.slice(0, 400)}`);
    assert.ok(list.stdout.length > BUFFER,
      `the list output is ${list.stdout.length} bytes, which is inside the pipe buffer`);
    assert.ok(list.stdout.includes('rEND'),
      'the tail of the list output was cut off at the pipe buffer');
    rmSync(dir, { recursive: true, force: true });
  });

  test('AC44 — reply takes exactly one of --head and --deferred', () => {
    // Neither is a usage error naming the missing flag; both together is refused
    // rather than letting --deferred silently win over the gate it bypasses. A
    // gate-bypass switch must not be combinable with the gate it bypasses.
    const { dir, file } = withFrom([{ commentId: '42', body: 'Renamed in a1b2c3d.' }]);
    const base = ['reply', '7', '--repo', 'api-neelias', '--from', file, '--dry-run'];

    const neither = run('pr-address.mjs', base, dir, GITHUB);
    assert.equal(neither.code, 2, `expected 2 (could not run), got ${neither.code}\n${neither.stderr}`);
    assert.match(neither.stderr, /--head/, 'the message does not name the missing flag');

    const both = run('pr-address.mjs', [...base, '--head', 'aaa', '--deferred'], dir, GITHUB);
    assert.equal(both.code, 2, `expected 2, got ${both.code}\n${both.stdout}${both.stderr}`);
    assert.match(both.stderr, /cannot be combined with --head/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('AC45 — the reply path really is wired to --head and to --deferred', () => {
    // MUTATION GUARD, and the reason it exists: renaming flag('head') and
    // inverting has('deferred') AT THE SAME TIME left the suite at 318/318 green.
    // AC17-AC20 cover governedReply itself and could not catch it, because the
    // bug is in the CLI's CONSTRUCTION of the gate — so this asserts what the CLI
    // reports it passed, which is the same expression it hands to replyFor.
    //
    // With --head misnamed, `head` is null and the AC44 alternation refuses the
    // run as "neither flag": exit 2, no JSON, and this test fails on the parse.
    // With --deferred inverted, both `deferred` assertions below flip.
    const { dir, file } = withFrom([{ commentId: '42', body: 'Renamed in a1b2c3d.' }]);
    const base = ['reply', '7', '--repo', 'api-neelias', '--from', file, '--json', '--dry-run'];

    const addressed = run('pr-address.mjs', [...base, '--head', 'a1b2c3d'], dir, GITHUB);
    assert.equal(addressed.code, 1, `expected 1, got ${addressed.code}\n${addressed.stdout}${addressed.stderr}`);
    const claimed = JSON.parse(addressed.stdout);
    assert.equal(claimed.head, 'a1b2c3d', 'the operator\'s --head is not what the gate was given as localHead');
    assert.equal(claimed.deferred, false, 'an ordinary reply must not bypass the head gate');

    const deferred = run('pr-address.mjs', [...base, '--deferred'], dir, GITHUB);
    const carve = JSON.parse(deferred.stdout);
    assert.equal(carve.deferred, true, '--deferred did not reach replyFor as the carve-out');
    assert.equal(carve.head, null, 'a deferred run must claim no head');
    rmSync(dir, { recursive: true, force: true });
  });

  test('AC46 — a pull request id that is not a number is refused before any URL is built', () => {
    // It is interpolated into a URL path on both hosts. The adapters encode every
    // segment (lib/scm.test.mjs AC46); this is the caller-side half, so a `..` or
    // a `?` never gets as far as needing encoding.
    const dir = repo({});
    for (const bad of ['7/../9', '7?x', '7#y', 'abc']) {
      const r = run('pr-address.mjs', ['list', bad, '--repo', 'api-neelias', '--dry-run'], dir, GITHUB);
      assert.equal(r.code, 2, `"${bad}" was accepted as a pull request id (exit ${r.code})`);
      assert.match(r.stderr, /must be a pull request NUMBER/);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test('AC26 — no credentials and no --dry-run is "could not run", naming that host\'s variables', () => {
    // A NEW convention: no script checks credentials today — scmConfig() hands
    // empty strings to the adapter and the failure surfaces at the network.
    const dir = repo({});
    const ado = run('pr-address.mjs', ['list', '7', '--repo', 'api-neelias'], dir, NO_CREDENTIALS);
    assert.equal(ado.code, 2, `expected 2 (could not run), got ${ado.code}\n${ado.stdout}${ado.stderr}`);
    assert.match(ado.stderr, /ADO_ORG/);
    assert.match(ado.stderr, /ADO_PAT/);
    assert.doesNotMatch(ado.stderr, /GITHUB_/);

    const gh = run('pr-address.mjs', ['list', '7', '--repo', 'api-neelias'], dir, { SDD_SCM_TOOL: 'github' });
    assert.equal(gh.code, 2);
    assert.match(gh.stderr, /GITHUB_OWNER/);
    assert.doesNotMatch(gh.stderr, /ADO_/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('AC27 — list --dry-run works with no credentials at all, and shows the request', () => {
    // Without the short-circuit, AC26 and AC27 are mutually unsatisfiable in CI.
    const dir = repo({});
    const r = run('pr-address.mjs', ['list', '7', '--repo', 'api-neelias', '--dry-run'], dir, NO_CREDENTIALS);
    assert.equal(r.code, 0, `expected 0, got ${r.code}\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /requests that would be sent/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('AC28 — reply --dry-run always refuses, deliberately', () => {
    // The accepted cost of leaving lib/http.mjs alone: under --dry-run the
    // recorder yields no head sha and no comments, so a reply can never be
    // previewed. Pinned here so it stays a decision rather than a surprise.
    //
    // --head is passed because AC44 makes the alternation mandatory: without it
    // this would exit 2 (could not run) and stop proving anything about the
    // preview.
    const { dir, file } = withFrom([{ commentId: '42', body: 'Renamed in a1b2c3d.' }]);
    const r = run('pr-address.mjs',
      ['reply', '7', '--repo', 'api-neelias', '--from', file, '--head', 'aaa', '--dry-run'], dir, GITHUB);
    assert.equal(r.code, 1, `expected 1, got ${r.code}\n${r.stdout}${r.stderr}`);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a missing --repo is a usage error, because this script never shells out to git', () => {
    const dir = repo({});
    const r = run('pr-address.mjs', ['list', '7'], dir, NO_CREDENTIALS);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /--repo is required/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('an unreadable --from is "could not run", not a failed reply', () => {
    const { dir, file } = withFrom({ commentId: '42', body: 'x' });   // an object, not an array
    const r = run('pr-address.mjs',
      ['reply', '7', '--repo', 'api-neelias', '--from', file, '--head', 'aaa', '--dry-run'], dir, GITHUB);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /must be a JSON array/);
    rmSync(dir, { recursive: true, force: true });
  });
});
