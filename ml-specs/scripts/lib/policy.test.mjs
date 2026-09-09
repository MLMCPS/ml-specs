// Each test here is a way a gate stops being a gate without anything visibly
// breaking — which is exactly how this kind of governance dies.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { recorder } from './http.mjs';
import { adoPolicy, githubPolicy, auditOk, auditSummary, BUILD_VALIDATION_TYPE } from './policy.mjs';

const ADO = { org: 'contoso', project: 'Payments', pat: 'pat' };
const GH = { owner: 'motivity', token: 'ghp_x' };

const policy = (over = {}, settings = {}) => ({
  type: { id: BUILD_VALIDATION_TYPE }, isEnabled: true, isBlocking: true,
  settings: { buildDefinitionId: 42, manualQueueOnly: false, queueOnSourceUpdateOnly: true, ...settings },
  ...over,
});
const audit = (value) => adoPolicy({ ...ADO, transport: recorder([{ value }]) }).audit('api-neelias', 'main');

describe('Azure DevOps audit', () => {
  test('a healthy policy passes with no findings', async () => {
    const a = await audit([policy()]);
    assert.ok(auditOk(a));
    assert.deepEqual(a.findings, []);
    assert.match(auditSummary(a), /present and blocking/);
  });

  test('no policy at all', async () => {
    const a = await audit([]);
    assert.equal(a.present, false);
    assert.ok(!auditOk(a));
    assert.match(auditSummary(a), /no spec gate/);
  });

  test('a policy of another type is not a spec gate', async () => {
    // A minimum-reviewers policy is not this.
    const a = await audit([{ type: { id: 'fa4e907d-c16b-4a4c-9dfa-4906e5d171dd' }, isEnabled: true, isBlocking: true }]);
    assert.equal(a.present, false);
  });

  test('an advisory policy is reported as not a gate', async () => {
    // The silent failure: it runs, it reports, it cannot block.
    const a = await audit([policy({ isBlocking: false })]);
    assert.equal(a.present, true);
    assert.equal(a.blocking, false);
    assert.ok(!auditOk(a));
    assert.match(auditSummary(a), /ADVISORY/);
    assert.match(a.findings.map((f) => f.message).join(' '), /cannot fail the merge/);
  });

  test('a disabled policy is a blocker', async () => {
    const a = await audit([policy({ isEnabled: false })]);
    assert.ok(!auditOk(a));
    assert.match(a.findings.map((f) => f.message).join(' '), /disabled/);
  });

  test('manualQueueOnly is a blocker — a gate that runs only when someone remembers', async () => {
    const a = await audit([policy({}, { manualQueueOnly: true })]);
    assert.ok(!auditOk(a));
    assert.match(a.findings.map((f) => f.message).join(' '), /only runs if someone remembers/);
  });

  test('not re-running on push is a warning, not a blocker', async () => {
    const a = await audit([policy({}, { queueOnSourceUpdateOnly: false })]);
    assert.ok(auditOk(a));
    assert.deepEqual(a.findings.map((f) => f.severity), ['warning']);
    assert.match(a.findings[0].message, /later push is ungated/);
  });

  test('several build policies are ambiguous', async () => {
    const a = await audit([policy(), policy()]);
    assert.ok(auditOk(a));
    assert.match(a.findings.map((f) => f.message).join(' '), /which one is the gate/);
  });

  test('the audit queries the specific branch and repo', async () => {
    const t = recorder([{ value: [] }]);
    await adoPolicy({ ...ADO, transport: t }).audit('api-neelias', 'release/24');
    assert.match(t.last().url, /refName=refs\/heads\/release\/24/);
    assert.match(t.last().url, /repositoryId=api-neelias/);
  });
});

describe('Azure DevOps install', () => {
  test('install always sets blocking — there is no flag to turn it off', async () => {
    const t = recorder();
    await adoPolicy({ ...ADO, transport: t }).install('api-neelias', 'main', '42');
    assert.equal(t.last().body.isBlocking, true);
    assert.equal(t.last().body.isEnabled, true);
    assert.equal(t.last().body.type.id, BUILD_VALIDATION_TYPE);
  });

  test('it scopes to the exact branch and repo', async () => {
    const t = recorder();
    await adoPolicy({ ...ADO, transport: t }).install('api-neelias', 'main', '42');
    const scope = t.last().body.settings.scope[0];
    assert.equal(scope.refName, 'refs/heads/main');
    assert.equal(scope.matchKind, 'Exact');
    assert.equal(scope.repositoryId, 'api-neelias');
  });

  test('a numeric build id is sent as a number', async () => {
    const t = recorder();
    await adoPolicy({ ...ADO, transport: t }).install('api-neelias', 'main', '42');
    assert.equal(t.last().body.settings.buildDefinitionId, 42);
  });
});

describe('GitHub', () => {
  const gh = (raw) => githubPolicy({ ...GH, transport: recorder([raw]) }).audit('api-neelias', 'main');

  test('healthy protection passes', async () => {
    const a = await gh({ required_status_checks: { strict: true, contexts: ['sdd-spec-gate'] }, enforce_admins: { enabled: true } });
    assert.ok(auditOk(a));
  });

  test('no required check means no gate', async () => {
    const a = await gh({ required_status_checks: { strict: true, contexts: [] } });
    assert.equal(a.present, false);
  });

  test('an admin bypass is GitHub\'s version of an advisory gate', async () => {
    const a = await gh({ required_status_checks: { strict: true, contexts: ['g'] }, enforce_admins: { enabled: false } });
    assert.ok(!auditOk(a));
    assert.match(a.findings.map((f) => f.message).join(' '), /administrators can merge past the gate/);
  });

  test('non-strict is a warning', async () => {
    const a = await gh({ required_status_checks: { strict: false, contexts: ['g'] }, enforce_admins: { enabled: true } });
    assert.ok(auditOk(a));
    assert.deepEqual(a.findings.map((f) => f.severity), ['warning']);
  });

  test('install requires the check and enforces admins', async () => {
    const t = recorder();
    await githubPolicy({ ...GH, transport: t }).install('api-neelias', 'main', 'sdd-spec-gate');
    assert.equal(t.last().method, 'PUT');
    assert.deepEqual(t.last().body.required_status_checks.contexts, ['sdd-spec-gate']);
    assert.equal(t.last().body.enforce_admins, true);
  });
});
