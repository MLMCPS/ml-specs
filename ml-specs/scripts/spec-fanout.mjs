#!/usr/bin/env node
// One spec, N repos, N pull requests, one key.
//
//   node spec-fanout.mjs 0031 payment.captured --dry-run
//   node spec-fanout.mjs 0031 payment.captured "POST /payments/{id}/capture"
//   node spec-fanout.mjs 0031 --plan            # show the targets, open nothing
//
// Reads docs/ESTATE.md for the contract graph. Credentials from the environment.
// Exit code 1 if any repo fails, or if the spec is not past the approval gate.
//
// Why this exists: a change spanning four services is four pull requests that a
// reviewer correlates by hand and hopes they got right. Every branch here is the
// same derived name, so the four are provably one change — and the impact query
// finds the service one hop out that nobody remembered.
//
// Partial failure is reported, not thrown: with five repos, a permissions error
// on the fourth must not hide that three succeeded. Until there is a queue, the
// caller deciding what to retry is a human, which is why the result has to be
// legible.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { listSpecs } from './lib/specs.mjs';
import { parseEstate, impactOf } from './lib/estate.mjs';
import { adoRepos, github, governedScm, pullRequestBody, fanOutTargets } from './lib/scm.mjs';
import * as knowledge from './lib/knowledge.mjs';
import { args, colours, transportFor, scmConfig, env, printTranscript } from './lib/cli.mjs';

const { positional, json, dryRun, has, root } = args();
const [target, ...contracts] = positional;
const C = colours(process.stdout.isTTY && !json);

if (!target) { console.error('usage: spec-fanout.mjs <spec-id> [contract...] [--plan] [--dry-run]'); process.exit(1); }

const spec = listSpecs(root).find((s) => s.id === target || s.file.endsWith(target));
if (!spec) { console.error(`no spec matching "${target}" under ${root}`); process.exit(1); }

const estatePath = join(root, 'docs', 'ESTATE.md');
const index = existsSync(estatePath) ? parseEstate(readFileSync(estatePath, 'utf8')) : { repos: [] };

// "Who else breaks?" answered from an index that does not exist is a FALSE
// ALL-CLEAR, and a confident one: an empty list and a zero exit read as "nothing
// else is affected". That is the most expensive wrong answer this script can
// give, so it refuses to answer at all rather than answer emptily.
if (contracts.length && index.repos.length === 0) {
  console.error(
    `cannot say who else breaks: ${existsSync(estatePath) ? `${estatePath} lists no services` : 'no docs/ESTATE.md'}.\n` +
    `An empty answer here is indistinguishable from "nothing is affected", which is why this ` +
    `refuses rather than reporting none. Run /repo-estate to build the index, then retry.`);
  process.exit(1);
}

const impact = contracts.length ? impactOf(index, contracts) : null;
const targets = fanOutTargets(spec, impact);

// No targets at all means the spec names no repos and nothing consumes what it
// touches. Opening zero pull requests silently is the same class of quiet
// non-answer, so say which of the two it is.
if (targets.length === 0) {
  console.error(
    `spec ${spec.id} fans out to nothing: it names no repos in its header table` +
    `${contracts.length ? ', and no service in the estate index consumes ' + contracts.join(', ') : ''}.\n` +
    `Add a "Project / service" row to the spec, or pass the contracts this change touches.`);
  process.exit(1);
}
const constraints = knowledge.forRepos(
  knowledge.read(join(root, 'docs', 'CONSTRAINTS.md')), spec.repos ?? []);

if (!json) {
  console.log(`${C.bold(`SPEC-${spec.id}`)} ${spec.title}  ${C.dim(spec.status ?? 'unknown')}`);
  console.log(`${C.dim(`branch: ${targets[0]?.branch ?? '(none)'}`)}\n`);
  for (const d of impact?.directlyAffected ?? []) console.log(`  ${C.red('direct')}   ${d.repo.padEnd(22)} ${C.dim(d.via.join(', '))}`);
  for (const t of impact?.transitivelyAffected ?? []) console.log(`  ${C.dim(`one hop  ${t.repo.padEnd(22)} ${t.via.join(', ')}`)}`);
}

if (has('plan')) {
  if (json) console.log(JSON.stringify({ spec: spec.id, targets, impact }, null, 2));
  else { console.log(`\n${C.bold('would open')}`); for (const t of targets) console.log(`  ${t.repo.padEnd(22)} ${t.branch}  ${C.dim(t.reason)}`); }
  process.exit(0);
}

const transport = transportFor(dryRun);
const { tool, config } = scmConfig(transport);
const scm = governedScm(tool === 'github' ? github(config) : adoRepos(config),
                        { target: env('SDD_PROTECTED_BRANCH', 'main') });

if (dryRun && !json) console.log(`\n${C.bold('dry run')} ${C.dim('— nothing is sent')}`);

const results = [];
for (const t of targets) {
  try {
    const { pr } = await scm.openFor(spec, t.repo, pullRequestBody(spec, t.reason, { constraints }));
    results.push({ ...t, pr, error: null });
  } catch (e) {
    // One repo failing must not stop the rest.
    results.push({ ...t, pr: null, error: e.message });
  }
}

const opened = results.filter((r) => r.pr);
const failed = results.filter((r) => r.error);
const oneChange = new Set(results.map((r) => r.branch)).size <= 1;

if (json) {
  console.log(JSON.stringify({ spec: spec.id, oneChange, opened: opened.length, failed: failed.length, results }, null, 2));
} else {
  console.log(`\n${C.bold('pull requests')}`);
  for (const r of results) {
    console.log(r.pr
      ? `  ${C.green('opened')}  ${r.repo.padEnd(22)} ${r.pr.url}  ${C.dim(r.reason)}`
      : `  ${C.red('failed')}  ${r.repo.padEnd(22)} ${C.dim(r.error)}`);
  }
  console.log();
  console.log(oneChange ? `  ${C.green(`one change across ${results.length} repo(s)`)}`
                        : `  ${C.red('branches diverged — not one change')}`);
  if (failed.length) console.log(`  ${C.red(`${failed.length} failed`)}${C.dim(`; ${opened.length} open`)}`);
  printTranscript(transport, C);
}

process.exit(failed.length === 0 ? 0 : 1);
