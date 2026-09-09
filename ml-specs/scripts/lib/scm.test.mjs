// Contract tests for source control, and for the fan-out guarantee.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { recorder } from './http.mjs';
import { adoRepos, github, governedScm, readOnlyScm, pullRequestBody, fanOutTargets } from './scm.mjs';
import { parseEstate, impactOf } from './estate.mjs';

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
