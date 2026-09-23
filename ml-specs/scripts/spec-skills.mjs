#!/usr/bin/env node
// The skill catalogue. Spec 0059.
//
// A capability is a role, an agent implements it, a skill is the procedure it runs. This lists
// what procedures exist, what each declares, and which capabilities nothing implements yet.
//
// No network calls. Reads `ml-specs/skills/` and writes only under `--new`.
//
// Exit codes follow `docs/PATTERNS.md:95-102`: 0 fine, 1 a finding (a skill breaks the contract,
// or `--new` was refused), 2 could not run.

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSkills, checkSkill, uncovered, CAPABILITIES, REQUIRED_FIELDS } from './lib/skills.mjs';

const OK = 0;
const FINDING = 1;
const CANNOT_RUN = 2;

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : (argv[i + 1] ?? d); };
const has = (n) => argv.includes(`--${n}`);
const SKILLS = flag('root', join(HERE, '..', 'skills'));

const die = (code, msg) => { console.error(`spec-skills: ${msg}`); process.exit(code); };

// ── --new ────────────────────────────────────────────────────────────────────────────────────

if (has('new')) {
  const name = flag('new');
  if (!name || name.startsWith('--')) die(CANNOT_RUN, 'usage: --new <name> --standard "<body of practice>" --capability <role>');
  if (!/^[a-z][a-z0-9-]*$/.test(name)) die(CANNOT_RUN, `'${name}' is not a usable skill name — lowercase, hyphens`);

  const standard = flag('standard');
  const capability = flag('capability');

  // THE REFUSAL THAT KEEPS THIS A SET OF PROCEDURES. A skill citing nothing is one person's advice
  // with a filename on it, and the whole value of the layer is that each one applies a named body
  // of practice. Refusing here rather than warning later is deliberate: a scaffold that writes a
  // hole and trusts somebody to fill it is a hole that ships.
  if (!standard || standard.trim().length < 8) {
    die(FINDING, `--standard is required and must name a body of practice — "TDD (Beck) + xUnit `
      + `Test Patterns", not "best practices". If the honest answer is "none in particular", the `
      + `procedure belongs in prose inside an agent instead.`);
  }
  if (!capability || !CAPABILITIES.includes(capability)) {
    die(FINDING, `--capability must be one of: ${CAPABILITIES.join(', ')}`);
  }

  const dir = join(SKILLS, name);
  const path = join(dir, 'SKILL.md');
  if (existsSync(path)) die(FINDING, `${path} already exists — nothing written`);

  mkdirSync(dir, { recursive: true });
  writeFileSync(path, `---
name: ${name}
description: <one sentence: what this procedure does, and when to reach for it>
capability: ${capability}
inputs: <what a caller hands over>
outputs: <what comes back, concretely>
standard: ${standard}
---

# ${name.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())}

<What this is for, before how it works.>

## When to use

<And when not to — the boundary with the neighbouring skill, stated in both files.>

## The procedure

1. <step>

## What this does not cover

<Say it, rather than leaving a reader to assume.>
`);
  console.log(`spec-skills: wrote ${path}`);
  console.log('  fill every <placeholder> — the contract fields are checked, the body is reviewed.');
  process.exit(OK);
}

// ── the catalogue ────────────────────────────────────────────────────────────────────────────

const skills = readSkills(SKILLS);
const findings = skills.flatMap((s) => checkSkill(s).map((f) => ({ ...f, skill: s.name })));
const gaps = uncovered(skills);

if (has('json')) {
  console.log(JSON.stringify({
    skills: skills.map((s) => ({ name: s.name, ...Object.fromEntries(REQUIRED_FIELDS.map((f) => [f, s.meta[f] ?? null])) })),
    capabilities: CAPABILITIES,
    uncovered: gaps,
    findings,
  }, null, 2));
  process.exit(findings.some((f) => f.level === 'error') ? FINDING : OK);
}

// A positional is an argument that is neither a flag NOR a flag's value. Without the second half,
// `--root /tmp/x` makes `/tmp/x` look like a skill name and the catalogue reports "no skill named
// /tmp/x" — which is exactly what the wiring test caught. `lib/cli.mjs:9` already draws this
// distinction; this file parses its own argv and had not.
const one = argv.find((a, i) => !a.startsWith('--') && !String(argv[i - 1] ?? '').startsWith('--'));
if (one) {
  const s = skills.find((x) => x.name === one);
  if (!s) die(CANNOT_RUN, `no skill named '${one}' — known: ${skills.map((x) => x.name).join(', ') || '(none)'}`);
  console.log(`  ${s.name}`);
  for (const f of REQUIRED_FIELDS.filter((f) => f !== 'name')) {
    console.log(`    ${f.padEnd(12)} ${s.meta[f] ?? '—'}`);
  }
  process.exit(OK);
}

if (!skills.length) {
  console.log('no skills yet.');
} else {
  for (const s of skills) {
    const bad = findings.filter((f) => f.skill === s.name);
    const mark = bad.some((f) => f.level === 'error') ? '✗' : bad.length ? '·' : '✓';
    console.log(`  ${mark} ${s.name.padEnd(24)} ${(s.meta.capability ?? '—').padEnd(15)} ${s.meta.standard ?? '—'}`);
  }
}

if (gaps.length) {
  console.log('');
  // A gap, not a failure: the set grows as procedures are written down. Saying so keeps this from
  // reading as nine things being broken.
  console.log(`  ${gaps.length} capability(ies) no skill implements yet — ${gaps.join(', ')}`);
}

for (const f of findings) {
  console.log(`  ${f.level === 'error' ? 'error' : 'warn '}  ${f.skill}: ${f.rule}: ${f.message}`);
}

process.exit(findings.some((f) => f.level === 'error') ? FINDING : OK);
