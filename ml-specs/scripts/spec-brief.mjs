#!/usr/bin/env node
// Package an approved spec for whoever implements it — a person, or an agent.
// Pure Node, no dependencies. Read-only. No network calls.
//
//   node spec-brief.mjs 0031                      # to stdout
//   node spec-brief.mjs 0031 --repo api-neelias
//   node spec-brief.mjs 0031 --out brief.md
//   node spec-brief.mjs 0031 --root /path/to/repo
//
// Exit code 1 if the spec is not past the approval gate.
//
// Why this exists: an approved spec is a contract, but it is scattered — the
// criteria are in one section, the constraints in force are in another file, and
// the gates that will fail the build are in a third. Whoever implements it has
// to assemble that themselves, and the parts most often skipped are the ones
// that cause the rework.
//
// A brief is deliberately NOT a prompt. It is the same document whether a person
// or an agent implements the spec, because anything an agent would need that a
// new engineer would not is a sign the spec is underspecified — and the fix for
// that belongs in the spec, not in a wrapper around it.

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listSpecs } from './lib/specs.mjs';
import { specId, branchName, prTitle, testCaseId } from './lib/trace.mjs';
import { compile, parseNfrMarkdown } from './lib/nfr.mjs';
import * as knowledge from './lib/knowledge.mjs';

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : (argv[i + 1] ?? d); };

const root = flag('root', process.cwd());
const target = argv.find((a, i) => !a.startsWith('--') && !String(argv[i - 1] ?? '').startsWith('--'));
if (!target) { console.error('usage: spec-brief.mjs <spec-id|path> [--repo r] [--out f] [--root path]'); process.exit(1); }

const spec = listSpecs(root).find((s) => s.id === target || s.file.endsWith(target) || s.file === target);
if (!spec) { console.error(`no spec matching "${target}" under ${root}`); process.exit(1); }

// The contract is still being negotiated until the gate passes; there is nothing
// stable to build against.
if (!spec.status || spec.status === 'Draft') {
  console.error(`spec ${spec.id} is ${spec.status ?? 'unknown'} — nothing is handed to an implementer ` +
                `before the approval gate. The contract is still being negotiated.`);
  process.exit(1);
}

// A brief exists to state the definition of done. Without criteria there is no
// definition of done, so emitting one that says so in prose and proceeding is
// worse than refusing: it hands an implementer a document whose whole purpose is
// missing, over a heading that claims to supply it. spec-gate.mjs already fails
// this spec; the two must agree, or one of them is lying.
if (!(spec.criteria ?? []).length) {
  console.error(`spec ${spec.id} is ${spec.status} but has no acceptance criteria — there is ` +
                `nothing to build against, and nothing to verify. Fix the spec (and the approval ` +
                `that let it through) rather than starting from a brief with no definition of done.`);
  process.exit(1);
}

const repo = flag('repo', spec.repos?.[0] ?? '.');
const branch = spec.branch ?? branchName(spec.id, spec.title);

const nfrPath = join(root, 'docs', 'NFRS.md');
const allNfrs = existsSync(nfrPath) ? parseNfrMarkdown(readFileSync(nfrPath, 'utf8')) : [];
const gates = (spec.nfrs ?? [])
  .map((id) => allNfrs.find((n) => n.id === id))
  .filter(Boolean)
  .map((n) => { try { return compile(n).gate; } catch { return null; } })
  .filter(Boolean);

const inForce = knowledge.forRepos(
  knowledge.read(join(root, 'docs', 'CONSTRAINTS.md')),
  spec.repos?.length ? spec.repos : [repo]);

const section = (name) => {
  const body = readFileSync(join(root, spec.file), 'utf8');
  const re = new RegExp(`^##\\s*(?:\\d+\\.\\s*)?${name}\\b.*$`, 'im');
  const m = re.exec(body);
  if (!m) return '';
  return body.slice(m.index + m[0].length).split(/\n##\s/)[0].trim();
};

const lines = [
  `# ${specId(spec.id)} — ${spec.title}`, '',
  `**Repo:** \`${repo}\`  `,
  `**Branch:** \`${branch}\`  `,
  `**Pull request title:** \`${prTitle(spec.id, spec.title)}\`  `,
  `**Status:** ${spec.status}${spec.ticket ? `  ·  **Ticket:** ${spec.ticket}` : ''}`, '',
];

const contract = section('Contract') || section('Scope') || section('Problem');
if (contract) lines.push('## The contract', '', contract, '');

lines.push('## Definition of done', '',
  'Every criterion below has a test case id already reserved for it. The change is ' +
  'done when each one passes — not when the code looks finished.', '');
for (const ac of spec.criteria ?? []) {
  lines.push(`- **${ac.id}** (${testCaseId(spec.id, ac.ordinal)}) — ${ac.text}`);
}


if (inForce.length) {
  lines.push('', '## Constraints in force', '',
    'Not negotiable within this change. They come from the knowledge layer and ' +
    'apply to every spec touching this repo.', '',
    ...inForce.map((c) => `- **${c.id}** — ${c.text}`));
}

if (gates.length) {
  lines.push('', '## Gates that will run against this', '',
    'The build fails if any of these does. They are not advisory.', '',
    ...gates.map((g) => `- \`${g.tool}\` — ${g.assertion}  (${g.nfr})`));
}

const outOfScope = section('Out of scope');
if (outOfScope) lines.push('', '## Out of scope', '', outOfScope);

lines.push('', '---', '',
  'If a decision is needed that this brief does not answer, the spec is incomplete: ' +
  'stop and amend the spec rather than deciding in the code. An amendment after ' +
  `approval sends ${specId(spec.id)} back through the approval gate, which is the ` +
  'cheap outcome, not the expensive one.');

const markdown = lines.join('\n') + '\n';
const out = flag('out');
if (out) { writeFileSync(join(root, out), markdown); console.log(`brief written  ${out}  (${branch})`); }
else console.log(markdown);
