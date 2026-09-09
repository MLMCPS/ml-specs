// Source control: branches and pull requests, for ADO Repos and GitHub.
//
// Deliberately separate from lib/tracker.mjs. A work item and a pull request are
// different objects owned by different systems, and they diverge under exactly
// the load this exists for: one spec fans out to N repositories but links to ONE
// work item, so the cardinality differs. GitHub-plus-Jira is also an ordinary
// combination that a merged interface could not express.
//
// GitHub ships alongside ADO because these customers migrate there for code
// while keeping Boards or Jira for work — the two boundaries move independently.
//
// Pure Node, no dependencies. Every call goes through an injected transport.

import { basicAuth, request } from './http.mjs';
import { branchName, prTitle, keyFrom, specId, testCaseId } from './trace.mjs';

const EMPTY_SHA = '0'.repeat(40);

// --- Azure DevOps Repos ------------------------------------------------------

export function adoRepos({ org, project, pat, apiVersion = '7.1', transport = request }) {
  const repoBase = (repo) =>
    `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}`;
  const headers = { Authorization: basicAuth('', pat) };

  return {
    tool: 'ado-repos',

    async defaultBranchSha(repo, branch = 'main') {
      const res = await transport(`${repoBase(repo)}/refs?filter=heads/${branch}&api-version=${apiVersion}`, { headers });
      const refs = res.value ?? [];
      if (!refs.length) throw new Error(`ADO: ${repo} has no branch ${branch}`);
      return String(refs[0].objectId);
    },

    async createBranch(repo, name, fromSha) {
      // ADO has no "create branch" call — a branch is a ref updated from zeros.
      await transport(`${repoBase(repo)}/refs?api-version=${apiVersion}`, {
        method: 'POST', headers,
        body: [{ name: `refs/heads/${name}`, oldObjectId: EMPTY_SHA, newObjectId: fromSha }],
      });
      return { repo, name, sha: fromSha };
    },

    async openPullRequest(repo, { source, target, title, body }) {
      const raw = await transport(`${repoBase(repo)}/pullrequests?api-version=${apiVersion}`, {
        method: 'POST', headers,
        body: { sourceRefName: `refs/heads/${source}`, targetRefName: `refs/heads/${target}`,
                title, description: body },
      });
      const id = String(raw.pullRequestId ?? '');
      return { repo, id, title, source, target,
               url: `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequest/${id}` };
    },

    async findPullRequests(repo, key) {
      const res = await transport(
        `${repoBase(repo)}/pullrequests?searchCriteria.status=all&api-version=${apiVersion}`, { headers });
      return (res.value ?? [])
        .filter((pr) => keyFrom('prTitle', pr.title ?? '') === key)
        .map((pr) => ({ repo, id: String(pr.pullRequestId), title: pr.title,
          source: String(pr.sourceRefName ?? '').replace(/^refs\/heads\//, ''),
          target: String(pr.targetRefName ?? '').replace(/^refs\/heads\//, ''),
          url: `https://dev.azure.com/${org}/_git/${encodeURIComponent(repo)}/pullrequest/${pr.pullRequestId}` }));
    },
  };
}

// --- GitHub ------------------------------------------------------------------

export function github({ owner, token, apiBase = 'https://api.github.com', transport = request }) {
  const headers = { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
  const url = (repo, path) => `${apiBase}/repos/${owner}/${repo}${path}`;

  return {
    tool: 'github',

    async defaultBranchSha(repo, branch = 'main') {
      const raw = await transport(url(repo, `/git/ref/heads/${branch}`), { headers });
      return String(raw.object.sha);
    },

    async createBranch(repo, name, fromSha) {
      await transport(url(repo, '/git/refs'), {
        method: 'POST', headers, body: { ref: `refs/heads/${name}`, sha: fromSha } });
      return { repo, name, sha: fromSha };
    },

    async openPullRequest(repo, { source, target, title, body }) {
      // The shape difference from ADO: bare head/base, and it is called `body`.
      const raw = await transport(url(repo, '/pulls'), {
        method: 'POST', headers, body: { title, head: source, base: target, body } });
      return { repo, id: String(raw.number ?? ''), title, source, target,
               url: String(raw.html_url ?? `https://github.com/${owner}/${repo}/pulls`) };
    },

    async findPullRequests(repo, key) {
      const raw = await transport(url(repo, '/pulls?state=all&per_page=100'), { headers });
      return (raw ?? [])
        .filter((pr) => keyFrom('prTitle', pr.title ?? '') === key)
        .map((pr) => ({ repo, id: String(pr.number), title: pr.title,
          source: pr.head?.ref ?? '', target: pr.base?.ref ?? '', url: pr.html_url ?? '' }));
    },
  };
}

// --- the governed path -------------------------------------------------------

/** Reads only. Frozen, so the write methods are absent and stay absent. */
export const readOnlyScm = (scm) => Object.freeze({
  tool: scm.tool,
  defaultBranchSha: (repo, branch) => scm.defaultBranchSha(repo, branch),
  findPullRequests: (repo, key) => scm.findPullRequests(repo, key),
});

/**
 * The only way a branch or pull request gets created. A pull request that cannot
 * be traced back to an approved contract is exactly what this exists to prevent,
 * so it is refused here rather than reported later.
 */
export function governedScm(scm, { target = 'main' } = {}) {
  return {
    tool: scm.tool,
    async openFor(spec, repo, body) {
      if (!spec.status || spec.status === 'Draft') {
        throw new Error(`spec ${spec.id} is ${spec.status ?? 'unknown'}; no branch is cut before the approval gate`);
      }
      const name = spec.branch ?? branchName(spec.id, spec.title);
      const title = prTitle(spec.id, spec.title);
      // Both are derived, so these can only fail if a derivation changed without
      // its parser changing with it.
      if (keyFrom('branch', name) !== spec.id) throw new Error(`branch "${name}" does not carry spec ${spec.id}`);
      if (keyFrom('prTitle', title) !== spec.id) throw new Error(`title "${title}" does not carry spec ${spec.id}`);

      const sha = await scm.defaultBranchSha(repo, target);
      const branch = await scm.createBranch(repo, name, sha);
      const pr = await scm.openPullRequest(repo, { source: name, target, title, body });
      return { branch, pr };
    },
  };
}

/**
 * The pull request body. It carries the whole chain so a reviewer never has to
 * hunt, and the criteria arrive as a checklist — their job is to confirm each
 * one, not to infer what the change was for.
 */
export function pullRequestBody(spec, reason, { constraints = [] } = {}) {
  const branch = spec.branch ?? branchName(spec.id, spec.title);
  const lines = [
    `## ${specId(spec.id)} — ${spec.title}`, '',
    `**Why this repo:** ${reason}`,
    `**Spec:** \`${spec.file}\` (status: ${spec.status})`,
  ];
  if (spec.ticket) lines.push(`**Ticket:** ${spec.ticket}`);
  if (spec.repos?.length) lines.push(`**Fan-out:** ${spec.repos.join(', ')}`);
  if (spec.nfrs?.length) lines.push(`**NFRs in force:** ${spec.nfrs.join(', ')}`);

  lines.push('', '## Acceptance criteria', '');
  lines.push(...((spec.criteria ?? []).length
    ? spec.criteria.map((ac) => `- [${ac.checked ? 'x' : ' '}] ${ac.id} (${testCaseId(spec.id, ac.ordinal)}) — ${ac.text}`)
    : ['_none — this spec should not have been approved._']));

  if (constraints.length) {
    lines.push('', '## Constraints in force', '', ...constraints.map((c) => `- **${c.id}** — ${c.text}`));
  }

  lines.push('', '---',
    `Every branch in this fan-out is \`${branch}\`. Same key, so these pull requests are one change.`);
  return lines.join('\n');
}

/** Which repos this change reaches: those named on the spec, plus those the
 *  estate index says consume what it touches. */
export function fanOutTargets(spec, impact = null) {
  const targets = new Map();
  for (const repo of spec.repos ?? []) targets.set(repo, 'named on the spec');
  for (const d of impact?.directlyAffected ?? []) {
    if (!targets.has(d.repo)) targets.set(d.repo, `consumes ${d.via.join(', ')}`);
  }
  for (const t of impact?.transitivelyAffected ?? []) {
    if (!targets.has(t.repo)) targets.set(t.repo, `one hop: consumes ${t.via.join(', ')}`);
  }
  return [...targets].map(([repo, reason]) => ({
    repo, reason,
    branch: spec.branch ?? branchName(spec.id, spec.title),
    title: prTitle(spec.id, spec.title),
  }));
}
