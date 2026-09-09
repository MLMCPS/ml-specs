// Contract tests for the tracker clients.
//
// These cannot prove a remote accepts the request — only a live organisation can
// do that. They prove the client builds the document the API DOCUMENTS, which is
// where the bugs actually are: a wrong JSON-patch path, a field written directly
// that Jira only moves through a transition, a missing content type.
//
// Every call goes through the injected recorder, so none of this touches a network.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { recorder } from './http.mjs';
import { adoTracker, jiraTracker, readOnly, governedWriter, specKeyFromText, FIELD_OWNER } from './tracker.mjs';

const ADO = { org: 'contoso', project: 'Payments Core', pat: 's3cret' };
const JIRA = { baseUrl: 'https://contoso.atlassian.net', email: 'bot@m.example', apiToken: 't0ken', projectKey: 'PAY' };
const ops = (body) => Object.fromEntries(body.map((o) => [o.path, o.value]));
const decode = (h) => Buffer.from(h.replace('Basic ', ''), 'base64').toString();

const SPEC = { id: '0031', title: 'Idempotent refund submission', status: 'Approved', ticket: '1847' };
const CASE = { id: 'TC-0031.1', title: 'replay returns the original', from: 'AC-1', specKey: '0031', steps: ['a < b & c'] };

describe('Azure DevOps', () => {
  test('auth is Basic with an empty username', async () => {
    // ADO's documented scheme: empty user, PAT as the password.
    const { basicAuth } = await import('./http.mjs');
    assert.equal(decode(basicAuth('', 's3cret')), ':s3cret');
  });

  test('a project with a space is url-encoded, api-version pinned', async () => {
    const t = recorder();
    await adoTracker({ ...ADO, transport: t }).getWorkItem('1847');
    assert.match(t.last().url, /\/Payments%20Core\/_apis\/wit\/workitems\/1847/);
    assert.match(t.last().url, /api-version=7\.1/);
  });

  test('create uses json-patch and stamps the key into the title', async () => {
    const t = recorder();
    await adoTracker({ ...ADO, transport: t })
      .createWorkItem({ title: 'Payment hold', type: 'User Story', description: 'why', specKey: '0031' });
    assert.equal(t.last().method, 'POST');
    assert.equal(t.last().contentType, 'application/json-patch+json');
    assert.match(t.last().url, /\/wit\/workitems\/\$User%20Story/);
    assert.equal(ops(t.last().body)['/fields/System.Title'], '[SPEC-0031] Payment hold');
  });

  test('a parent is linked as Hierarchy-Reverse', async () => {
    const t = recorder();
    await adoTracker({ ...ADO, transport: t })
      .createWorkItem({ title: 'child', type: 'Task', specKey: '0031', parentId: '900' });
    const rel = ops(t.last().body)['/relations/-'];
    assert.equal(rel.rel, 'System.LinkTypes.Hierarchy-Reverse');
    assert.match(rel.url, /\/wit\/workItems\/900$/);
  });

  test('field names map to ADO reference names', async () => {
    const t = recorder();
    await adoTracker({ ...ADO, transport: t }).updateFields('1847', { status: 'Active', sprint: 'Payments\\Sprint 4' });
    const o = ops(t.last().body);
    assert.equal(o['/fields/System.State'], 'Active');
    assert.equal(o['/fields/System.IterationPath'], 'Payments\\Sprint 4');
    assert.equal(t.last().method, 'PATCH');
  });

  test('a contract-owned field has no mapping, so it cannot be sent', async () => {
    const t = recorder();
    await adoTracker({ ...ADO, transport: t }).updateFields('1847', { title: 'rewritten' });
    assert.deepEqual(ops(t.last().body), {});
  });

  test('find queries WIQL on the key', async () => {
    const t = recorder([{ workItems: [] }]);
    await adoTracker({ ...ADO, transport: t }).findBySpec('0031');
    assert.match(t.calls[0].body.query, /SPEC-0031/);
    assert.match(t.calls[0].body.query, /@project/);
  });

  test('test cases link back and escape their steps', async () => {
    const t = recorder();
    await adoTracker({ ...ADO, transport: t }).createTestCases('1847', [CASE]);
    const o = ops(t.last().body);
    assert.match(t.last().url, /\$Test%20Case/);
    assert.equal(o['/fields/System.Title'], 'TC-0031.1 replay returns the original');
    assert.match(o['/fields/Microsoft.VSTS.TCM.Steps'], /a &lt; b &amp; c/);
    assert.equal(o['/relations/-'].rel, 'Microsoft.VSTS.Common.TestedBy-Reverse');
  });
});

describe('Jira', () => {
  test('the neutral type is mapped and the description is ADF', async () => {
    const t = recorder([{ key: 'PAY-9' }, { key: 'PAY-9', fields: {} }]);
    await jiraTracker({ ...JIRA, transport: t })
      .createWorkItem({ title: 'Payment hold', type: 'User Story', description: 'why', specKey: '0031' });
    const f = t.calls[0].body.fields;
    assert.equal(f.issuetype.name, 'Story');            // not "User Story"
    assert.equal(f.summary, '[SPEC-0031] Payment hold');
    assert.equal(f.description.type, 'doc');            // Jira rejects a plain string
  });

  test('status moves through a transition, never a field write', async () => {
    // The instructive difference from ADO, and the reason two adapters ship.
    const t = recorder([
      { transitions: [{ id: '31', name: 'Start', to: { name: 'In Progress' } }] },
      null,
      { key: 'PAY-9', fields: { status: { name: 'In Progress' } } },
    ]);
    await jiraTracker({ ...JIRA, transport: t }).updateFields('PAY-9', { status: 'In Progress' });
    assert.equal(t.calls[0].method, 'GET');
    assert.match(t.calls[0].url, /\/transitions$/);
    assert.equal(t.calls[1].body.transition.id, '31');
    assert.ok(!t.calls.some((c) => c.method === 'PUT'));
  });

  test('an impossible transition names what is available', async () => {
    const t = recorder([{ transitions: [{ id: '31', name: 'Start', to: { name: 'In Progress' } }] }]);
    await assert.rejects(
      () => jiraTracker({ ...JIRA, transport: t }).updateFields('PAY-9', { status: 'Done' }),
      /In Progress/);
  });

  test('find builds JQL on the key', async () => {
    const t = recorder([{ issues: [] }]);
    await jiraTracker({ ...JIRA, transport: t }).findBySpec('0031');
    assert.match(decodeURIComponent(t.last().url), /summary ~ "SPEC-0031"/);
  });

  test('test cases are created then linked', async () => {
    const t = recorder([{ key: 'PAY-77' }, null]);
    const created = await jiraTracker({ ...JIRA, transport: t }).createTestCases('PAY-9', [CASE]);
    assert.deepEqual(created, ['PAY-77']);
    assert.match(t.calls[1].url, /\/issueLink$/);
    assert.equal(t.calls[1].body.inwardIssue.key, 'PAY-77');
    assert.equal(t.calls[1].body.outwardIssue.key, 'PAY-9');
  });
});

describe('the ungoverned write path does not exist', () => {
  test('a reader has no write methods, and they cannot be re-attached', () => {
    const reader = readOnly(adoTracker({ ...ADO, transport: recorder() }));
    assert.equal(reader.createWorkItem, undefined);
    assert.equal(reader.updateFields, undefined);
    assert.equal(typeof reader.getWorkItem, 'function');
    assert.throws(() => { 'use strict'; reader.createWorkItem = () => {}; });
  });

  test('nothing reaches the tracker before the approval gate', async () => {
    const w = governedWriter(adoTracker({ ...ADO, transport: recorder() }));
    await assert.rejects(() => w.push({ id: '0031', status: 'Draft', ticket: '1' }, { status: 'Active' }), /before the approval gate/);
    await assert.rejects(() => w.open({ id: '0031', status: 'Draft', title: 'x' }, 'Task'), /before the approval gate/);
  });

  test('a contract-owned field is refused even through the governed path', async () => {
    const w = governedWriter(adoTracker({ ...ADO, transport: recorder() }));
    await assert.rejects(() => w.push(SPEC, { criteria: 'rewritten' }), /owned by the spec/);
    assert.equal(FIELD_OWNER.status, 'board');
    assert.equal(FIELD_OWNER.criteria, 'spec');
  });

  test('test cases from another spec cannot be smuggled onto this work item', async () => {
    const w = governedWriter(adoTracker({ ...ADO, transport: recorder() }));
    await assert.rejects(() => w.pushTestCases(SPEC, [{ ...CASE, specKey: '0019' }]), /not derived from spec 0031/);
  });

  test('an approved spec writes board-owned fields', async () => {
    const t = recorder();
    const item = await governedWriter(adoTracker({ ...ADO, transport: t })).push(SPEC, { status: 'Active' });
    assert.equal(t.last().method, 'PATCH');
    assert.ok(item);
  });
});

describe('key recovery', () => {
  test('the key is read back out of a title or description', () => {
    assert.equal(specKeyFromText('[SPEC-0031] Idempotent refund'), '0031');
    assert.equal(specKeyFromText('a suffixed spec SPEC-0165b here'), '0165b');
    assert.equal(specKeyFromText('no key here'), null);
  });
});
