#!/usr/bin/env node
// Governed sync between a spec and its work item in Azure DevOps or Jira.
//
//   node tracker-sync.mjs 0031 --dry-run       # print the exact requests, send nothing
//   node tracker-sync.mjs 0031
//   node tracker-sync.mjs 0031 --json
//
// Credentials from the environment: ADO_ORG/ADO_PROJECT/ADO_PAT, or
// JIRA_BASE_URL/JIRA_EMAIL/JIRA_API_TOKEN/JIRA_PROJECT_KEY with SDD_PM_TOOL=jira.
//
// Exit code 1 if the link is broken or a write is refused.
//
// Why this exists: the spec lives in the repo and the work item lives in the
// tracker, and both can hold a title, a status and a list of criteria. Two
// stores for one truth diverge silently. So exactly one system may write each
// field — the spec owns the CONTRACT, the tracker owns the SCHEDULE — and an
// attempt to write the other's field is refused rather than winning.
//
// Test cases are pushed as a DERIVATION of approved criteria, never authored
// beside them: that is what turns QA from an author into an auditor of something
// the Product Owner already signed off.

import { listSpecs } from './lib/specs.mjs';
import { adoTracker, jiraTracker, governedWriter, readOnly } from './lib/tracker.mjs';
import { testCaseId } from './lib/trace.mjs';
import { args, colours, transportFor, trackerConfig, printTranscript } from './lib/cli.mjs';

const { positional, json, dryRun, root } = args();
const [target] = positional;
const C = colours(process.stdout.isTTY && !json);

if (!target) { console.error('usage: tracker-sync.mjs <spec-id> [--dry-run] [--json]'); process.exit(1); }

const spec = listSpecs(root).find((s) => s.id === target || s.file.endsWith(target));
if (!spec) { console.error(`no spec matching "${target}" under ${root}`); process.exit(1); }

const transport = transportFor(dryRun);
const { tool, config } = trackerConfig(transport);
const tracker = tool === 'jira' ? jiraTracker(config) : adoTracker(config);
const writer = governedWriter(tracker);

if (dryRun && !json) console.log(`${C.bold('dry run')} ${C.dim('— nothing is sent')}\n`);

const out = { spec: spec.id, tool, link: null, pushed: 0, refused: [] };

// --- pull: does the tracker still point at this spec? -----------------------
if (!spec.ticket) {
  out.link = { ok: false, detail: `spec ${spec.id} has no Ticket in its header table` };
} else {
  const item = await readOnly(tracker).getWorkItem(spec.ticket);
  out.link = !item
    ? { ok: false, detail: `work item ${spec.ticket} not found in ${tool}` }
    : item.specKey && item.specKey !== spec.id
      ? { ok: false, detail: `work item ${item.id} carries SPEC-${item.specKey}, expected ${spec.id}` }
      : { ok: true, detail: `${spec.id} <-> ${tool}#${item.id}`, status: item.status };
}

// --- push: test cases, derived only from approved criteria ------------------
if (!spec.status || spec.status === 'Draft') {
  out.refused.push('spec is Draft — nothing crosses the approval gate');
} else if (!(spec.criteria ?? []).length) {
  out.refused.push('no acceptance criteria to derive test cases from');
} else if (out.link?.ok) {
  const cases = spec.criteria.map((ac) => ({
    id: testCaseId(spec.id, ac.ordinal),
    title: ac.text,
    from: ac.id,
    specKey: spec.id,
    steps: [
      `Set up the preconditions described by ${spec.id} "${spec.title}".`,
      `Exercise the behaviour: ${ac.text}`,
      `Assert the criterion holds, and record the result against ${ac.id}.`,
    ],
  }));
  try { out.pushed = (await writer.pushTestCases(spec, cases)).length; }
  catch (e) { out.refused.push(e.message); }
}

const ok = Boolean(out.link?.ok) && out.refused.length === 0;

if (json) {
  console.log(JSON.stringify({ ...out, ok }, null, 2));
} else {
  console.log(`  ${out.link.ok ? C.green('link  ') : C.red('link  ')} ${out.link.detail}`);
  if (out.pushed) console.log(`  ${C.green('push  ')} ${out.pushed} test case(s) derived from acceptance criteria`);
  for (const r of out.refused) console.log(`  ${C.dim(`skip   ${r}`)}`);
  console.log(`\n  ${C.dim('the spec owns the contract; the tracker owns status, assignee and sprint')}`);
  printTranscript(transport, C);
}

process.exit(ok ? 0 : 1);
