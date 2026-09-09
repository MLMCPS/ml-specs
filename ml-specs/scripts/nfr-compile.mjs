#!/usr/bin/env node
// Compile non-functional requirements into the two things that enforce them:
// standing constraints in docs/CONSTRAINTS.md, and blocking pipeline gates.
// Pure Node, no dependencies. No network calls — nothing leaves this machine.
//
//   node nfr-compile.mjs --root /path/to/repo             # dry run: prints, writes nothing
//   node nfr-compile.mjs --root /path/to/repo --apply     # writes docs/CONSTRAINTS.md
//   node nfr-compile.mjs --root /path/to/repo --gates ci/nfr-gates.yml
//   node nfr-compile.mjs --json
//
// Exit code 1 if an NFR cannot be compiled, or if one has been flattened into an
// acceptance criterion.
//
// Reads docs/NFRS.md (a markdown table, so it reviews in a pull request like
// anything else), falling back to nfrs.json.
//
// Why this exists: NFRs are the requirements most likely to be agreed and then
// lost. They do not decompose into user stories — a story breakdown flattens
// them into prose nothing checks. They decompose into a constraint the author
// reads and a gate the build fails on, and this produces both or refuses.

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { listSpecs } from './lib/specs.mjs';
import { compile, findFlattened, toPipelineYaml, parseNfrMarkdown } from './lib/nfr.mjs';
import * as knowledge from './lib/knowledge.mjs';

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : (argv[i + 1] ?? d); };
const has = (n) => argv.includes(`--${n}`);

const root = flag('root', process.cwd());
const json = has('json');
const apply = has('apply');
const gatesOut = flag('gates');

const C = process.stdout.isTTY && !json
  ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`,
      green: (s) => `\x1b[32m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` }
  : { dim: (s) => s, red: (s) => s, green: (s) => s, bold: (s) => s };

// --- read -------------------------------------------------------------------
const md = join(root, 'docs', 'NFRS.md');
const jsonFile = join(root, 'nfrs.json');
let nfrs = [];
let source = null;
if (existsSync(md)) { nfrs = parseNfrMarkdown(readFileSync(md, 'utf8')); source = 'docs/NFRS.md'; }
else if (existsSync(jsonFile)) { nfrs = JSON.parse(readFileSync(jsonFile, 'utf8')); source = 'nfrs.json'; }

if (!source) {
  console.error(`no docs/NFRS.md or nfrs.json under ${root}`);
  process.exit(1);
}

// --- compile ----------------------------------------------------------------
const compiled = [];
const refused = [];
for (const nfr of nfrs) {
  try { compiled.push({ nfr, ...compile(nfr) }); }
  catch (e) { refused.push({ id: nfr.id ?? '(unnamed)', why: e.message }); }
}

const specs = listSpecs(root);
const flattened = findFlattened(specs);

// An NFR named by a spec but absent from the source is worse than an unrouted
// one: the spec claims a constraint that does not exist anywhere.
const known = new Set(nfrs.map((n) => n.id));
const dangling = [];
for (const s of specs) {
  for (const id of s.nfrs ?? []) if (!known.has(id)) dangling.push({ spec: s.id, nfr: id });
}

const constraintsPath = join(root, 'docs', 'CONSTRAINTS.md');
let changed = [];
if (apply && refused.length === 0) {
  changed = knowledge.write(constraintsPath, compiled.map((c) => c.constraint));
}
if (gatesOut && refused.length === 0) {
  const out = join(root, gatesOut);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, toPipelineYaml(compiled.map((c) => c.gate)) + '\n');
}

const ok = refused.length === 0 && flattened.length === 0 && dangling.length === 0;

if (json) {
  console.log(JSON.stringify({ root, source, ok,
    compiled: compiled.map((c) => ({ id: c.nfr.id, constraint: c.constraint, gate: c.gate })),
    refused, flattened, dangling, changed, applied: apply }, null, 2));
} else {
  console.log(`${C.bold('source')} ${C.dim(source)}\n`);
  for (const { nfr, constraint, gate } of compiled) {
    console.log(`  ${C.green(nfr.id)} ${C.dim(nfr.kind.padEnd(12))} ${constraint.text}`);
    console.log(`         ${C.dim(`gate: ${gate.tool} — ${gate.assertion}  scope: ${constraint.scope.join(', ')}`)}`);
  }
  for (const r of refused) console.log(`  ${C.red(r.id)} ${C.red('refused')} ${C.dim(r.why)}`);

  if (flattened.length) {
    console.log(`\n  ${C.red('flattened into a story — an NFR here stops being enforced:')}`);
    for (const f of flattened) console.log(`    ${C.dim(`${f.spec} ${f.criterion} mentions ${f.nfr}`)}`);
  }
  if (dangling.length) {
    console.log(`\n  ${C.red('named by a spec but defined nowhere:')}`);
    for (const d of dangling) console.log(`    ${C.dim(`spec ${d.spec} -> ${d.nfr}`)}`);
  }

  console.log();
  if (apply && refused.length === 0) {
    console.log(changed.length
      ? `  ${C.green('knowledge layer updated')} ${C.dim(`${changed.join(', ')} -> docs/CONSTRAINTS.md`)}`
      : `  ${C.dim('knowledge layer already current')}`);
  } else if (!apply) {
    console.log(`  ${C.dim('dry run — pass --apply to write docs/CONSTRAINTS.md')}`);
  }
  if (gatesOut && refused.length === 0) console.log(`  ${C.green('pipeline gates written')} ${C.dim(gatesOut)}`);
  console.log(ok ? `  ${C.green('all NFRs routed')}` : `  ${C.red('not every NFR is enforced')}`);
}

process.exit(ok ? 0 : 1);
