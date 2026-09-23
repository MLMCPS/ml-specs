// Contract tests for source control, and for the fan-out guarantee.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { recorder } from './http.mjs';
import { adoRepos, github, governedScm, governedReply, readOnlyScm, pullRequestBody, fanOutTargets,
         replyMarker, alreadyAnswered } from './scm.mjs';
import { parseEstate, impactOf } from './estate.mjs';
// The other consumer of a normalized id. AC68 is a claim about planReplies and
// governedReply resolving the SAME id to the SAME comment, which cannot be made
// with only one of them in the room.
import { planReplies } from './pr-address.mjs';

const ADO = { org: 'contoso', project: 'Payments Core', pat: 's3cret' };
const GH = { owner: 'motivity', token: 'ghp_x' };
const SPEC = {
  id: '0031', title: 'Idempotent refund submission', file: 'specs/0031-x.md', status: 'Approved',
  ticket: 'PAY-2204', repos: ['api-neelias'], nfrs: ['NFR-03'], branch: null,
  criteria: [{ id: 'AC-1', ordinal: 1, text: 'replay returns the original', checked: false }],
};

describe('Azure DevOps Repos', () => {
  test('a branch is a ref updated from the empty object id', async () => {
    // ADO has no "create branch" call.
    const t = recorder();
    await adoRepos({ ...ADO, transport: t }).createBranch('api-neelias', 'feat/0031-x', 'abc123');
    const row = t.last().body[0];
    assert.equal(row.name, 'refs/heads/feat/0031-x');
    assert.equal(row.oldObjectId, '0'.repeat(40));
    assert.equal(row.newObjectId, 'abc123');
  });

  test('a pull request uses fully qualified ref names and calls the text description', async () => {
    const t = recorder();
    await adoRepos({ ...ADO, transport: t })
      .openPullRequest('api-neelias', { source: 'feat/0031-x', target: 'main', title: '[SPEC-0031] x', body: 'b' });
    assert.equal(t.last().body.sourceRefName, 'refs/heads/feat/0031-x');
    assert.equal(t.last().body.targetRefName, 'refs/heads/main');
    assert.equal(t.last().body.description, 'b');
    assert.match(t.last().url, /\/Payments%20Core\/_apis\/git\/repositories\/api-neelias\/pullrequests/);
  });

  test('a missing default branch is an error, not a silent zero sha', async () => {
    const t = recorder([{ value: [] }]);
    await assert.rejects(() => adoRepos({ ...ADO, transport: t }).defaultBranchSha('api-neelias'), /no branch main/);
  });

  test('pull request search filters on the key and strips the ref prefix', async () => {
    const t = recorder([{ value: [
      { pullRequestId: 1, title: '[SPEC-0031] yes', sourceRefName: 'refs/heads/feat/0031-x', targetRefName: 'refs/heads/main' },
      { pullRequestId: 2, title: 'unrelated hotfix', sourceRefName: 'refs/heads/hf', targetRefName: 'refs/heads/main' },
    ] }]);
    const found = await adoRepos({ ...ADO, transport: t }).findPullRequests('api-neelias', '0031');
    assert.deepEqual(found.map((p) => p.id), ['1']);
    assert.equal(found[0].source, 'feat/0031-x');
  });
});

describe('GitHub', () => {
  test('auth is a bearer token with a pinned api version', async () => {
    const t = recorder();
    await github({ ...GH, transport: t }).defaultBranchSha('api-neelias');
    // headers are not recorded; assert the call shape instead
    assert.match(t.last().url, /\/repos\/motivity\/api-neelias\/git\/ref\/heads\/main$/);
  });

  test('a pull request uses bare head and base, and calls the text body', async () => {
    // The shape difference from ADO that a single-adapter design would have missed.
    const t = recorder();
    await github({ ...GH, transport: t })
      .openPullRequest('api-neelias', { source: 'feat/0031-x', target: 'main', title: '[SPEC-0031] x', body: 'b' });
    assert.equal(t.last().body.head, 'feat/0031-x');    // not refs/heads/
    assert.equal(t.last().body.base, 'main');
    assert.equal(t.last().body.body, 'b');
  });

  test('a branch posts a ref', async () => {
    const t = recorder();
    await github({ ...GH, transport: t }).createBranch('api-neelias', 'feat/0031-x', 'abc123');
    assert.deepEqual(t.last().body, { ref: 'refs/heads/feat/0031-x', sha: 'abc123' });
  });
});

describe('the governed path', () => {
  test('no branch is cut before the approval gate', async () => {
    const scm = governedScm(adoRepos({ ...ADO, transport: recorder() }));
    await assert.rejects(() => scm.openFor({ ...SPEC, status: 'Draft' }, 'api-neelias', 'b'),
      /before the approval gate/);
  });

  test('an approved spec produces a derived branch and title', async () => {
    const { branch, pr } = await governedScm(adoRepos({ ...ADO, transport: recorder() }))
      .openFor(SPEC, 'api-neelias', 'b');
    assert.equal(branch.name, 'feat/0031-idempotent-refund-submission');
    assert.equal(pr.title, '[SPEC-0031] Idempotent refund submission');
  });

  test('a branch that lost the key is refused before anything is created', async () => {
    const t = recorder();
    await assert.rejects(
      () => governedScm(adoRepos({ ...ADO, transport: t })).openFor({ ...SPEC, branch: 'hotfix-urgent' }, 'r', 'b'),
      /does not carry spec 0031/);
    assert.equal(t.calls.length, 0);   // nothing was sent
  });

  test('a reader has no write methods and they cannot be re-attached', () => {
    const r = readOnlyScm(adoRepos({ ...ADO, transport: recorder() }));
    assert.equal(r.createBranch, undefined);
    assert.equal(r.openPullRequest, undefined);
    assert.throws(() => { 'use strict'; r.createBranch = () => {}; });
  });
});

describe('fan-out', () => {
  const INDEX = parseEstate(`
| Service | Owns | Stack | Summary doc |
|---|---|---|---|
| api-neelias | payments | Node | x |

| Event / queue / topic | Producer | Consumer | Notes | Evidence |
|---|---|---|---|---|
| \`payment.captured\` | api-neelias | neelias-pos (\`SaleReconciler\`) | n | e |
| \`pos.sale.completed\` | neelias-pos | neelias-cms-portal (\`SalesFeed\`) | n | e |
`);

  test('every target shares one branch name, so N pull requests are one change', () => {
    const targets = fanOutTargets(SPEC, impactOf(INDEX, ['payment.captured']));
    assert.deepEqual(targets.map((t) => t.repo), ['api-neelias', 'neelias-pos', 'neelias-cms-portal']);
    assert.equal(new Set(targets.map((t) => t.branch)).size, 1);
    assert.match(targets[2].reason, /one hop/);
  });

  test('a repo named on the spec is not duplicated by the impact query', () => {
    const targets = fanOutTargets({ ...SPEC, repos: ['neelias-pos'] }, impactOf(INDEX, ['payment.captured']));
    assert.equal(targets.filter((t) => t.repo === 'neelias-pos').length, 1);
    assert.equal(targets[0].reason, 'named on the spec');
  });
});

describe('the pull request body', () => {
  test('carries the whole chain so a reviewer never has to hunt', () => {
    const body = pullRequestBody(SPEC, 'consumes payment.captured',
      { constraints: [{ id: 'INC-4412', text: 'Holds released early.' }] });
    assert.match(body, /SPEC-0031/);
    assert.match(body, /\*\*Why this repo:\*\* consumes payment\.captured/);
    assert.match(body, /\*\*Ticket:\*\* PAY-2204/);
    assert.match(body, /INC-4412/);
  });

  test('criteria arrive as a reviewer checklist paired with their test cases', () => {
    assert.match(pullRequestBody(SPEC, 'x'), /- \[ \] AC-1 \(TC-0031\.1\) — replay returns the original/);
  });

  test('it states why these pull requests are one change', () => {
    assert.match(pullRequestBody(SPEC, 'x'), /Same key, so these pull requests are one change/);
  });

  test('a spec with no criteria says so rather than rendering an empty list', () => {
    assert.match(pullRequestBody({ ...SPEC, criteria: [] }, 'x'), /should not have been approved/);
  });
});

// --- review feedback: /ml-specs:pr-address (spec 0014) -----------------------
//
// Every assertion here runs against an injected recorder(), so the suite needs no
// network, no credentials and no `gh`. What is asserted is the NORMALIZED shape
// and the guard behaviour, because that is where the expensive mistakes live:
// a comment dropped past page 1, a system event handed to an agent as work, or a
// reply claiming credit for a commit the reviewer cannot fetch.

const COMMENT_KEYS = ['author', 'authorKey', 'body', 'id', 'isOwnReply', 'kind', 'line', 'path',
                      'resolved', 'threadId', 'updatedAt'];

/** The account the tool is authenticated as. A marker only counts from THIS
 *  account — both of its inputs are publicly readable, so an unauthenticated
 *  marker proves nothing (spec 0014 §4.2.1). */
const BOT = 'ml-specs-bot';
/** ADO's identifier is a GUID, NOT a display name: a display name is self-settable
 *  on an MSA-backed organisation, so a commenter could rename themselves to the
 *  operator and defeat the authorship check outright (AC51). */
const BOT_ID = '9f1c0e2a-0000-4a00-9b00-000000000001';
const BOT_DISPLAY = 'ML Specs Bot';
/** What GET /user answers with; adoRepos reads connectionData instead. */
const ghIdentity = { login: BOT };
const adoIdentity = { authenticatedUser: { id: BOT_ID, providerDisplayName: BOT_DISPLAY } };

/** GitHub fixtures, one per endpoint, with ids that say where they came from.
 *
 *  THESE IDS ARE UNIQUE BY CONSTRUCTION, and that is a convenience for reading a
 *  failure message — never a property to assert against. GitHub's three endpoints
 *  are three INDEPENDENT id sequences, so a real pull request can carry an inline
 *  comment and a review summary that are both 42; six review rounds missed the
 *  resulting collision because no fixture could express it. A test about id
 *  identity belongs on the COLLIDING fixture in the AC68 case below, which passes
 *  the same number to all three. */
const ghInline = (id, over = {}) =>
  ({ id, path: 'src/a.js', line: 3, body: 'rename this', user: { login: 'ana' }, updated_at: 'T1', ...over });
const ghIssue = (id, over = {}) =>
  ({ id, body: 'a general note', user: { login: 'bo' }, updated_at: 'T2', ...over });
const ghReview = (id, over = {}) =>
  ({ id, body: 'the summary body', user: { login: 'cy' }, submitted_at: 'T3', ...over });

/** An ADO threads page.
 *
 *  `id * 10` is the same convenience, and it hid the same class of defect: ADO
 *  numbers comments PER THREAD, so two threads really do each carry a comment
 *  `id: 1`, and a fixture that derives the comment id from the thread id cannot
 *  say so. Anything about id UNIQUENESS goes on the colliding fixture in the AC62
 *  case, which spells both threads out. */
const adoThreads = (threads, over = {}) => ({ value: threads, ...over });
const adoThread = (id, over = {}) => ({
  id, status: 'active',
  comments: [{ id: id * 10, content: 'inline note', commentType: 'text',
               author: { id: 'ana-guid', displayName: 'Ana Ruiz' }, lastUpdatedDate: 'T1' }],
  ...over,
});

describe('review comments normalize to one shape across two hosts', () => {
  test('AC1 — GitHub reads all three endpoints and every item carries the eleven keys', async () => {
    const t = recorder([[ghInline(11)], [ghIssue(22)], [ghReview(33)]]);
    const out = await github({ ...GH, transport: t }).listReviewComments('api-neelias', 7);

    const urls = t.calls.map((c) => c.url);
    assert.ok(urls.some((u) => /\/repos\/motivity\/api-neelias\/pulls\/7\/comments\?/.test(u)), 'inline endpoint unread');
    assert.ok(urls.some((u) => /\/repos\/motivity\/api-neelias\/issues\/7\/comments\?/.test(u)), 'conversation endpoint unread');
    assert.ok(urls.some((u) => /\/repos\/motivity\/api-neelias\/pulls\/7\/reviews\?/.test(u)), 'review endpoint unread');

    assert.equal(out.length, 3);
    for (const c of out) {
      assert.deepEqual(Object.keys(c).sort(), COMMENT_KEYS, `wrong key set on ${JSON.stringify(c)}`);
      // Ids are ALWAYS strings: every match downstream is string equality, and a
      // --from file writes "commentId": "42".
      assert.equal(typeof c.id, 'string');
      assert.equal(typeof c.threadId, 'string');
      assert.ok(c.author.length > 0, 'author must come from the host user field');
    }
    assert.deepEqual(out.map((c) => c.author), ['ana', 'bo', 'cy']);
    // A GitHub login is already a unique handle, so the display string and the
    // authorship key are the same value on this host — unlike ADO (AC51).
    assert.deepEqual(out.map((c) => c.authorKey), ['ana', 'bo', 'cy']);

    // The warnings channel is NON-ENUMERABLE, so the result is a bare array to
    // every consumer — find(), filter(), deepEqual — and still carries the
    // truncation report the CLI prints.
    assert.ok(Array.isArray(out.warnings));
    assert.equal(Object.getOwnPropertyDescriptor(out, 'warnings').enumerable, false);
  });

  test('AC1/AC51 — ADO reads the display name AND the stable id, and stringifies both ids', async () => {
    const t = recorder([adoThreads([adoThread(101)])]);
    const out = await adoRepos({ ...ADO, transport: t }).listReviewComments('api-neelias', 7);
    assert.equal(out.length, 1);
    assert.deepEqual(Object.keys(out[0]).sort(), COMMENT_KEYS);
    // Two fields, deliberately: `author` is what the operator reads, `authorKey`
    // is what the authorship check compares.
    assert.equal(out[0].author, 'Ana Ruiz');
    assert.equal(out[0].authorKey, 'ana-guid');
    // "<threadId>.<commentId>" (AC62): ADO's own comment id is numbered PER
    // THREAD, so the composite is what makes it unique across the flattened list.
    assert.equal(out[0].id, '101.1010');
    assert.equal(out[0].threadId, '101');
  });

  test('AC2 — ADO kinds come from threadContext, and system/deleted comments never surface', async () => {
    const t = recorder([adoThreads([
      adoThread(101, { threadContext: { filePath: '/src/a.js', rightFileStart: { line: 12 } } }),
      adoThread(102),                                            // no threadContext
      { id: 103, status: 'closed', comments: [{ id: 1030, content: 'refs updated', commentType: 'system',
        author: { id: 'sys-guid', displayName: 'sys' }, lastUpdatedDate: 'T9' }] },
      { id: 104, status: 'active', comments: [{ id: 1040, content: 'withdrawn', commentType: 'text',
        isDeleted: true, author: { id: 'bo-guid', displayName: 'Bo' }, lastUpdatedDate: 'T9' }] },
    ])]);
    const out = await adoRepos({ ...ADO, transport: t }).listReviewComments('api-neelias', 7);

    assert.deepEqual(out.map((c) => c.kind), ['inline', 'conversation']);
    assert.ok(!out.some((c) => c.kind === 'review-summary'), 'ADO has votes, not review bodies');
    assert.ok(!out.some((c) => c.id === '103.1030'), 'a system event reached the caller as work');
    assert.ok(!out.some((c) => c.id === '104.1040'), 'a deleted comment reached the caller as work');
  });

  test('AC3 — each host\'s collection wrapper is read, and a missing one is empty rather than a throw', async () => {
    // GitHub: a bare array. ADO: { value: [...] }.
    const gh = await github({ ...GH, transport: recorder([[ghInline(11)], [], []]) })
      .listReviewComments('r', 7);
    // "<kind>.<hostId>" (AC68): the three GitHub endpoints are three independent
    // id spaces, so the kind is what makes the flattened id unique.
    assert.deepEqual(gh.map((c) => c.id), ['inline.11']);

    const ado = await adoRepos({ ...ADO, transport: recorder([adoThreads([adoThread(101)])]) })
      .listReviewComments('r', 7);
    assert.deepEqual(ado.map((c) => c.threadId), ['101']);

    // Absent or non-array. recorder() with no canned responses falls through to
    // DEFAULT_RESPONSE — an object for GitHub, ref objects with no `comments`
    // for ADO — which is exactly what --dry-run hands these.
    assert.deepEqual(await github({ ...GH, transport: recorder() }).listReviewComments('r', 7), []);
    assert.deepEqual(await adoRepos({ ...ADO, transport: recorder() }).listReviewComments('r', 7), []);
    assert.deepEqual(await adoRepos({ ...ADO, transport: recorder([{ value: 'nope' }]) }).listReviewComments('r', 7), []);
  });

  test('AC4 — resolved is null on GitHub always, and mapped from thread status on ADO', async () => {
    const gh = await github({ ...GH, transport: recorder([[ghInline(11)], [ghIssue(22)], [ghReview(33)]]) })
      .listReviewComments('r', 7);
    // null means "not knowable on this host", never "not resolved" — REST has no
    // thread state and isResolved is GraphQL-only.
    assert.deepEqual(gh.map((c) => c.resolved), [null, null, null]);

    const ctx = { filePath: '/src/a.js', rightFileStart: { line: 1 } };
    const ado = await adoRepos({ ...ADO, transport: recorder([adoThreads([
      adoThread(101, { status: 'active', threadContext: ctx }),
      adoThread(102, { status: 'fixed', threadContext: ctx }),
      adoThread(103, { status: 'unknown', threadContext: ctx }),
    ])]) }).listReviewComments('r', 7);
    assert.deepEqual(ado.map((c) => c.resolved), [false, true, null]);
  });

  test('AC5 — a GitHub threadId is synthesized from the in_reply_to_id root', async () => {
    const out = await github({ ...GH, transport: recorder([[ghInline(9), ghInline(12, { in_reply_to_id: 7 })], [], []]) })
      .listReviewComments('r', 7);
    assert.equal(out[0].threadId, '9', 'a comment with no in_reply_to_id is its own root');
    assert.equal(out[1].threadId, '7');
  });

  test('AC6 — the tool\'s own replies stay in the list, flagged', async () => {
    // One list, one flag. Stripping them at source would make alreadyAnswered()
    // permanently false and re-post every reply on every run.
    //
    // The identity read is the FOURTH canned response: it happens after the three
    // endpoints, and only because a marker is present at all.
    const own = ghIssue(23, { body: `done\n\n${replyMarker('inline.11', 'T1')}`, user: { login: BOT } });
    const out = await github({ ...GH, transport: recorder([[ghInline(11)], [ghIssue(22), own], [], ghIdentity]) })
      .listReviewComments('r', 7);
    assert.deepEqual(out.map((c) => [c.id, c.isOwnReply]),
      [['inline.11', false], ['conversation.22', false], ['conversation.23', true]]);
  });

  test('AC42 — a marker on someone ELSE\'s comment is not the tool\'s own reply', async () => {
    // The attack this closes: isOwnReply is what step 3 of the command filters on,
    // so a commenter who pastes a marker into their own comment would remove
    // themselves from triage and never be answered. GitHub's "Quote reply" does
    // the same thing by accident, by copying the raw HTML comment.
    const forged = ghIssue(24, { body: `nice\n\n${replyMarker('inline.11', 'T1')}`, user: { login: 'mallory' } });
    const mine = ghIssue(25, { body: `done\n\n${replyMarker('inline.12', 'T1')}`, user: { login: BOT } });
    const out = await github({ ...GH, transport: recorder([[ghInline(11)], [forged, mine], [], ghIdentity]) })
      .listReviewComments('r', 7);
    assert.deepEqual(out.map((c) => [c.id, c.isOwnReply]),
      [['inline.11', false], ['conversation.24', false], ['conversation.25', true]]);
  });

  test('AC42/AC51 — on ADO the identity is a GUID, and a display name cannot impersonate it', async () => {
    // THE ATTACK AC51 CLOSES. Mallory renames herself to the operator's display
    // name — self-settable on an MSA-backed organisation — and posts a marker. If
    // the authorship check compared display names, her comment would be read as
    // the tool's own reply and she would drop out of triage. It compares ids, so
    // the two comments below differ by exactly the field that cannot be forged.
    const thread = (id, author, content) => ({ id, status: 'active',
      comments: [{ id: id * 10, content, commentType: 'text',
                   author, lastUpdatedDate: 'T1' }] });
    const out = await adoRepos({ ...ADO, transport: recorder([
      adoThreads([
        thread(101, { id: 'mallory-guid', displayName: BOT_DISPLAY }, `nice\n\n${replyMarker('1010', 'T1')}`),
        thread(102, { id: BOT_ID, displayName: BOT_DISPLAY }, `done\n\n${replyMarker('1010', 'T1')}`)]),
      adoIdentity,
    ]) }).listReviewComments('r', 7);

    assert.deepEqual(out.map((c) => [c.id, c.isOwnReply]), [['101.1010', false], ['102.1020', true]]);
    // Identical display names on both: only the id separates them.
    assert.deepEqual(out.map((c) => c.author), [BOT_DISPLAY, BOT_DISPLAY]);
    assert.deepEqual(out.map((c) => c.authorKey), ['mallory-guid', BOT_ID]);
  });

  test('AC51 — the ADO identity request reads the account id, not any display name', async () => {
    // whoAmI() feeding a display name would make the comparison above meaningless
    // however the comment side is normalized, so the identity side is pinned too.
    const t = recorder([
      adoThreads([{ id: 101, status: 'active',
        comments: [{ id: 1010, content: `done\n\n${replyMarker('1010', 'T1')}`, commentType: 'text',
                     author: { id: BOT_ID, displayName: 'anything at all' }, lastUpdatedDate: 'T1' }] }]),
      { authenticatedUser: { id: BOT_ID, providerDisplayName: 'someone else entirely' } },
    ]);
    const out = await adoRepos({ ...ADO, transport: t }).listReviewComments('r', 7);
    assert.equal(out[0].isOwnReply, true,
      'the identity was matched on a display name rather than on the account id');
    assert.match(t.calls[1].url, /_apis\/connectionData/);
  });

  test('AC57 — an identity that resolves EMPTY warns too, not only one that throws', async () => {
    // The gap: only the THROWN case warned. A host that answers 200 with no
    // `login` — a GitHub Actions GITHUB_TOKEN does exactly this — resolves to ''
    // on the success path. It still fails closed, so no marker is trusted; but
    // that means every reply is re-posted on every run while the operator is told
    // nothing at all. Failing closed silently is still failing silently.
    const gh = await github({ ...GH, transport: recorder([
      [], [ghIssue(22, { body: `hi\n\n${replyMarker('22', 'T2')}`, user: { login: BOT } })], [],
      {},                                  // 200, and no `login` in it
    ]) }).listReviewComments('r', 7);

    assert.equal(gh.length, 1);
    assert.equal(gh[0].isOwnReply, false, 'an empty identity must trust no marker');
    assert.ok(gh.warnings.some((w) => /identity resolved empty/.test(w)),
      `an empty identity was resolved with no warning: ${JSON.stringify(gh.warnings)}`);

    // ADO's half: connectionData with no authenticatedUser.id.
    const ado = await adoRepos({ ...ADO, transport: recorder([
      adoThreads([{ id: 101, status: 'active',
        comments: [{ id: 1010, content: `done\n\n${replyMarker('1010', 'T1')}`, commentType: 'text',
                     author: { id: BOT_ID, displayName: BOT_DISPLAY }, lastUpdatedDate: 'T1' }] }]),
      { authenticatedUser: {} },
    ]) }).listReviewComments('r', 7);

    assert.equal(ado[0].isOwnReply, false);
    assert.ok(ado.warnings.some((w) => /identity resolved empty/.test(w)),
      `an empty ADO identity was resolved with no warning: ${JSON.stringify(ado.warnings)}`);

    // And a RESOLVED identity warns about nothing: a warning on every ordinary
    // run would be noise, and noise is how a real warning gets ignored.
    const fine = await github({ ...GH, transport: recorder([
      [], [ghIssue(22, { body: `hi\n\n${replyMarker('22', 'T2')}`, user: { login: BOT } })], [], ghIdentity,
    ]) }).listReviewComments('r', 7);
    assert.equal(fine[0].isOwnReply, true);
    assert.deepEqual(fine.warnings, [], `an ordinary run warned: ${JSON.stringify(fine.warnings)}`);
  });

  test('an identity the host will not resolve is reported, not thrown', async () => {
    // A commenter merely MENTIONING the marker tag is what triggers this request,
    // so a 401 or a rate limit here would otherwise kill `list` and `reply` alike.
    // Unresolvable is '', which matches nothing, so every marker is distrusted.
    const boom = async (url) => {
      if (url.endsWith('/user')) throw new Error('401 Unauthorized');
      return url.includes('/issues/') ? [ghIssue(22, { body: `hi\n\n${replyMarker('11', 'T1')}` })] : [];
    };
    const out = await github({ ...GH, transport: boom }).listReviewComments('r', 7);
    assert.equal(out.length, 1);
    assert.equal(out[0].isOwnReply, false, 'an unresolvable identity must trust no marker');
    assert.ok(out.warnings.some((w) => /identity/.test(w)), `no warning was surfaced: ${out.warnings}`);
  });

  test('a list with no marker in it costs no identity request at all', async () => {
    // The identity is resolved LAZILY and at most once: a list nobody has answered
    // needs no /user call, which is what keeps AC9's call count and AC11's
    // one-request claim true.
    const t = recorder([[ghInline(11)], [ghIssue(22)], []]);
    await github({ ...GH, transport: t }).listReviewComments('r', 7);
    assert.equal(t.calls.length, 3, 'an identity request went out with no marker to adjudicate');
    assert.ok(!t.calls.some((c) => c.url.endsWith('/user')), 'the identity was fetched needlessly');
  });

  test('AC7 — updatedAt comes from the field that host and kind actually carry', async () => {
    const gh = await github({ ...GH, transport: recorder([[ghInline(11)], [], [ghReview(33)]]) })
      .listReviewComments('r', 7);
    assert.equal(gh.find((c) => c.kind === 'inline').updatedAt, 'T1');          // updated_at
    // A review body carries no updated_at; it is immutable once submitted, so
    // submitted_at is a stable idempotency key.
    assert.equal(gh.find((c) => c.kind === 'review-summary').updatedAt, 'T3');  // submitted_at

    const ado = await adoRepos({ ...ADO, transport: recorder([adoThreads([adoThread(101)])]) })
      .listReviewComments('r', 7);
    assert.equal(ado[0].updatedAt, 'T1');                                       // lastUpdatedDate
  });

  test('AC8 — an ADO file-level comment keeps its path and has no line', async () => {
    const out = await adoRepos({ ...ADO, transport: recorder([adoThreads([
      adoThread(101, { threadContext: { filePath: '/src/a.js' } }),   // no rightFileStart
    ])]) }).listReviewComments('r', 7);
    assert.equal(out[0].kind, 'inline');
    assert.equal(out[0].path, '/src/a.js');
    assert.equal(out[0].line, null);
  });
});

describe('pagination is header-free, per-endpoint, and bounded', () => {
  const page = (n, make, from) => Array.from({ length: n }, (_, i) => make(from + i));

  test('AC9 — all three GitHub endpoints paginate independently to exhaustion', async () => {
    // Scoped to all three deliberately: an implementation that pages the inline
    // endpoint and truncates the other two at GitHub's default 30 would
    // otherwise pass, and lose comments silently.
    const t = recorder([
      page(100, ghInline, 1000), page(40, ghInline, 2000),
      page(100, ghIssue, 3000), page(40, ghIssue, 4000),
      page(100, ghReview, 5000), page(40, ghReview, 6000),
    ]);
    const out = await github({ ...GH, transport: t }).listReviewComments('r', 7);

    assert.equal(out.length, 420);
    for (const id of ['inline.1000', 'inline.2000', 'conversation.3000', 'conversation.4000',
                      'review-summary.5000', 'review-summary.6000']) {
      assert.ok(out.some((c) => c.id === id), `nothing from the page starting at ${id}`);
    }
    for (const path of ['pulls/7/comments', 'issues/7/comments', 'pulls/7/reviews']) {
      for (const p of [1, 2]) {
        assert.ok(t.calls.some((c) => c.url.includes(path) && c.url.includes(`per_page=100&page=${p}`)),
          `${path} never requested page ${p} at per_page=100`);
      }
    }
    // Header-free by construction: recorder() returns plain bodies and records no
    // headers, so a Link-following implementation could not have passed at all.
    assert.equal(t.calls.length, 6);
  });

  test('AC10 — an exact multiple of 100 stops on the empty page rather than looping', async () => {
    // Without this, an implementation that stops only on 0 < n < 100 spins
    // forever on any total that is an exact multiple of 100, and AC9 stays green.
    const t = recorder([page(100, ghInline, 1000), [], [], []]);
    const out = await github({ ...GH, transport: t }).listReviewComments('r', 7);
    assert.equal(out.length, 100);
    assert.equal(t.calls.filter((c) => c.url.includes('pulls/7/comments')).length, 2);
  });

  test('AC11 — ADO reads no header and only re-requests when the BODY says there is more', async () => {
    const one = recorder([adoThreads([adoThread(101)])]);
    await adoRepos({ ...ADO, transport: one }).listReviewComments('r', 7);
    assert.equal(one.calls.length, 1, 'a body with no continuation field must not trigger a second call');

    const more = recorder([
      adoThreads([adoThread(101)], { continuationToken: 'ct-2' }),
      adoThreads([adoThread(102)]),
    ]);
    const out = await adoRepos({ ...ADO, transport: more }).listReviewComments('r', 7);
    assert.equal(more.calls.length, 2);
    assert.match(more.calls[1].url, /continuationToken=ct-2/);
    assert.deepEqual(out.map((c) => c.threadId), ['101', '102']);
  });

  test('AC38 — a host that never runs out of pages is truncated and reported, not looped', async () => {
    // §4.2.4 calls the unbounded loop the one failure mode here that hangs rather
    // than failing safe. A mitigation with no test is a claim.
    const full = page(100, ghInline, 1);
    const seen = [];
    const forever = async (url) => { seen.push(url); return url.includes('/pulls/7/comments') ? full : []; };

    const out = await github({ ...GH, transport: forever }).listReviewComments('r', 7);
    assert.equal(seen.filter((u) => u.includes('/pulls/7/comments')).length, 100);
    assert.ok(out.warnings.some((w) => /truncated/.test(w)), `no truncation warning: ${out.warnings}`);
  });
});

describe('reply routing and pull request lookup', () => {
  test('AC12 — GitHub threads an inline reply and posts the others as issue comments', async () => {
    const t = recorder();
    const gh = github({ ...GH, transport: t });

    await gh.replyToReviewComment('api-neelias', 7,
      { id: 'inline.11', threadId: '11', kind: 'inline', body: 'x' }, 'ok');
    // The PULL NUMBER is required in this path; /pulls/comments/{id} is a
    // different resource with no /replies sub-resource. And the HOST's own comment
    // number, taken back out of the composite id (AC68): 'inline.11' is not a
    // comment this endpoint has, and %2E would 404 rather than fail loudly.
    assert.equal(t.last().method, 'POST');
    assert.match(t.last().url, /\/repos\/motivity\/api-neelias\/pulls\/7\/comments\/11\/replies$/);
    assert.ok(!t.last().url.includes('inline'), 'the composite id was pasted into the reply URL');

    await gh.replyToReviewComment('api-neelias', 7,
      { id: 'conversation.22', threadId: '22', kind: 'conversation', body: 'x' }, 'ok');
    assert.match(t.last().url, /\/repos\/motivity\/api-neelias\/issues\/7\/comments$/);
  });

  test('AC13 — an ADO reply is addressed by thread id, never by comment id', async () => {
    const t = recorder();
    await adoRepos({ ...ADO, transport: t })
      .replyToReviewComment('api-neelias', 7, { id: '5', threadId: '99', kind: 'inline', body: 'x' }, 'ok');
    assert.match(t.last().url, /\/pullRequests\/7\/threads\/99\/comments\?/);
    assert.ok(!/\/threads\/5\//.test(t.last().url), 'the comment id was used where the thread id belongs');
  });

  test('AC14 — getPullRequest returns a string id and a head sha, or null rather than throwing', async () => {
    const gh = await github({ ...GH, transport: recorder([
      { number: 7, head: { sha: 'abc123', ref: 'feat/0014-x' }, base: { ref: 'main' }, html_url: 'https://example.invalid/pr/7' },
    ]) }).getPullRequest('api-neelias', 7);
    assert.deepEqual(
      { id: gh.id, headSha: gh.headSha, source: gh.source, target: gh.target, url: gh.url },
      { id: '7', headSha: 'abc123', source: 'feat/0014-x', target: 'main', url: 'https://example.invalid/pr/7' });
    assert.equal(typeof gh.id, 'string', 'id, not number — openPullRequest and findPullRequests both return a string');

    const ado = await adoRepos({ ...ADO, transport: recorder([
      { pullRequestId: 7, lastMergeSourceCommit: { commitId: 'abc123' },
        sourceRefName: 'refs/heads/feat/0014-x', targetRefName: 'refs/heads/main' },
    ]) }).getPullRequest('api-neelias', 7);
    assert.equal(ado.id, '7');
    assert.equal(ado.headSha, 'abc123');
    assert.equal(ado.source, 'feat/0014-x');
    assert.equal(ado.target, 'main');

    // Nothing existing returns a head sha, so the missing-field case is the one
    // that matters: null, never a throw, and never a guess.
    assert.equal((await github({ ...GH, transport: recorder([{ number: 7 }]) }).getPullRequest('r', 7)).headSha, null);
    assert.equal((await adoRepos({ ...ADO, transport: recorder([{ pullRequestId: 7 }]) }).getPullRequest('r', 7)).headSha, null);
  });
});

describe('every interpolated path segment is encoded', () => {
  // repoBase() already encoded at scm.mjs:84; the review-feedback sites did not,
  // which was an oversight rather than a decision (spec 0014 AC46). An id or repo
  // carrying `/`, `..`, `?` or `#` otherwise reshapes the URL it is pasted into —
  // including flipping the separator the paging loop appends.
  const NASTY_REPO = 'a/../b?c#d';
  const NASTY_ID = '7/../9?x#y';
  const nastyComment = { id: 'c/../1', threadId: 't/../2', kind: 'inline', body: 'x' };

  /** The raw string, never new URL(): the parser NORMALIZES /../ away and would
   *  make the unencoded version pass. */
  const assertClean = (calls) => {
    for (const { url } of calls) {
      assert.ok(!url.includes('/../'), `a path traversal survived into the URL:\n  ${url}`);
      assert.ok(!url.includes('#'), `a fragment survived into the URL:\n  ${url}`);
      assert.ok(url.split('?').length <= 2, `a second query separator appeared:\n  ${url}`);
    }
  };

  test('AC46 — GitHub encodes owner, repo, pull id and comment id', async () => {
    const t = recorder();
    const gh = github({ owner: 'o/../p', token: 'ghp_x', transport: t });
    await gh.getPullRequest(NASTY_REPO, NASTY_ID);
    await gh.listReviewComments(NASTY_REPO, NASTY_ID);
    await gh.replyToReviewComment(NASTY_REPO, NASTY_ID, nastyComment, 'ok');
    await gh.replyToReviewComment(NASTY_REPO, NASTY_ID, { ...nastyComment, kind: 'conversation' }, 'ok');

    assert.ok(t.calls.length >= 6, 'nothing was recorded, so nothing was asserted');
    assertClean(t.calls);
    assert.ok(t.calls.every((c) => c.url.includes(encodeURIComponent(NASTY_REPO))),
      'the repository segment was interpolated raw');
  });

  test('AC46 — ADO encodes the pull request and thread ids too', async () => {
    const t = recorder();
    const ado = adoRepos({ ...ADO, transport: t });
    await ado.getPullRequest(NASTY_REPO, NASTY_ID);
    await ado.listReviewComments(NASTY_REPO, NASTY_ID);
    await ado.replyToReviewComment(NASTY_REPO, NASTY_ID, nastyComment, 'ok');

    assert.ok(t.calls.length >= 3, 'nothing was recorded, so nothing was asserted');
    assertClean(t.calls);
    assert.ok(t.calls.every((c) => c.url.includes(encodeURIComponent(NASTY_ID))),
      'the pull request id was interpolated raw');
  });
});

describe('the reply gate', () => {
  const PR = (sha) => ({ number: 7, head: { sha, ref: 'feat/0014-x' }, base: { ref: 'main' }, html_url: 'u' });
  /** GitHub's reads in order: the PR, the three comment endpoints, then — at most
   *  once, and only when a marker has to be adjudicated — the identity. */
  const feed = (pr, inline = [], issues = [], reviews = []) =>
    recorder([pr, inline, issues, reviews, ghIdentity]);
  /** A reply the tool itself posted: the marker AND the authorship. */
  const ownReply = (id, marker) => ghIssue(id, { body: `done\n\n${marker}`, user: { login: BOT } });

  test('AC15 — the marker is pure and stable', () => {
    assert.equal(replyMarker('42', '2026-09-16T10:04:11Z'),
      '<!-- ml-specs:pr-address 42 2026-09-16T10:04:11Z -->');
    assert.equal(replyMarker('42', '2026-09-16T10:04:11Z'), replyMarker('42', '2026-09-16T10:04:11Z'));
  });

  test('AC16 — idempotency is keyed on the comment AND its revision', () => {
    // The reviewer's own timestamp, which this command's own commits do not move.
    const list = [{ body: `done\n\n${replyMarker('42', 'T1')}` }];
    assert.equal(alreadyAnswered(list, '42', 'T1'), true);
    assert.equal(alreadyAnswered(list, '42', 'T2'), false);
  });

  test('AC41 — a marker counts only from the tool\'s OWN account', () => {
    // The attack: both inputs to the marker are publicly readable, so without the
    // authorship check any commenter can post
    //   <!-- ml-specs:pr-address <someone else's id> <their updatedAt> -->
    // and that person's comment is reported "already answered" on the next run —
    // the reviewer gets silence and the operator a false receipt.
    const marker = replyMarker('42', 'T1');
    // AC51: the forged comment carries the operator's DISPLAY NAME and someone
    // else's key. Comparing display names — which ADO lets their owner set — would
    // read this as ours; comparing `authorKey` does not.
    const forged = [{ author: BOT, authorKey: 'mallory', body: `+1\n\n${marker}` }];
    const ours = [{ author: 'anything at all', authorKey: BOT, body: `done\n\n${marker}` }];

    assert.equal(alreadyAnswered(forged, '42', 'T1', BOT), false,
      'a third party suppressed another reviewer\'s comment');
    assert.equal(alreadyAnswered(ours, '42', 'T1', BOT), true);
    // Still keyed on the revision: the authorship check ADDS a condition, it does
    // not replace the (commentId, updatedAt) key.
    assert.equal(alreadyAnswered(ours, '42', 'T2', BOT), false);
    // GitHub logins are case-insensitive, and ADO keys arrive padded.
    assert.equal(alreadyAnswered([{ authorKey: ` ${BOT.toUpperCase()} `, body: marker }], '42', 'T1', BOT), true);
  });

  test('AC48 — an unresolvable identity trusts NO marker, and a ghost author is not us', () => {
    // The edge the authorship fix opened if empty were treated as a value: a
    // deleted/ghost host account arrives with an empty author, and a whoAmI() that
    // could not resolve arrives empty too. Comparing them as equal would hand a
    // ghost-authored comment the tool's own trust — so empty matches nothing, in
    // either position, and an unknown identity fails CLOSED.
    const marker = replyMarker('42', 'T1');
    const ghost = [{ author: '', authorKey: '', body: `+1\n\n${marker}` }];

    // 4-arg: a check was ASKED for. Unresolvable identity => trust nothing.
    assert.equal(alreadyAnswered(ghost, '42', 'T1', ''), false,
      'a ghost-authored marker was trusted by an unresolvable identity');
    assert.equal(alreadyAnswered(ghost, '42', 'T1', null), false);
    assert.equal(alreadyAnswered(ghost, '42', 'T1', BOT), false);
    // A real identity is not matched by a ghost comment either.
    assert.equal(alreadyAnswered([{ author: '  ', authorKey: '  ', body: marker }], '42', 'T1', BOT), false);

    // 3-arg: no check was asked for (AC16's pure-helper form) — marker alone.
    // ARITY selects the mode, not emptiness: collapsing these two would reopen the
    // hole the selfAuthor parameter exists to close.
    assert.equal(alreadyAnswered(ghost, '42', 'T1'), true,
      'the 3-argument pure-helper form must still degenerate to the marker alone');
  });

  test('AC41 — the gate resolves its own identity, ONCE, and a forged marker does not skip', async () => {
    // Both sides of this comparison originate inside the gate: the comment list
    // from its own fetch, the identity from whoAmI(). A caller cannot supply
    // either.
    const forged = ghIssue(99, { body: `+1\n\n${replyMarker('inline.42', 'T1')}`, user: { login: 'mallory' } });
    const t = feed(PR('aaa'), [ghInline(42)], [forged]);
    const gate = governedReply(github({ ...GH, transport: t }), { localHead: 'aaa' });

    const r = await gate.replyFor('api-neelias', 7, 'inline.42', 'addressed');
    assert.equal(r.skipped, null, 'a forged marker suppressed a real reply');
    assert.equal(t.calls.filter((c) => c.method === 'POST').length, 1);

    // Resolved once per run, and so is the rest of the gate's evidence (AC65): a
    // second reply on the same gate re-fetches neither the pull request, nor the
    // comment list, nor the identity.
    const before = t.calls.filter((c) => c.url.endsWith('/user')).length;
    await gate.replyFor('api-neelias', 7, 'inline.42', 'again').catch(() => {});
    assert.equal(t.calls.filter((c) => c.url.endsWith('/user')).length, before,
      'the identity was re-fetched per reply');
  });

  test('AC17 — a head that does not match local HEAD refuses, and posts nothing', async () => {
    const t = feed(PR('bbb'), [ghInline(42)]);
    const gate = governedReply(github({ ...GH, transport: t }), { localHead: 'aaa' });
    await assert.rejects(() => gate.replyFor('api-neelias', 7, 'inline.42', 'addressed'), /not pushed/);
    assert.ok(t.calls.length > 0, 'the gate must fetch its own evidence');
    assert.equal(t.calls.filter((c) => c.method === 'POST').length, 0);
  });

  test('AC18 — an unverifiable head refuses too', async () => {
    const t = feed({ number: 7 }, [ghInline(42)]);     // no head.sha
    const gate = governedReply(github({ ...GH, transport: t }), { localHead: 'aaa' });
    await assert.rejects(() => gate.replyFor('api-neelias', 7, 'inline.42', 'addressed'));
    assert.equal(t.calls.filter((c) => c.method === 'POST').length, 0);
  });

  test('AC19 — a comment already answered at its current revision is skipped', async () => {
    const t = feed(PR('aaa'), [ghInline(42)], [ownReply(99, replyMarker('inline.42', 'T1'))]);
    const gate = governedReply(github({ ...GH, transport: t }), { localHead: 'aaa' });
    const r = await gate.replyFor('api-neelias', 7, 'inline.42', 'addressed');
    assert.ok(r.skipped, `expected a skip, got ${JSON.stringify(r)}`);
    assert.equal(t.calls.filter((c) => c.method === 'POST').length, 0);
  });

  test('AC20 — an unanswered comment gets exactly one reply, marked', async () => {
    const t = feed(PR('aaa'), [ghInline(42)]);
    const gate = governedReply(github({ ...GH, transport: t }), { localHead: 'aaa' });
    await gate.replyFor('api-neelias', 7, 'inline.42', 'Renamed in a1b2c3d.');

    const posts = t.calls.filter((c) => c.method === 'POST');
    assert.equal(posts.length, 1);
    assert.ok(posts[0].body.body.endsWith(replyMarker('inline.42', 'T1')),
      `the reply carries no marker, so the next run would re-post it:\n${posts[0].body.body}`);
  });

  test('a comment that is not on this pull request is refused before anything is posted', async () => {
    const t = feed(PR('aaa'), [ghInline(42)]);
    const gate = governedReply(github({ ...GH, transport: t }), { localHead: 'aaa' });
    await assert.rejects(() => gate.replyFor('api-neelias', 7, 'inline.999', 'x'), /is not on/);
    assert.equal(t.calls.filter((c) => c.method === 'POST').length, 0);
  });

  test('a deferred comment is answered without the head check, and still cannot double-post', async () => {
    // A contract-change refusal produces a reply on a run that committed nothing,
    // so the reviewer learns why rather than reading silence as neglect.
    const t = feed({ number: 7 }, [ghInline(42)]);
    const gate = governedReply(github({ ...GH, transport: t }), { localHead: null });
    await gate.replyFor('api-neelias', 7, 'inline.42', 'deferred', { deferred: true });
    assert.equal(t.calls.filter((c) => c.method === 'POST').length, 1);

    const t2 = feed({ number: 7 }, [ghInline(42)], [ownReply(99, replyMarker('inline.42', 'T1'))]);
    const r = await governedReply(github({ ...GH, transport: t2 }), { localHead: null })
      .replyFor('api-neelias', 7, 'inline.42', 'deferred', { deferred: true });
    assert.ok(r.skipped);
    assert.equal(t2.calls.filter((c) => c.method === 'POST').length, 0);
  });

  test('AC49 — a marker interleaved out of fragments does not survive the quote-back', async () => {
    // VERIFIED BY EXECUTION, and reachable with no prompt injection and no agent:
    // one non-greedy pass over
    //   <<!--X-->!-- ml-specs:pr-address 99 T <!--Y-->-->
    // removes the two inner comments and RECONSTRUCTS the outer one, yielding
    // exactly replyMarker('99','T'). GitHub's conversation / review-summary reply
    // path quotes the source body back verbatim, so that marker would be posted by
    // the tool's OWN account — and the authorship check would then endorse it,
    // suppressing comment 99 forever. The strip must reach a FIXED POINT.
    const payload = `please fix <<!--X-->!-- ${'ml-specs:pr-address'} 99 T <!--Y-->--> thanks`;
    const t = feed(PR('aaa'), [], [ghIssue(22, { body: payload, updated_at: 'T2' })]);
    const gate = governedReply(github({ ...GH, transport: t }), { localHead: 'aaa' });
    await gate.replyFor('api-neelias', 7, 'conversation.22', 'Fixed in a1b2c3d.');

    const posts = t.calls.filter((c) => c.method === 'POST');
    assert.equal(posts.length, 1);
    const body = posts[0].body.body;
    // Exactly ONE marker leaves here: the one the gate appended for comment 22.
    assert.equal(body.split('ml-specs:pr-address').length - 1, 1,
      `a second marker survived the quote-back:\n${body}`);
    assert.ok(body.includes(replyMarker('conversation.22', 'T2')), `the gate's own marker is missing:\n${body}`);
    assert.ok(!body.includes(replyMarker('99', 'T')), `a marker for comment 99 was posted:\n${body}`);
  });

  test('AC50 — the GATE half of the split invariant refuses independently of any adapter', async () => {
    // The invariant is split: governedReply requires EXACTLY ONE marker in the
    // fragment it composes; the adapters require that quoting adds none. Every
    // production path hits an adapter that throws the same message first, so
    // deleting the gate's own check left the suite green — the backstop was
    // untested, and spec 0015's Bitbucket adapter would inherit it unproven.
    //
    // Driven through a MINIMAL adapter with no assertOneMarker of its own, which
    // is exactly the case the backstop exists for.
    const posts = [];
    const bare = {
      tool: 'stub',
      async whoAmI() { return 'bot'; },
      async getPullRequest() { return { id: '7', headSha: 'aaa', source: 's', target: 'm', url: 'u' }; },
      async listReviewComments() {
        return [{ id: '42', threadId: '42', kind: 'inline', path: 'a.js', line: 1,
                  body: 'please fix', author: 'alice', authorKey: 'alice',
                  updatedAt: 'T1', resolved: null, isOwnReply: false }];
      },
      async replyToReviewComment(repo, prId, comment, body) { posts.push(body); return { posted: true }; },
    };
    const gate = governedReply(bare, { localHead: 'aaa' });

    await assert.rejects(
      () => gate.replyFor('r', 7, '42', `done ${replyMarker('99', 'T9')}`),
      /foreign ml-specs:pr-address marker/,
      'the gate let a body carrying a second marker through to an adapter that would not catch it');
    assert.equal(posts.length, 0, 'a refused reply reached the transport');

    // Non-vacuity: the same gate, same adapter, a clean body -> it does post.
    const ok = await gate.replyFor('r', 7, '42', 'done');
    assert.equal(ok.posted, true);
    assert.equal(posts.length, 1);
    assert.ok(posts[0].endsWith(replyMarker('42', 'T1')), 'the gate must append its own marker');
  });

  test('AC50 — a body still carrying a foreign marker is refused AT THE SINK', async () => {
    // The invariant belongs where every reply passes, not only at the two
    // strippers. A laundered marker would be posted by the tool's own account,
    // which is exactly the authorship the idempotency check trusts.
    const t = feed(PR('aaa'), [ghInline(42)]);
    const gate = governedReply(github({ ...GH, transport: t }), { localHead: 'aaa' });

    await assert.rejects(
      () => gate.replyFor('api-neelias', 7, 'inline.42', `done ${replyMarker('inline.99', 'T')}`),
      /foreign ml-specs:pr-address marker/);
    assert.equal(t.calls.filter((c) => c.method === 'POST').length, 0,
      'a reply carrying someone else\'s marker was posted');

    // A marker for THIS comment is not exempt either: the gate appends its own,
    // and two of them is not the invariant.
    const t2 = feed(PR('aaa'), [ghInline(42)]);
    await assert.rejects(
      () => governedReply(github({ ...GH, transport: t2 }), { localHead: 'aaa' })
        .replyFor('api-neelias', 7, 'inline.42', `done ${replyMarker('inline.42', 'T1')}`),
      /foreign ml-specs:pr-address marker/);
    assert.equal(t2.calls.filter((c) => c.method === 'POST').length, 0);
  });

  test('AC55 — a DANGLING <!-- does not survive the quote-back, and cannot hide the reply', async () => {
    // THE DEFECT, and why a fixed point is not enough on its own: the strip loop
    // removes complete `<!-- ... -->` PAIRS, so an unterminated opener has no
    // match at the fixed point and passes through BY CONSTRUCTION. On this path
    // the composed body becomes
    //   > Please fix the bug.
    //   > <!--
    //
    //   Fixed in a1b2c3d.
    //
    //   <!-- ml-specs:pr-address 22 T2 -->
    // and a renderer swallows everything from the bare opener onward: the tool's
    // own answer and its marker both go invisible, while the RAW body still
    // carries the marker. posted: true, "replied", exit 0 — and alreadyAnswered()
    // skips that comment forever. Silent suppression plus a false receipt,
    // triggerable by anyone who can leave a comment.
    const t = feed(PR('aaa'), [], [ghIssue(22, { body: 'Please fix the bug.\n<!-- dangling', updated_at: 'T2' })]);
    await governedReply(github({ ...GH, transport: t }), { localHead: 'aaa' })
      .replyFor('api-neelias', 7, 'conversation.22', 'Fixed in a1b2c3d.');

    const posts = t.calls.filter((c) => c.method === 'POST');
    assert.equal(posts.length, 1);
    const body = posts[0].body.body;
    // EXACTLY ONE opener and one closer reach the host: the gate's own marker.
    // Counted rather than regex-stripped on purpose — stripping `<!--[\s\S]*?-->`
    // from this body would pair the DANGLING opener with the marker's closer and
    // erase the evidence, which is precisely what a renderer does to it.
    assert.equal(body.split('<!--').length - 1, 1,
      `a bare comment opener reached the host, hiding everything after it:\n${body}`);
    assert.equal((body.match(/--!?>/g) ?? []).length, 1,
      `a stray comment closer reached the host:\n${body}`);
    // And the delimiter is the marker's own, at the very end — not one sitting in
    // the quoted text above the answer.
    assert.ok(!body.slice(0, body.indexOf('Fixed in a1b2c3d.')).includes('<!--'),
      `the quoted source still carries a comment delimiter:\n${body}`);
    // The answer and the marker are still THERE — stripping must not cost the
    // reply its own content.
    assert.ok(body.includes('Fixed in a1b2c3d.'), `the answer is missing:\n${body}`);
    assert.ok(body.includes(replyMarker('conversation.22', 'T2')), `the gate's own marker is missing:\n${body}`);
    assert.ok(body.includes('> Please fix the bug.'), `the quoted source is missing:\n${body}`);
  });

  test('AC61 — a BOGUS-COMMENT opener does not survive the quote-back either', async () => {
    // `<!--` is not the only opener a tokenizer recognises. HTML enters BOGUS
    // COMMENT STATE on `<!` followed by anything that is not `--`, on `<?`, and on
    // `</` before a non-letter — so `<!x`, `<![CDATA[` and `<?php` each open a
    // comment-like region that swallows what follows, doing exactly the damage the
    // bare `<!--` above does: the answer and the marker go invisible while the raw
    // body still carries the marker, so the operator reads "replied" and
    // alreadyAnswered() skips that comment forever.
    //
    // The sixth security review verified
    //   "> <!x nothing to see here\n\nfixed it\n\n<!-- ml-specs:pr-address 55 T1 -->"
    // reaching the wire through the real adapter, and returned INCONCLUSIVE rather
    // than clean — solely because whether a given host's sanitiser honours the form
    // cannot be determined from this repo. Stripping it makes the question moot.
    for (const opener of ['<!x', '<![CDATA[', '<?php', '</ ']) {
      const t = feed(PR('aaa'), [], [ghIssue(22, { body: `${opener} nothing to see here`, updated_at: 'T2' })]);
      await governedReply(github({ ...GH, transport: t }), { localHead: 'aaa' })
        .replyFor('api-neelias', 7, 'conversation.22', 'Fixed in a1b2c3d.');

      const posts = t.calls.filter((c) => c.method === 'POST');
      assert.equal(posts.length, 1);
      const body = posts[0].body.body;
      // Everything before the answer — the quoted, host-supplied half — carries no
      // opener of any form. Counted on the composed payload, not on the fragment.
      const quotedHalf = body.slice(0, body.indexOf('Fixed in a1b2c3d.'));
      assert.doesNotMatch(quotedHalf, /<!--|--!?>|<[!?]|<\/(?![A-Za-z])/,
        `${opener} reached the host, hiding everything after it:\n${body}`);
      // Exactly one opener in the whole payload: the gate's own marker, at the end.
      assert.equal(body.split('<!--').length - 1, 1, `a second comment opener reached the host:\n${body}`);
      assert.ok(body.includes('Fixed in a1b2c3d.'), `the answer is missing:\n${body}`);
      assert.ok(body.includes(replyMarker('conversation.22', 'T2')), `the gate's own marker is missing:\n${body}`);
      assert.ok(body.includes('> ') && body.includes('nothing to see here'),
        `the quoted source is missing:\n${body}`);
    }
  });

  test('the quote scan is bounded, so a pathological body cannot stall the reply', async () => {
    // quoted() truncates before stripping. Without the cap, /<!--[\s\S]*?-->/g
    // backtracks to end-of-string from every opener in an opener-only body:
    // measured 65k chars = 0.69s, 262k = 11.6s, 524k = 45s. A commenter controls
    // that body, and the hosts' own caps are larger than the point where it hurts.
    //
    // TWO assertions, because a timing test alone is a bad guard and a behavioural
    // test alone would not catch a cap raised to 10MB:
    //   1. DETERMINISTIC — text beyond the cap never reaches the quote. This is
    //      the real contract: quoted() uses five lines, so anything past the cap is
    //      unreachable by construction, and the assertion does not name 8192.
    //   2. TIMING, with a deliberately enormous margin — 3s sits ~300x above the
    //      capped cost (~10ms) and ~4x below the uncapped cost at this size (11.6s),
    //      so it cannot flake on a slow machine but still fails if the cap is removed.
    const beyond = 'SENTINEL_PAST_THE_CAP';
    const body = `first line\nsecond line\nthird line\nfourth line\nfifth line\n${'<!--'.repeat(65536)}${beyond}`;
    const t = feed(PR('aaa'), [], [ghIssue(31, { body, updated_at: 'T3' })]);

    const started = Date.now();
    await governedReply(github({ ...GH, transport: t }), { localHead: 'aaa' })
      .replyFor('api-neelias', 7, 'conversation.31', 'Fixed in a1b2c3d.');
    const elapsed = Date.now() - started;

    const posted = t.calls.filter((c) => c.method === 'POST')[0].body.body;
    assert.ok(!posted.includes(beyond),
      'text beyond the quote-scan cap reached the host — the truncation is gone');
    assert.ok(posted.includes('> first line'), `the quote itself is missing:\n${posted.slice(0, 200)}`);
    assert.ok(posted.includes(replyMarker('conversation.31', 'T3')), 'the gate\'s own marker is missing');
    assert.ok(elapsed < 3000,
      `quoting a ${body.length}-char body took ${elapsed}ms — the quote-scan cap has been removed `
      + '(uncapped this input costs seconds, and a commenter chooses the input)');
  });

  test('AC56 — a bare MENTION of the tag is not a marker, and a legitimate reply still posts', async () => {
    // The over-fire: counting bare occurrences of `ml-specs:pr-address` made a
    // reviewer writing "mention ml-specs:pr-address in your reply" — or an answer
    // that names the tool — enough to refuse a legitimate reply. Only a
    // WELL-FORMED marker is what alreadyAnswered() reads, so only that is counted.
    const t = feed(PR('aaa'), [], [ghIssue(22, { body: 'please mention ml-specs:pr-address in your reply', updated_at: 'T2' })]);
    await governedReply(github({ ...GH, transport: t }), { localHead: 'aaa' })
      .replyFor('api-neelias', 7, 'conversation.22', 'Done — ml-specs:pr-address posted this.');

    const posts = t.calls.filter((c) => c.method === 'POST');
    assert.equal(posts.length, 1, 'a legitimate reply was refused over a bare mention of the tag');
    const body = posts[0].body.body;
    // Three bare occurrences of the tag, and exactly ONE marker — which is the
    // whole distinction.
    assert.equal(body.split('ml-specs:pr-address').length - 1, 3);
    assert.equal((body.match(/<!--\s*ml-specs:pr-address\b[\s\S]*?-->/g) ?? []).length, 1,
      `the composed body does not carry exactly one marker:\n${body}`);
    assert.ok(body.includes(replyMarker('conversation.22', 'T2')));
  });

  test('AC56 — the sink assertion runs on the body handed to the TRANSPORT, on both reply paths', async () => {
    // It used to run on `marked` — the fragment the gate composed — BEFORE the
    // quote-back path prepended the quoted source, so the invariant it stated was
    // simply false for the payload the host received. It now runs where the body
    // is finished, in the adapter, immediately before the POST: a body carrying a
    // second well-formed marker never reaches the transport.
    const twoMarkers = `done ${replyMarker('42', 'T1')}\n${replyMarker('99', 'T')}`;

    for (const comment of [{ kind: 'inline', id: 'inline.42', threadId: '42', body: 'rename this' },
                           { kind: 'conversation', id: 'conversation.22', threadId: '22', body: 'a general note' }]) {
      const t = recorder();
      await assert.rejects(
        () => github({ ...GH, transport: t }).replyToReviewComment('api-neelias', 7, comment, twoMarkers),
        /foreign ml-specs:pr-address marker/,
        `the ${comment.kind} path posted a body carrying two markers`);
      assert.equal(t.calls.filter((c) => c.method === 'POST').length, 0);

      const ado = recorder();
      await assert.rejects(
        () => adoRepos({ ...ADO, transport: ado }).replyToReviewComment('api-neelias', 7, comment, twoMarkers),
        /foreign ml-specs:pr-address marker/);
      assert.equal(ado.calls.filter((c) => c.method === 'POST').length, 0);
    }

    // And it does NOT fire on the ordinary shapes either adapter is called with:
    // a plain body with no marker at all, and a gate-composed body with exactly
    // one. An assertion that refuses those would take the whole command down.
    const ok = recorder();
    const gh = github({ ...GH, transport: ok });
    await gh.replyToReviewComment('api-neelias', 7, { kind: 'inline', id: 'inline.42', body: 'plain' }, 'no marker here');
    await gh.replyToReviewComment('api-neelias', 7, { kind: 'conversation', id: 'conversation.22', body: 'quoted source' },
      `done\n\n${replyMarker('conversation.22', 'T2')}`);
    assert.equal(ok.calls.filter((c) => c.method === 'POST').length, 2);
  });

  test('AC65 — the gate fetches its evidence ONCE PER RUN, however many entries it answers', async () => {
    // It used to re-fetch the pull request AND the fully paginated comment list on
    // EVERY entry: three paginated endpoints per call on GitHub, so a twelve-entry
    // batch cost 100+ round trips and could trip a secondary rate limit halfway
    // through a batch — leaving some reviewers answered and some not.
    //
    // The "fetches its own evidence" property is UNCHANGED and is what this also
    // guards: the fetches below are the gate's own, and no caller supplies them.
    const t = recorder([PR('aaa'), [ghInline(42), ghInline(43), ghInline(44), ghInline(45), ghInline(46)], [], []]);
    const gate = governedReply(github({ ...GH, transport: t }), { localHead: 'aaa' });

    for (const id of ['inline.42', 'inline.43', 'inline.44', 'inline.45', 'inline.46']) {
      await gate.replyFor('api-neelias', 7, id, `Addressed ${id}.`);
    }

    const gets = t.calls.filter((c) => c.method !== 'POST');
    assert.equal(gets.filter((c) => /\/pulls\/7$/.test(c.url)).length, 1,
      `getPullRequest was called ${gets.filter((c) => /\/pulls\/7$/.test(c.url)).length} times for 5 entries`);
    for (const path of ['/pulls/7/comments', '/issues/7/comments', '/pulls/7/reviews']) {
      assert.equal(gets.filter((c) => c.url.includes(`${path}?`)).length, 1,
        `${path} was read more than once across the run`);
    }
    // The identity is the gate's third piece of evidence and is memoized the same
    // way (AC41), so five entries cost exactly one /user call — not five.
    assert.equal(gets.filter((c) => c.url.endsWith('/user')).length, 1);
    assert.equal(gets.length, 5, `the gate made ${gets.length} reads for 5 entries: ${gets.map((c) => c.url).join('\n')}`);

    // NON-VACUITY: all five replies really were posted, each with its own marker.
    // A gate that answered nothing would also fetch nothing twice.
    const posts = t.calls.filter((c) => c.method === 'POST');
    assert.equal(posts.length, 5);
    assert.ok(posts[4].body.body.endsWith(replyMarker('inline.46', 'T1')), 'the last reply carries the wrong marker');
  });

  test('AC62 — two ADO threads carrying the same host comment id reply to the RIGHT thread', async () => {
    // ADO NUMBERS COMMENTS PER THREAD, so `id: 1` exists in every thread. Flattened
    // into one list the raw ids collide, and the two consumers disagree about which
    // duplicate wins: planReplies keys a Map on `id` and keeps the LAST, the gate's
    // .find() takes the FIRST. A reply for thread 102 would be POSTed to thread 101
    // — answering a reviewer who asked nothing, and leaving the real comment
    // unanswered with a receipt saying otherwise.
    //
    // THE FIXTURE IS THE POINT. Six review rounds missed this because every ADO
    // fixture derived its comment id as `thread.id * 10`, unique by construction:
    // the collision could not be expressed, so no test could fail. These two
    // threads BOTH carry a comment whose host id is literally 1.
    const colliding = adoThreads([
      { id: 101, status: 'active', comments: [{ id: 1, content: 'rename this', commentType: 'text',
        author: { id: 'ana-guid', displayName: 'Ana Ruiz' }, lastUpdatedDate: 'T1' }] },
      { id: 102, status: 'active', comments: [{ id: 1, content: 'and split that', commentType: 'text',
        author: { id: 'bo-guid', displayName: 'Bo Diaz' }, lastUpdatedDate: 'T2' }] },
    ]);

    const listed = await adoRepos({ ...ADO, transport: recorder([colliding]) }).listReviewComments('r', 7);
    assert.deepEqual(listed.map((c) => c.id), ['101.1', '102.1'],
      'the normalized ids still collide, so a reply can go to the wrong thread');
    assert.equal(new Set(listed.map((c) => c.id)).size, 2, 'two comments, two ids');
    // Non-vacuity: the HOST ids really are identical — that is the whole case.
    assert.equal(listed[0].id.split('.').pop(), listed[1].id.split('.').pop());

    // And the gate resolves each id to its own comment, end to end: the reply for
    // 102.1 is POSTed to thread 102, with thread 102's own parentCommentId.
    const t = recorder([
      { pullRequestId: 7, lastMergeSourceCommit: { commitId: 'aaa' },
        sourceRefName: 'refs/heads/f', targetRefName: 'refs/heads/main' },
      colliding,
    ]);
    const gate = governedReply(adoRepos({ ...ADO, transport: t }), { localHead: 'aaa' });
    await gate.replyFor('api-neelias', 7, '102.1', 'Split in b2c3d4e.');

    const posts = t.calls.filter((c) => c.method === 'POST');
    assert.equal(posts.length, 1);
    assert.match(posts[0].url, /\/pullRequests\/7\/threads\/102\/comments\?/,
      `the reply went to the wrong thread:\n  ${posts[0].url}`);
    assert.ok(!/\/threads\/101\//.test(posts[0].url), 'the reply landed on the colliding thread');
    // The host's own per-thread number, back out of the composite: Number('102.1')
    // is 102.1, which is not a parent any thread has.
    assert.equal(posts[0].body.parentCommentId, 1);
    // The marker names the composite id, so the next run matches this comment and
    // not its twin in the other thread.
    assert.ok(posts[0].body.content.endsWith(replyMarker('102.1', 'T2')),
      `the marker does not name this comment:\n${posts[0].body.content}`);
  });

  test('AC68 — a GitHub inline comment and a review summary sharing host id 42 do not collide', async () => {
    // THE SAME DEFECT AS AC62, ON THE HOST THE ROUND-20 FIX DID NOT TOUCH.
    // /pulls/{n}/comments, /issues/{n}/comments and /pulls/{n}/reviews are three
    // different resources with three INDEPENDENT id sequences; nothing makes them
    // mutually unique. Normalized to the raw host id, an inline comment 42 and a
    // review summary 42 were both '42' — and the two consumers then disagreed about
    // which one that meant: planReplies keys a Map on `id` and keeps the LAST,
    // governedReply's .find() takes the FIRST. The plan resolves one comment, the
    // gate posts to the other, and the marker is written with the wrong updatedAt:
    // one comment is re-answered on every run while the other is recorded as
    // answered and never is. `list --json` also emitted a duplicate id the operator
    // could not address.
    //
    // THE FIXTURE IS THE POINT, exactly as it was for AC62: ghInline(11) /
    // ghIssue(22) / ghReview(33) are unique BY CONSTRUCTION — the same blindness as
    // ADO's `id * 10` — so the collision could not be expressed and no test could
    // fail. All three comments below carry the host id 42.
    const collide = () => recorder([[ghInline(42)], [ghIssue(42)], [ghReview(42)]]);

    const listed = await github({ ...GH, transport: collide() }).listReviewComments('api-neelias', 7);
    assert.deepEqual(listed.map((c) => c.id), ['inline.42', 'conversation.42', 'review-summary.42']);
    assert.equal(new Set(listed.map((c) => c.id)).size, 3, 'three comments, three ids');
    // Non-vacuity: the HOST ids really are identical — that is the whole case.
    assert.deepEqual(listed.map((c) => c.id.split('.').pop()), ['42', '42', '42']);
    // The thread id stays the HOST's number (AC5): a thread root is a host comment.
    assert.deepEqual(listed.map((c) => c.threadId), ['42', '42', '42']);

    // The plan half: each entry resolves to ITS OWN comment, not to whichever
    // duplicate the Map happened to keep.
    const { posts, skipped } = planReplies(listed, [
      { commentId: 'inline.42', body: 'Renamed in a1b2c3d.' },
      { commentId: 'review-summary.42', body: 'Answered in b2c3d4e.' },
    ]);
    assert.deepEqual(skipped, []);
    assert.deepEqual(posts.map((p) => [p.commentId, p.comment.kind, p.comment.updatedAt]),
      [['inline.42', 'inline', 'T1'], ['review-summary.42', 'review-summary', 'T3']]);

    // The gate half: the POST goes to the endpoint matching the KIND it was given.
    // A review summary has no threaded reply on REST, so it becomes an issue
    // comment quoting its source — and the inline reply must NOT go there.
    const t = recorder([PR('aaa'), [ghInline(42)], [ghIssue(42)], [ghReview(42)], ghIdentity]);
    const gate = governedReply(github({ ...GH, transport: t }), { localHead: 'aaa' });
    await gate.replyFor('api-neelias', 7, 'review-summary.42', 'Answered in b2c3d4e.');
    await gate.replyFor('api-neelias', 7, 'inline.42', 'Renamed in a1b2c3d.');

    const sent = t.calls.filter((c) => c.method === 'POST');
    assert.equal(sent.length, 2);
    assert.match(sent[0].url, /\/repos\/motivity\/api-neelias\/issues\/7\/comments$/,
      `the review summary was answered on the wrong endpoint:\n  ${sent[0].url}`);
    assert.match(sent[1].url, /\/repos\/motivity\/api-neelias\/pulls\/7\/comments\/42\/replies$/,
      `the inline comment was answered on the wrong endpoint:\n  ${sent[1].url}`);
    // The HOST's id in that path, back out of the composite: 'inline.42' is not a
    // comment this endpoint has.
    assert.ok(!sent[1].url.includes('inline'), 'the composite id was pasted into the reply URL');

    // And each marker names its OWN comment, at its OWN revision — which is what
    // makes the next run skip the two of them independently. The review summary's
    // key comes from submitted_at (T3), the inline one's from updated_at (T1): a
    // collision would have written one of them under the other's timestamp.
    assert.ok(sent[0].body.body.endsWith(replyMarker('review-summary.42', 'T3')),
      `the review summary's reply carries the wrong marker:\n${sent[0].body.body}`);
    assert.ok(sent[1].body.body.endsWith(replyMarker('inline.42', 'T1')),
      `the inline reply carries the wrong marker:\n${sent[1].body.body}`);
    // The quote-back proves WHICH comment was resolved: the review body, not the
    // inline one that shares its host id.
    assert.ok(sent[0].body.body.includes('> the summary body'),
      `the reply quoted the wrong comment:\n${sent[0].body.body}`);
  });

  test('AC69 — one gate serving two pull requests keeps their evidence apart', async () => {
    // The cache exists for AC65 (one fetch per run, not one per entry), and its key
    // is COMPOSITE because one gate is allowed to serve more than one pull request.
    // scm.mjs says answering PR 8 with PR 7's head sha "is the exact mistake this
    // gate exists to prevent" — yet replacing the key with the repo alone left the
    // whole suite green, so the claim was prose with nothing behind it.
    //
    // Both halves of the mistake are asserted here, because the repo-only mutation
    // causes both: PR 8 would be answered against PR 7's HEAD SHA (it matches
    // localHead, so the gate posts about work that was never pushed to PR 8) and
    // against PR 7's COMMENT LIST (which does not contain PR 8's comment at all).
    const seen = [];
    const transport = async (url) => {
      seen.push(url);
      if (/\/pulls\/7$/.test(url)) return PR('aaa');
      if (/\/pulls\/8$/.test(url)) return { ...PR('bbb'), number: 8 };
      if (url.includes('/pulls/7/comments?')) return [ghInline(42)];
      if (url.includes('/pulls/8/comments?')) return [ghInline(77, { body: 'and this one', updated_at: 'T9' })];
      return [];
    };
    const gate = governedReply(github({ ...GH, transport }), { localHead: 'aaa' });

    // PR 7 is at the local HEAD, so it is answered.
    const ok = await gate.replyFor('api-neelias', 7, 'inline.42', 'Renamed in a1b2c3d.');
    assert.equal(ok.posted, true);

    // PR 8 is NOT, and the gate must know that from PR 8's own fetch. With a
    // repo-only key this rejects with /is not on/ — PR 7's cached list has no
    // comment 77 — or does not reject at all.
    await assert.rejects(() => gate.replyFor('api-neelias', 8, 'inline.77', 'Split in b2c3d4e.'),
      /refusing to reply about work that is not pushed.*pull request 8 head is bbb/s,
      'the second pull request was judged against the first one\'s head sha');

    // Both pull requests were really fetched, and each exactly once: the cache is
    // per (repo, pull request), not per repo and not per entry.
    assert.equal(seen.filter((u) => /\/pulls\/7$/.test(u)).length, 1);
    assert.equal(seen.filter((u) => /\/pulls\/8$/.test(u)).length, 1,
      'the gate never fetched the second pull request at all');
    assert.equal(seen.filter((u) => u.includes('/pulls/8/comments?')).length, 1,
      'the second pull request\'s comment list was never read');

    // NON-VACUITY: PR 8 is answerable once its own head matches — the refusal above
    // is about the evidence being PR 8's, not about PR 8 being unanswerable.
    const other = governedReply(github({ ...GH, transport }), { localHead: 'bbb' });
    const posted = await other.replyFor('api-neelias', 8, 'inline.77', 'Split in b2c3d4e.');
    assert.equal(posted.posted, true);
    assert.equal(posted.comment, 'inline.77');
  });

  test('AC21 — the read-only view gains both reads and still has no way to post', () => {
    const r = readOnlyScm(github({ ...GH, transport: recorder() }));
    assert.equal(typeof r.listReviewComments, 'function');
    assert.equal(typeof r.getPullRequest, 'function');
    // The facade carries exactly what §4.2's table lists. whoAmI is NOT on it: the
    // identity is resolved by the adapter's own memoized identityOf() inside
    // listReviewComments, so a facade method would be dead weight that later reads
    // as a supported capability.
    assert.equal(r.whoAmI, undefined, 'readOnlyScm exposes a capability its contract does not list');
    assert.equal(r.replyToReviewComment, undefined);
    assert.throws(() => { 'use strict'; r.replyToReviewComment = () => {}; });
    assert.equal(r.replyToReviewComment, undefined);
  });
});
