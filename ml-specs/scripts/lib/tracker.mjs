// Azure DevOps and Jira, behind one seam.
//
// Two implementations ship together deliberately. An abstraction with a single
// implementation is a guess about what varies, and it is usually wrong; the
// second one is what proves the seam is in the right place. Jira's differences
// are instructive — status moves through a TRANSITION rather than a field write,
// and there is no native test-case type — and both would have leaked through a
// single-adapter design.
//
// Pure Node, no dependencies. Every call goes through an injected transport.

import { basicAuth, request } from './http.mjs';

// Which system owns which field. The spec in the repo owns the contract; the
// tracker owns the schedule. Two stores for one truth diverge silently unless
// exactly one of them may write each field.
export const FIELD_OWNER = {
  title: 'spec', criteria: 'spec', contract: 'spec', nfrs: 'spec', repos: 'spec',
  status: 'board', assignee: 'board', sprint: 'board', priority: 'board',
};

export const specKeyFromText = (text) => (/SPEC-(\d{3,4}[a-z]?)/.exec(text ?? '') ?? [])[1] ?? null;

// --- Azure DevOps -----------------------------------------------------------

const ADO_FIELD = {
  status: 'System.State', assignee: 'System.AssignedTo',
  sprint: 'System.IterationPath', priority: 'Microsoft.VSTS.Common.Priority',
};

export function adoTracker({ org, project, pat, apiVersion = '7.1', transport = request }) {
  const base = `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_apis`;
  // ADO's documented scheme: empty username, PAT as the password.
  const headers = { Authorization: basicAuth('', pat) };
  const patchType = 'application/json-patch+json';

  const toItem = (raw) => ({
    id: String(raw.id),
    title: raw.fields?.['System.Title'] ?? '',
    status: raw.fields?.['System.State'] ?? '',
    assignee: raw.fields?.['System.AssignedTo']?.uniqueName ?? null,
    sprint: raw.fields?.['System.IterationPath'] ?? null,
    url: `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_workitems/edit/${raw.id}`,
    specKey: specKeyFromText(`${raw.fields?.['System.Title'] ?? ''} ${raw.fields?.['System.Description'] ?? ''}`),
  });

  return {
    tool: 'ado',

    async getWorkItem(id) {
      try { return toItem(await transport(`${base}/wit/workitems/${id}?api-version=${apiVersion}`, { headers })); }
      catch { return null; }
    },

    async findBySpec(key) {
      const res = await transport(`${base}/wit/wiql?api-version=${apiVersion}`, {
        method: 'POST', headers,
        body: { query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project ` +
                       `AND [System.Title] CONTAINS 'SPEC-${key}'` },
      });
      const items = await Promise.all((res.workItems ?? []).map((w) => this.getWorkItem(String(w.id))));
      return items.filter(Boolean);
    },

    async createWorkItem({ title, type, description, specKey, parentId }) {
      const patch = [
        { op: 'add', path: '/fields/System.Title', value: `[SPEC-${specKey}] ${title}` },
        { op: 'add', path: '/fields/System.Description', value: description ?? '' },
      ];
      if (parentId) patch.push({ op: 'add', path: '/relations/-',
        value: { rel: 'System.LinkTypes.Hierarchy-Reverse', url: `${base}/wit/workItems/${parentId}` } });
      return toItem(await transport(
        `${base}/wit/workitems/$${encodeURIComponent(type)}?api-version=${apiVersion}`,
        { method: 'POST', headers, body: patch, contentType: patchType }));
    },

    async updateFields(id, fields) {
      const patch = Object.entries(fields)
        .filter(([k]) => ADO_FIELD[k])
        .map(([k, v]) => ({ op: 'add', path: `/fields/${ADO_FIELD[k]}`, value: v }));
      return toItem(await transport(`${base}/wit/workitems/${id}?api-version=${apiVersion}`,
        { method: 'PATCH', headers, body: patch, contentType: patchType }));
    },

    async createTestCases(workItemId, cases) {
      const created = [];
      for (const tc of cases) {
        const steps = tc.steps.map((s) =>
          `<step><parameterizedString>${escapeXml(s)}</parameterizedString></step>`).join('');
        const raw = await transport(`${base}/wit/workitems/$Test%20Case?api-version=${apiVersion}`, {
          method: 'POST', headers, contentType: patchType,
          body: [
            { op: 'add', path: '/fields/System.Title', value: `${tc.id} ${tc.title}` },
            { op: 'add', path: '/fields/Microsoft.VSTS.TCM.Steps', value: steps },
            { op: 'add', path: '/relations/-',
              value: { rel: 'Microsoft.VSTS.Common.TestedBy-Reverse', url: `${base}/wit/workItems/${workItemId}` } },
          ],
        });
        created.push(String(raw.id));
      }
      return created;
    },
  };
}

const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// --- Jira --------------------------------------------------------------------

const JIRA_TYPE = { Epic: 'Epic', Feature: 'Story', 'User Story': 'Story', Task: 'Task' };

/** Jira Cloud wants Atlassian Document Format, not a string. */
const adf = (text) => ({ type: 'doc', version: 1,
  content: String(text ?? '').split('\n\n').map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p || ' ' }] })) });

export function jiraTracker({ baseUrl, email, apiToken, projectKey, testCaseIssueType = 'Test', transport = request }) {
  const headers = { Authorization: basicAuth(email, apiToken) };
  const call = (path, opts = {}) => transport(`${baseUrl}${path}`, { headers, ...opts });

  const toItem = (raw) => ({
    id: raw.key,
    title: raw.fields?.summary ?? '',
    status: raw.fields?.status?.name ?? '',
    assignee: raw.fields?.assignee?.emailAddress ?? null,
    sprint: raw.fields?.sprint?.name ?? null,
    url: `${baseUrl}/browse/${raw.key}`,
    specKey: specKeyFromText(raw.fields?.summary),
  });

  async function transition(id, toStatus) {
    const { transitions = [] } = await call(`/rest/api/3/issue/${id}/transitions`);
    const match = transitions.find((t) =>
      t.to?.name?.toLowerCase() === toStatus.toLowerCase() || t.name?.toLowerCase() === toStatus.toLowerCase());
    if (!match) {
      throw new Error(`Jira ${id} has no transition to "${toStatus}" ` +
        `(available: ${transitions.map((t) => t.to?.name).join(', ') || 'none'})`);
    }
    await call(`/rest/api/3/issue/${id}/transitions`, { method: 'POST', body: { transition: { id: match.id } } });
  }

  return {
    tool: 'jira',

    async getWorkItem(id) {
      try { return toItem(await call(`/rest/api/3/issue/${id}`)); } catch { return null; }
    },

    async findBySpec(key) {
      const jql = `project = "${projectKey}" AND summary ~ "SPEC-${key}"`;
      const res = await call(`/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=50`);
      return (res.issues ?? []).map(toItem);
    },

    async createWorkItem({ title, type, description, specKey, parentId }) {
      const fields = {
        project: { key: projectKey },
        summary: `[SPEC-${specKey}] ${title}`,
        issuetype: { name: JIRA_TYPE[type] ?? 'Task' },
        description: adf(description),
        ...(parentId ? { parent: { key: parentId } } : {}),
      };
      const created = await call('/rest/api/3/issue', { method: 'POST', body: { fields } });
      const item = await this.getWorkItem(created.key);
      if (!item) throw new Error(`Jira created ${created.key} but it could not be read back`);
      return item;
    },

    async updateFields(id, fields) {
      // The instructive difference from ADO: status is a transition, not a write.
      if (fields.status) await transition(id, fields.status);

      const direct = {};
      if (fields.assignee) direct.assignee = { emailAddress: fields.assignee };
      if (fields.priority) direct.priority = { name: fields.priority };
      if (Object.keys(direct).length) await call(`/rest/api/3/issue/${id}`, { method: 'PUT', body: { fields: direct } });

      const item = await this.getWorkItem(id);
      if (!item) throw new Error(`no Jira issue ${id}`);
      return item;
    },

    async createTestCases(workItemId, cases) {
      const created = [];
      for (const tc of cases) {
        const res = await call('/rest/api/3/issue', { method: 'POST', body: { fields: {
          project: { key: projectKey },
          summary: `${tc.id} ${tc.title}`,
          issuetype: { name: testCaseIssueType },
          description: adf([`Derived from ${tc.from} of SPEC-${tc.specKey}.`, ...tc.steps].join('\n')),
        } } });
        await call('/rest/api/3/issueLink', { method: 'POST', body: {
          type: { name: 'Relates' }, inwardIssue: { key: res.key }, outwardIssue: { key: workItemId } } });
        created.push(res.key);
      }
      return created;
    },
  };
}

// --- capability split (the ungoverned path) ----------------------------------

/**
 * What the intent plane is allowed to hold.
 *
 * A direct path from planning into the tracker that bypasses the spec becomes
 * the path everyone uses, because it is faster and nobody is watching. This
 * returns a FROZEN object carrying only the read methods, so the write methods
 * are absent at runtime and cannot be re-attached — the shortcut is not policed,
 * it cannot be expressed.
 */
export const readOnly = (tracker) => Object.freeze({
  tool: tracker.tool,
  getWorkItem: (id) => tracker.getWorkItem(id),
  findBySpec: (key) => tracker.findBySpec(key),
});

/**
 * The single governed write path: the spec must be past the approval gate, and
 * only board-owned fields may be written.
 */
export function governedWriter(tracker) {
  const assertWritable = (field) => {
    const owner = FIELD_OWNER[field];
    if (owner && owner !== 'board') {
      throw new Error(`"${field}" is owned by the spec; the board may read it but not write it`);
    }
  };
  const assertApproved = (spec) => {
    if (!spec.status || spec.status === 'Draft') {
      throw new Error(`spec ${spec.id} is ${spec.status ?? 'unknown'}; nothing reaches ${tracker.tool} before the approval gate`);
    }
  };

  return {
    tool: tracker.tool,

    async push(spec, fields) {
      assertApproved(spec);
      if (!spec.ticket) throw new Error(`spec ${spec.id} has no linked work item to write to`);
      for (const f of Object.keys(fields)) assertWritable(f);
      return tracker.updateFields(spec.ticket, fields);
    },

    async open(spec, type, parentId) {
      assertApproved(spec);
      return tracker.createWorkItem({ title: spec.title, type, description: '', specKey: spec.id, parentId });
    },

    async pushTestCases(spec, cases) {
      assertApproved(spec);
      if (!spec.ticket) throw new Error(`spec ${spec.id} has no linked work item`);
      const foreign = cases.find((c) => c.specKey !== spec.id);
      if (foreign) throw new Error(`${foreign.id} was not derived from spec ${spec.id}`);
      return tracker.createTestCases(spec.ticket, cases);
    },
  };
}
