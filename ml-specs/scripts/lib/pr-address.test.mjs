// The decisions /ml-specs:pr-address makes — spec 0014, AC22-AC24, AC43, AC47,
// AC49, AC53, AC54.
//
// Pure and in-process: no transport, no child process, no credentials. The CLI
// tests in scripts.test.mjs can only see an exit code, so every property that is
// really about a DECISION is asserted here instead.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planReplies, parseFrom, missingCredentials, printable, printableJson, foldResults,
         FromFileError } from './pr-address.mjs';

const TAG = 'ml-specs:pr-address';

const comment = (id, over = {}) => ({
  id, threadId: id, kind: 'inline', path: 'src/a.js', line: 3, body: 'rename this',
  author: 'ana', updatedAt: 'T1', resolved: null, isOwnReply: false, ...over,
});

describe('planReplies pairs entries with the comments they claim to answer', () => {
  test('AC22 — an entry with no comment behind it is skipped with a reason, and the rest still post', () => {
    // Refusing the whole batch would make one stale id cost every reply; posting
    // silently would let a typo look like a delivered answer.
    const { posts, skipped } = planReplies(
      [comment('42'), comment('43')],
      [{ commentId: '42', body: 'Renamed in a1b2c3d.' },
       { commentId: '999', body: 'answers nothing' },
       { commentId: '43', body: 'Split in b2c3d4e.' }],
    );

    assert.deepEqual(posts.map((p) => p.commentId), ['42', '43']);
    assert.deepEqual(skipped.map((s) => s.commentId), ['999']);
    assert.match(skipped[0].reason, /999/);
    assert.match(skipped[0].reason, /not on this pull request/);
    // The comment travels with the entry, so the caller never re-looks it up.
    assert.equal(posts[0].comment.updatedAt, 'T1');
  });

  test('AC64 — a commentId named twice posts ONCE, and the repeat is reported as skipped', () => {
    // THE HAZARD CACHING OPENED, closed here. governedReply now fetches its
    // evidence once per RUN rather than once per entry (§4.3, AC65), so
    // alreadyAnswered reads the same list for every entry and cannot see a reply
    // land mid-run: two entries naming comment 42 would BOTH post, and the
    // reviewer would be answered twice for one comment. There was no dedup at all
    // — planReplies pushed one post per entry, unconditionally.
    const { posts, skipped } = planReplies(
      [comment('42'), comment('43')],
      [{ commentId: '42', body: 'Renamed in a1b2c3d.' },
       { commentId: '43', body: 'Split in b2c3d4e.' },
       { commentId: '42', body: 'and also this' },
       { commentId: 42, body: 'the same id, written as a number' }],
    );

    // The FIRST one posts; the repeats do not. Which one wins is stated rather
    // than incidental: a file naming a comment twice is an operator error, and
    // answering it with the first entry is the only order the operator can predict.
    assert.deepEqual(posts.map((p) => p.commentId), ['42', '43']);
    assert.deepEqual(posts.map((p) => p.body), ['Renamed in a1b2c3d.', 'Split in b2c3d4e.']);
    assert.equal(skipped.length, 2, 'a repeated commentId was posted rather than skipped');
    for (const s of skipped) {
      assert.match(String(s.reason), /more than once/,
        `the reason does not name the duplication: ${s.reason}`);
      assert.match(String(s.reason), /42/);
    }
    // String and number spellings of the same id are the SAME id — matching is
    // string equality everywhere, and a --from file may write either.
    assert.deepEqual(skipped.map((x) => String(x.commentId)), ['42', '42']);
  });

  test('AC62 — a composite ADO id resolves to its OWN comment, not to a colliding one', () => {
    // ADO numbers comments per thread, so both of these carry the host id 1 and
    // would be indistinguishable flattened. planReplies keys its Map on `id` and
    // keeps the LAST, so with raw ids BOTH entries would resolve to thread 102's
    // comment and one reply would go to the wrong thread. The composite makes the
    // two ids distinct, and this asserts each entry keeps its own comment.
    const a = comment('101.1', { threadId: '101', body: 'rename this' });
    const b = comment('102.1', { threadId: '102', body: 'and split that' });
    const { posts, skipped } = planReplies([a, b], [
      { commentId: '101.1', body: 'Renamed in a1b2c3d.' },
      { commentId: '102.1', body: 'Split in b2c3d4e.' },
    ]);

    assert.deepEqual(skipped, []);
    assert.deepEqual(posts.map((p) => [p.commentId, p.comment.threadId]), [['101.1', '101'], ['102.1', '102']]);
    // Non-vacuity: the raw host ids really do collide, which is what made this
    // invisible to six review rounds of `id * 10` fixtures.
    assert.equal(a.id.split('.').pop(), b.id.split('.').pop());
  });

  test('ids match as strings on both sides, because a --from file writes them as strings', () => {
    const { posts } = planReplies([comment('42')], [{ commentId: 42, body: 'x' }]);
    assert.equal(posts.length, 1);
  });
});

describe('parseFrom', () => {
  test('AC23 — a payload that is not a JSON array throws a typed error naming the problem', () => {
    // Typed, because the CLI maps this to exit 2 (could not run) rather than 1
    // (a reply failed) — spec-gate.mjs:21's convention.
    for (const [payload, pattern] of [
      ['{"commentId":"42","body":"x"}', /must be a JSON array/],
      ['"42"', /must be a JSON array/],
      ['null', /must be a JSON array/],
      ['not json at all', /not valid JSON/],
    ]) {
      assert.throws(() => parseFrom(payload), (e) => {
        assert.ok(e instanceof FromFileError, `${payload} threw ${e.name}, not FromFileError`);
        assert.equal(e.name, 'FromFileError');
        assert.match(e.message, pattern);
        return true;
      }, `${payload} was accepted`);
    }
  });

  test('a well-formed file yields exactly { commentId, body }, ids as strings', () => {
    assert.deepEqual(parseFrom('[{ "commentId": "42", "body": "Renamed in a1b2c3d." }]'),
      [{ commentId: '42', body: 'Renamed in a1b2c3d.' }]);
  });

  test('an entry missing its id or its body is refused rather than posted empty', () => {
    assert.throws(() => parseFrom('[{ "body": "x" }]'), /no commentId/);
    assert.throws(() => parseFrom('[{ "commentId": "42" }]'), /no body/);
    assert.throws(() => parseFrom('[{ "commentId": "42", "body": "  " }]'), /no body/);
  });

  test('AC43 — an HTML comment in a body is stripped before it can be posted', () => {
    // A body that carries `<!-- ml-specs:pr-address 99 T -->` would plant a marker
    // naming a DIFFERENT comment, and alreadyAnswered() would read comment 99 as
    // answered from then on — permanently suppressing that reviewer. `quoted()` in
    // lib/scm.mjs strips for the same reason on the way in; this is the way out. The ONLY marker a reply may carry is the one governedReply()
    // appends for the comment it is actually answering.
    const [entry] = parseFrom(JSON.stringify(
      [{ commentId: '42', body: 'Renamed in a1b2c3d. <!-- ml-specs:pr-address 99 T -->' }]));
    assert.equal(entry.body, 'Renamed in a1b2c3d.');
    assert.ok(!entry.body.includes('ml-specs:pr-address'), `a marker survived: ${entry.body}`);
    assert.ok(!entry.body.includes('<!--'));

    // Multi-line and multiple comments, including one spanning lines.
    const [multi] = parseFrom(JSON.stringify(
      [{ commentId: '42', body: '<!-- a -->done\n<!--\nml-specs:pr-address 99 T\n-->' }]));
    assert.equal(multi.body, 'done');

    // A body that was NOTHING but a marker has no answer left in it, so it is
    // refused rather than posted empty.
    assert.throws(() => parseFrom(JSON.stringify(
      [{ commentId: '42', body: '<!-- ml-specs:pr-address 99 T -->' }])), /no body/);
  });

  test('AC63 — parseFrom routes through stripMarkers, and leaves the operator\'s prose ALONE', () => {
    // THE CALL SITE, and the contract change AC63 made. The corpus property lives
    // in lib/comment-text.test.mjs (AC60); what is asserted here is which export
    // parseFrom actually calls, because the two differ in a way the operator can
    // read: `quoted()` handles host text a renderer will parse and strips every
    // opener, while this handles the tool's OWN reply and strips only the marker
    // delimiters.
    //
    // Running the hardening set here corrupted the answer on its way to the
    // reviewer — `List<?>` posted as `List>` — so these are REGRESSION payloads,
    // not decoration.
    for (const body of [
      'Renamed to List<?> in a1b2c3d.',
      'The signature is now Map<?,?>, per your note.',
      'The fixture is <?xml version="1.0"?> and the parser reads it verbatim.',
      'Deleted the </ stray and kept <div>x</div>.',
    ]) {
      const [entry] = parseFrom(JSON.stringify([{ commentId: '42', body }]));
      assert.equal(entry.body, body,
        `parseFrom rewrote the operator's own reply before posting it: ${JSON.stringify(entry.body)}`);
    }

    // And the invariant it DOES owe: no foreign marker leaves, whichever way the
    // payload is spelled — including the r2 reconstruction and the r5 splice.
    for (const payload of [`<!-- ${TAG} 99 T -->`, `<<!--X-->!-- ${TAG} 99 T <!--Y-->-->`,
                           `<-->!-- ${TAG} 99 T ---->>`]) {
      const [entry] = parseFrom(JSON.stringify([{ commentId: '42', body: `ok ${payload}` }]));
      assert.doesNotMatch(entry.body, /<!--\s*ml-specs:pr-address\b[\s\S]*?-->/,
        `a marker survived parseFrom on ${JSON.stringify(payload)}: ${JSON.stringify(entry.body)}`);
      assert.ok(!entry.body.includes('<!--'), `an opener survived: ${JSON.stringify(entry.body)}`);
      assert.ok(!entry.body.includes('-->'), `a closer survived: ${JSON.stringify(entry.body)}`);
    }
  });

  test('AC55 — an UNTERMINATED delimiter does not survive the fixed point either', () => {
    // The hole a fixed-point loop has BY CONSTRUCTION: the loop removes complete
    // `<!-- ... -->` PAIRS, so a dangling opener has no match at the fixed point
    // and passes straight through. It does its damage in the renderer rather than
    // the parser — on the quote-back path the composed reply becomes
    //   > please fix the bug.
    //   > <!--
    //
    //   Fixed in a1b2c3d.
    //
    //   <!-- ml-specs:pr-address 42 T1 -->
    // and a renderer swallows everything from the bare opener onward. The tool's
    // answer AND its marker go invisible while the RAW body still contains the
    // marker, so `posted: true`, the operator reads "replied", the run exits 0 —
    // and alreadyAnswered() skips that comment forever after.
    const TAG = 'ml-specs:pr-address';

    // The behaviour before the fix, kept so this test is about a REAL difference.
    const dangling = 'Fixed it.\n<!-- dangling';
    let fixedPoint = dangling;
    for (;;) {
      const next = fixedPoint.replace(/<!--[\s\S]*?-->/g, '');
      if (next === fixedPoint) break;
      fixedPoint = next;
    }
    assert.equal(fixedPoint, dangling,
      'a dangling opener is no longer a fixed point of the pair-removing loop, so this proves nothing');

    const [entry] = parseFrom(JSON.stringify([{ commentId: '42', body: dangling }]));
    assert.ok(!entry.body.includes('<!--'), `a dangling opener survived: ${JSON.stringify(entry.body)}`);
    assert.equal(entry.body, 'Fixed it.\n dangling');

    // A stray closer is the same delimiter from the other end. `--!>` is NOT in
    // this stripper's set (AC63: it is a rendering hazard on HOST text, which
    // `quoted()` still removes — not part of the marker class). What matters here
    // is that it cannot close a marker, because no opener is left to pair with it.
    for (const body of ['Fixed it. --> trailing', `Fixed it. <!-- ${TAG} 99 T`]) {
      const [e] = parseFrom(JSON.stringify([{ commentId: '42', body }]));
      assert.ok(!/<!--|-->/.test(e.body), `a delimiter survived: ${JSON.stringify(e.body)}`);
    }
    const [variant] = parseFrom(JSON.stringify([{ commentId: '42', body: `Fixed it. --!> <!-- ${TAG} 99 T -->` }]));
    assert.doesNotMatch(variant.body, /<!--\s*ml-specs:pr-address\b[\s\S]*?-->/,
      `a marker survived beside the --!> variant: ${JSON.stringify(variant.body)}`);

    // And the combination the loop leaves BEHIND: an opener whose closer was
    // consumed by an inner comment.
    const [mixed] = parseFrom(JSON.stringify([{ commentId: '42', body: `ok <!-- <!-- a --> ${TAG} 99 T` }]));
    assert.ok(!mixed.body.includes('<!--'), `a delimiter survived: ${JSON.stringify(mixed.body)}`);
  });

  test('a commentId outside the set `list` emits is refused, because it reaches a URL and a posted body', () => {
    // The accepted set is exactly what lib/scm.mjs can produce. Anything else is a
    // caller error, and refusing it here closes an escape-injection route into the
    // reply output.
    for (const id of ['4 2', '../../x', '42?x=1', 'abc', '4\u001b[2K2']) {
      assert.throws(() => parseFrom(JSON.stringify([{ commentId: id, body: 'ok' }])),
        (e) => {
          assert.ok(e instanceof FromFileError);
          assert.match(e.message, /not a comment id/);
          return true;
        }, `commentId ${JSON.stringify(id)} was accepted`);
    }
    assert.deepEqual(parseFrom('[{ "commentId": " 42 ", "body": "ok" }]'), [{ commentId: '42', body: 'ok' }]);

    // AC62 — the ADO form, which is TWO numbers: the host's id is per-thread, so
    // `list` emits "<threadId>.<commentId>" and the operator copies it verbatim.
    // Refusing it here would make the --from file unwritable on ADO.
    assert.deepEqual(parseFrom('[{ "commentId": "101.1", "body": "ok" }]'), [{ commentId: '101.1', body: 'ok' }]);

    // AC68 — and the GitHub form, which is "<kind>.<hostId>", because the three
    // endpoints the adapter flattens are three independent id spaces. A charset
    // that accepted only digits would make the --from file unwritable on GitHub:
    // EVERY id `list` emits there carries a kind.
    for (const id of ['inline.42', 'conversation.42', 'review-summary.42']) {
      assert.deepEqual(parseFrom(JSON.stringify([{ commentId: id, body: 'ok' }])),
        [{ commentId: id, body: 'ok' }], `commentId ${JSON.stringify(id)} was refused`);
    }
    // The kind is ENUMERATED, not `\w+`: the set stays exactly what scm.mjs emits,
    // and the two composites do not compose.
    for (const id of ['101.', '.1', '101.1.1', '101,1', 'inline.', 'inline.101.1', 'summary.42', 'inline.abc']) {
      assert.throws(() => parseFrom(JSON.stringify([{ commentId: id, body: 'ok' }])), /not a comment id/,
        `commentId ${JSON.stringify(id)} was accepted`);
    }
  });

  test('AC49 — an interleaved payload cannot RECONSTRUCT a marker, because the strip runs to a fixed point', () => {
    // The defect a single non-greedy pass has, verified by execution: removing the
    // two inner comments from
    //   <<!--X-->!-- ml-specs:pr-address 99 T <!--Y-->-->
    // leaves `<` + `!-- ml-specs:pr-address 99 T ` + `-->` — exactly
    // replyMarker('99','T'), a valid marker for a comment this reply is not about.
    // AC43's payload was naive enough to be removed in one pass, so it passed
    // while this property was false.
    const TAG = 'ml-specs:pr-address';
    const payload = `Renamed in a1b2c3d. <<!--X-->!-- ${TAG} 99 T <!--Y-->-->`;

    // What the single-pass implementation used to do, kept here so the assertion
    // below is about a REAL difference rather than a hypothetical one.
    assert.equal(payload.replace(/<!--[\s\S]*?-->/g, '').trim(),
      `Renamed in a1b2c3d. <!-- ${TAG} 99 T -->`,
      'the payload no longer reconstructs a marker in one pass, so this test proves nothing');

    const [entry] = parseFrom(JSON.stringify([{ commentId: '42', body: payload }]));
    assert.ok(!entry.body.includes(TAG), `a reconstructed marker survived: ${entry.body}`);
    assert.ok(!entry.body.includes('<!--'), `an HTML comment survived: ${entry.body}`);
    assert.equal(entry.body, 'Renamed in a1b2c3d.');

    // Deeper nesting is the same property, not a special case.
    const [deep] = parseFrom(JSON.stringify([{ commentId: '42',
      body: `ok <<!--a--><!--b-->!-- ${TAG} 7 T <!--c--><!--d-->-->` }]));
    assert.ok(!deep.body.includes(TAG), `a reconstructed marker survived: ${deep.body}`);
  });
});

describe('the reply run is folded into what the operator is told', () => {
  const refusal = (commentId, message) => ({ commentId, kind: 'refused', result: null, error: new Error(message) });

  test('AC53 — a governedReply refusal is a FAILURE, never a delivery, and the run exits 1', () => {
    // THE MUTATION THIS EXISTS FOR. Inline in the CLI, rewriting the catch around
    // governedReply() so every refusal was reported as `posted: true` passed
    // 331/331 and exited 0 — every refused reply announced to the operator as
    // delivered. That is the silent false receipt §1 of the spec exists to
    // prevent, and it is one assertion once the fold is a function.
    const folded = foldResults([
      { commentId: '41', result: { posted: true, skipped: null }, error: null },
      refusal('42', 'refusing to reply about work that is not pushed'),
      { commentId: '43', result: { posted: false, skipped: 'comment 43 already answered at T1' }, error: null },
    ]);

    assert.deepEqual(folded.failed.map((f) => f.commentId), ['42']);
    assert.ok(!folded.posted.some((p) => p.commentId === '42'),
      'a refused reply was reported to the operator as delivered');
    assert.match(folded.failed[0].reason, /not pushed/);
    assert.equal(folded.exit, 1, 'a run in which a reply was refused must not exit 0');

    // The other two buckets are unharmed: a refusal must not hide the replies that
    // did land, nor turn an idempotent skip into a failure.
    assert.deepEqual(folded.posted.map((p) => p.commentId), ['41']);
    assert.deepEqual(folded.skipped.map((x) => x.commentId), ['43']);
  });

  test('an outcome that claims BOTH posted and an error is still a failure', () => {
    // `error` decides, alone. An outcome that threw delivered nothing, whatever
    // else the object says — which is the exact shape the mutation produced.
    const folded = foldResults([{ commentId: '42', result: { posted: true }, error: new Error('refused') }]);
    assert.deepEqual(folded.failed.map((f) => f.commentId), ['42']);
    assert.deepEqual(folded.posted, []);
    assert.equal(folded.exit, 1);
  });

  test('an outcome that shows no delivery at all fails closed', () => {
    // Neither posted nor skipped nor errored: a reply that cannot show it was
    // delivered is not a delivery.
    const folded = foldResults([{ commentId: '42', result: {}, error: null }]);
    assert.equal(folded.failed.length, 1);
    assert.equal(folded.exit, 1);
  });

  test('an entry with no comment behind it is a failure, and an all-skipped run is not', () => {
    // planReplies' skips arrive as outcomes too, so the exit code has ONE source.
    // §4.2.3: the remaining entries still post and the run exits 1.
    const unmatched = foldResults([{ commentId: '999', kind: 'unmatched',
      error: 'comment 999 is not on this pull request' }]);
    assert.equal(unmatched.failed[0].kind, 'unmatched');
    assert.match(unmatched.failed[0].reason, /not on this pull request/);
    assert.equal(unmatched.exit, 1);

    // Everything already answered is a 0: deferral and idempotency are first-class
    // outcomes, not failures.
    assert.equal(foldResults([{ commentId: '42', result: { skipped: 'already answered at T1' } }]).exit, 0);
    assert.equal(foldResults([]).exit, 0);
    assert.equal(foldResults(undefined).exit, 0);
  });
});

describe('host text is stripped of control characters before it reaches a terminal', () => {
  test('AC47 — ANSI/CSI escapes in a comment body do not survive printable()', () => {
    // A commenter otherwise owns the operator's escape sequences in the very
    // summary the triage decision is made from: cursor moves that overwrite the
    // line above, colour that disguises one comment as another.
    //
    // Asserted HERE rather than through the CLI on purpose, and for the same
    // reason AC28 records: under --dry-run the recorder supplies no comments, so
    // the non-JSON `list` path prints no comment line at all and an execFileSync
    // test could only observe an empty table. scripts/pr-address.mjs:98-99 is the
    // single caller.
    const ESC = String.fromCharCode(27);
    const body = `before${ESC}[2Khidden${ESC}[31m red ${String.fromCharCode(7)}${String.fromCharCode(127)}after`;
    const out = printable(body);

    assert.ok(!/[\u0000-\u001f\u007f]/.test(out), `a control character survived: ${JSON.stringify(out)}`);
    assert.ok(!out.includes(ESC), 'the escape character survived');
    // Only the control characters go: the text itself is still readable, so the
    // operator sees what was written rather than a blanked cell.
    assert.equal(out, 'before[2Khidden[31m red after');
    assert.equal(printable('plain text'), 'plain text');
    assert.equal(printable(null), '');
  });

  test('AC54 — the C1 range goes too, because \\x9b is a single-byte CSI', () => {
    // C0 alone leaves half the escape space in the commenter's hands: a terminal
    // reading Latin-1 or UTF-8 acts on \x9b exactly as it does on ESC-[, so a
    // class of /[\x00-\x1f\x7f]/ strips the visible attack and passes the
    // invisible one.
    const c1 = String.fromCharCode(0x9b);        // CSI
    const osc = String.fromCharCode(0x9d);       // OSC
    const out = printable(`before${c1}2Kmid${osc}0;titleafter`);

    assert.ok(!/[\u0080-\u009f]/.test(out), `a C1 control survived: ${JSON.stringify(out)}`);
    assert.equal(out, 'before2Kmid0;titleafter');

    // Ordinary text above the C1 block is NOT collateral: an accented path or a
    // reviewer's name must still be readable.
    assert.equal(printable('café — src/naïve.js'), 'café — src/naïve.js');
  });

  test('AC66 — printableJson keeps the newlines the JSON sink needs, and still strips C1', () => {
    // printable() strips C0, and C0 INCLUDES `\n`. Run over a serialized document
    // it deleted the formatter's own newlines: `printable(JSON.stringify(x, null,
    // 2))` collapsed onto one line, which made the `null, 2` argument dead and the
    // piped payload unreadable — while adding nothing, because JSON.stringify has
    // already escaped every C0 character inside a string.
    const payload = JSON.stringify({ posted: [], failed: [{ commentId: '42', reason: 'nope' }] }, null, 2);
    assert.ok(payload.includes('\n'), 'the fixture is not pretty-printed, so this proves nothing');
    assert.equal(printableJson(payload), payload);
    assert.deepEqual(JSON.parse(printableJson(payload)), JSON.parse(payload));
    assert.ok(printableJson(payload).split('\n').length > 3,
      'the JSON sink collapsed its own formatting onto one line');

    // NON-VACUITY: printable() really does eat those newlines, which is the bug.
    assert.ok(!printable(payload).includes('\n'),
      'printable no longer strips newlines, so the two sinks no longer differ');

    // And the C1 half is unchanged: \x9b is a single-byte CSI, and JSON.stringify
    // passes it THROUGH verbatim, so this sink is the only thing removing it.
    const c1 = String.fromCharCode(0x9b);
    const hostile = JSON.stringify({ reason: `before${c1}2Kafter` }, null, 2);
    assert.ok(hostile.includes(c1), 'JSON.stringify now escapes C1, so this guard proves nothing');
    assert.ok(!/[\u0080-\u009f]/.test(printableJson(hostile)), 'a C1 control reached the operator');
    assert.equal(printableJson(`a${String.fromCharCode(0x7f)}b`), 'ab', 'DEL survives this sink');
  });

  test('AC54 — a path:line column is host-supplied text too', () => {
    // scripts/pr-address.mjs builds `where` from c.path and c.line, both of which
    // come from the host — an ADO threadContext.filePath is whatever the host
    // returned. The CLI's routing of all three columns through printable() is
    // pinned structurally in pr-address-wiring.test.mjs; this is the function's
    // half.
    const ESC = String.fromCharCode(27);
    assert.equal(printable(`src/a${ESC}[2K.js:12`), 'src/a[2K.js:12');
  });
});

describe('missingCredentials names the resolved host, never the other one', () => {
  test('AC24 — GitHub is told about GITHUB_*, ADO about ADO_*', () => {
    const gh = missingCredentials('github', {});
    assert.match(gh, /github/);
    assert.match(gh, /GITHUB_OWNER/);
    assert.match(gh, /GITHUB_TOKEN/);
    assert.ok(!/ADO_/.test(gh), `the GitHub message advertises ADO variables: ${gh}`);

    const ado = missingCredentials('ado-repos', {});
    assert.match(ado, /ado-repos/);
    for (const v of ['ADO_ORG', 'ADO_PROJECT', 'ADO_PAT']) assert.match(ado, new RegExp(v));
    assert.ok(!/GITHUB_/.test(ado), `the ADO message advertises GitHub variables: ${ado}`);
  });

  test('only the absent variables are named', () => {
    assert.equal(missingCredentials('github', { owner: 'motivity', token: 'ghp_x' }), null);
    const partial = missingCredentials('github', { owner: 'motivity', token: '  ' });
    assert.match(partial, /GITHUB_TOKEN/);
    assert.ok(!/GITHUB_OWNER/.test(partial));
  });

  test('an unrecognised tool falls back to ADO, matching scmConfig\'s own silent else', () => {
    assert.match(missingCredentials('gitub', {}), /ado-repos/);
  });
});
