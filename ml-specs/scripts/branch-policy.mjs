#!/usr/bin/env node
// Install and audit the branch policy that makes the spec gate blocking.
//
//   node branch-policy.mjs audit api-neelias neelias-pos
//   node branch-policy.mjs install api-neelias --dry-run
//   node branch-policy.mjs audit api-neelias --json
//
// Credentials from the environment: ADO_ORG/ADO_PROJECT/ADO_PAT, or
// GITHUB_OWNER/GITHUB_TOKEN with SDD_SCM_TOOL=github.
// Branch from SDD_PROTECTED_BRANCH (default main); build ref from SDD_BUILD_ID.
//
// Exit code 1 if any branch is ungated.
//
// Why this exists: ci/azure-pipelines.yml describes the checks, but a pipeline
// that runs and reports changes nothing. The gate is the POLICY. And the way a
// gate stops being a gate is silent — someone sets it to advisory on a Friday to
// unblock a release, nothing breaks, no test fails, and merges quietly stop
// being gated until an audit finds the holes months later.

import { adoPolicy, githubPolicy, auditOk, auditSummary } from './lib/policy.mjs';
import { args, colours, transportFor, scmConfig, env, printTranscript } from './lib/cli.mjs';

const { positional, json, dryRun } = args();
const [action, ...repos] = positional;
const C = colours(process.stdout.isTTY && !json);

if (!['install', 'audit'].includes(action) || repos.length === 0) {
  console.error('usage: branch-policy.mjs <install|audit> <repo...> [--dry-run] [--json]');
  process.exit(1);
}

const transport = transportFor(dryRun);
const { tool, config } = scmConfig(transport);
const mgr = tool === 'github' ? githubPolicy(config) : adoPolicy(config);
const branch = env('SDD_PROTECTED_BRANCH', 'main');
const buildRef = env('SDD_BUILD_ID', 'sdd-spec-gate');

if (dryRun && !json) console.log(`${C.bold('dry run')} ${C.dim('— nothing is sent')}\n`);

const results = [];
for (const repo of repos) {
  try {
    results.push(action === 'install'
      ? await mgr.install(repo, branch, buildRef)
      : await mgr.audit(repo, branch));
  } catch (e) {
    results.push({ repo, branch, tool, present: false, blocking: false,
                   findings: [{ severity: 'blocker', message: e.message }] });
  }
}

const allOk = results.every(auditOk);

if (json) {
  console.log(JSON.stringify({ action, branch, tool, ok: allOk, results }, null, 2));
} else {
  for (const r of results) {
    console.log(`  ${auditOk(r) ? C.green('OK  ') : C.red('FAIL')} ${r.repo.padEnd(22)} ${C.dim(branch)}  ${auditSummary(r)}`);
    for (const f of r.findings) {
      const paint = f.severity === 'blocker' ? C.red : C.yellow;
      console.log(`         ${paint(f.severity.padEnd(8))} ${C.dim(f.message)}`);
    }
  }
  console.log();
  console.log(allOk
    ? `  ${C.green('every branch is gated')}`
    : `  ${C.red('an ungated branch means a pull request can merge with no approved spec')}`);
  printTranscript(transport, C);
}

process.exit(allOk ? 0 : 1);
