// The branch policy that makes a pipeline into a gate.
//
// A build that runs and reports changes nothing. The load-bearing artifact is
// the POLICY: build validation, scoped to the protected branch, blocking.
//
// The audit half matters more than the install half. A gate quietly demoted to
// advisory — to unblock a release, reasonably, on a Friday — is how this kind of
// governance dies: nothing breaks, no test fails, and the first anyone notices
// is an audit months later.
//
// Pure Node, no dependencies. Every call goes through an injected transport.

import { basicAuth, request } from './http.mjs';

/** ADO's well-known policy type for "Build validation". */
export const BUILD_VALIDATION_TYPE = '0609b952-1397-4640-95ec-e00a01b2c241';

export function adoPolicy({ org, project, pat, apiVersion = '7.1', transport = request }) {
  const base = `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_apis`;
  const headers = { Authorization: basicAuth('', pat) };

  return {
    tool: 'ado-repos',

    async install(repo, branch, buildRef) {
      await transport(`${base}/policy/configurations?api-version=${apiVersion}`, {
        method: 'POST', headers,
        body: {
          isEnabled: true,
          isBlocking: true,          // the whole point; there is no flag to turn this off here
          type: { id: BUILD_VALIDATION_TYPE },
          settings: {
            buildDefinitionId: /^\d+$/.test(String(buildRef)) ? Number(buildRef) : buildRef,
            displayName: 'SDD spec gate',
            manualQueueOnly: false,
            queueOnSourceUpdateOnly: true,
            validDuration: 720,
            scope: [{ refName: `refs/heads/${branch}`, matchKind: 'Exact', repositoryId: repo }],
          },
        },
      });
      return { repo, branch, tool: 'ado-repos', present: true, blocking: true, findings: [] };
    },

    async audit(repo, branch) {
      const res = await transport(
        `${base}/policy/configurations?repositoryId=${encodeURIComponent(repo)}` +
        `&refName=refs/heads/${branch}&api-version=${apiVersion}`, { headers });

      const builds = (res.value ?? []).filter((c) => c.type?.id === BUILD_VALIDATION_TYPE);
      if (!builds.length) {
        return { repo, branch, tool: 'ado-repos', present: false, blocking: false,
                 findings: [{ severity: 'blocker', message: `no build-validation policy on refs/heads/${branch}` }] };
      }

      const p = builds[0];
      const s = p.settings ?? {};
      const findings = [];
      if (!p.isEnabled) findings.push({ severity: 'blocker', message: 'policy exists but is disabled' });
      if (!p.isBlocking) findings.push({ severity: 'blocker', message: 'policy is advisory — the build reports but cannot fail the merge' });
      if (s.manualQueueOnly) findings.push({ severity: 'blocker', message: 'manualQueueOnly is set — the gate only runs if someone remembers' });
      if (s.queueOnSourceUpdateOnly === false) findings.push({ severity: 'warning', message: 'does not re-run on source update; a later push is ungated' });
      if (builds.length > 1) findings.push({ severity: 'warning', message: `${builds.length} build policies on this branch — which one is the gate?` });

      return { repo, branch, tool: 'ado-repos', present: true,
               blocking: Boolean(p.isBlocking && p.isEnabled), findings };
    },
  };
}

export function githubPolicy({ owner, token, apiBase = 'https://api.github.com', transport = request }) {
  const headers = { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
  const url = (repo, branch) => `${apiBase}/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}/protection`;

  return {
    tool: 'github',

    async install(repo, branch, buildRef) {
      await transport(url(repo, branch), { method: 'PUT', headers, body: {
        required_status_checks: { strict: true, contexts: [buildRef] },
        enforce_admins: true,
        required_pull_request_reviews: { required_approving_review_count: 1 },
        restrictions: null,
      } });
      return { repo, branch, tool: 'github', present: true, blocking: true, findings: [] };
    },

    async audit(repo, branch) {
      const raw = await transport(url(repo, branch), { headers });
      const contexts = raw.required_status_checks?.contexts ?? [];
      if (!contexts.length) {
        return { repo, branch, tool: 'github', present: false, blocking: false,
                 findings: [{ severity: 'blocker', message: `no required status check on ${branch}` }] };
      }
      const findings = [];
      if (!raw.required_status_checks?.strict) {
        findings.push({ severity: 'warning', message: 'strict is off — a stale branch can merge without re-running the gate' });
      }
      // On GitHub an admin bypass is the equivalent of an advisory policy.
      if (!raw.enforce_admins?.enabled) {
        findings.push({ severity: 'blocker', message: 'enforce_admins is off — administrators can merge past the gate' });
      }
      return { repo, branch, tool: 'github', present: true,
               blocking: !findings.some((f) => f.severity === 'blocker'), findings };
    },
  };
}

export const auditOk = (a) => a.present && a.blocking && !a.findings.some((f) => f.severity === 'blocker');

export const auditSummary = (a) =>
  !a.present ? 'no spec gate on this branch'
  : !a.blocking ? 'spec gate is ADVISORY — it cannot fail the merge, so it is not a gate'
  : 'spec gate present and blocking';
