#!/usr/bin/env node
// Why this spec cannot advance, and the ONE thing to do about it.
//
//   node spec-why.mjs specs/0001-foo.md
//   node spec-why.mjs specs/0001-foo.md --to Verified --json
//
// `spec-gate.mjs` lists every gate with its verdict, which is the right output for deciding a
// transition and the wrong one for an agent mid-task. Nine verdicts and four MANUALs is a page to
// re-read and reason about on every turn, and reasoning is where a model drifts. This answers the
// question that actually gets asked — what do I do next — in a sentence.
//
// It decides nothing and runs no gate of its own: it reads `spec-gate.mjs --json` and
// `spec-evidence.mjs --json`, and picks. Two sources of truth about a transition would be one
// too many, and this is not one of them.
//
// Exit 0 always. "Nothing is blocking it" is an answer, not a success code.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : (argv[i + 1] ?? null); };
const has = (n) => argv.includes(`--${n}`);
const JSON_OUT = has('json');
const ROOT = resolve(flag('root') ?? process.cwd());
const positional = argv.filter((a, i) => !a.startsWith('--') && !['to', 'root'].includes(argv[i - 1]?.replace(/^--/, '')));

const say = (why, next, extra = {}) => {
  if (JSON_OUT) console.log(JSON.stringify({ why, next, ...extra }, null, 2));
  else {
    console.log(`  ${why}`);
    if (next) console.log(`  → ${next}`);
  }
  process.exit(0);
};

const specArg = positional[0];
if (!specArg) {
  console.error('usage: spec-why.mjs <spec-file> [--to <Status>] [--root <path>] [--json]');
  process.exit(2);
}
const abs = resolve(ROOT, specArg);
if (!existsSync(abs)) {
  console.error(`could not run: no spec at ${specArg}`);
  process.exit(2);
}
const specRel = relative(ROOT, abs).split('\\').join('/');

const ask = (script, args) => {
  try {
    return JSON.parse(execFileSync(process.execPath, [join(HERE, script), ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch (e) {
    // These scripts exit non-zero when they have a verdict to report, which is a result and not
    // a crash — their stdout is still the answer.
    try { return JSON.parse(e.stdout || ''); } catch { return null; }
  }
};

/**
 * What to do about each gate, in the words of the thing that fixes it.
 *
 * A remedy per gate rather than one line for all of them: "re-run the gate" is useless advice
 * for a missing test file and actively wrong for a blocking §8 question. The gate already knows
 * WHAT is wrong; this is the only place that knows what to do about it.
 */
const REMEDY = {
  lifecycle: () => 'fix the Status cell, or name a reachable target with --to',
  placeholders: () => 'fill the template blanks the gate listed, then re-run it',
  'section-8': () => 'answer the §8 question, or record that it is not blocking',
  'human-approval': () => 'a human approves this in conversation — a script cannot witness it',
  criteria: () => 'finish the work, then tick the criteria it satisfies',
  'tests-exist': () => 'write the test §6 names, or correct the name to the file that exists',
  'suite-green': (spec) => `run the §6.1 suite — or \`spec-advance.mjs ${spec} --run-suite\` to have the gate run it`,
  'adversarial-review': (spec) => `/ml-specs:spec-verify ${spec}`,
  'branch-merged': () => 'merge the branch into the default branch, then fetch',
  'archive-move': (spec) => `git mv ${spec} specs/archive/`,
};

const gate = ask('spec-gate.mjs', [abs, '--root', ROOT, '--json', ...(flag('to') ? ['--to', flag('to')] : [])]);
if (!gate) say('the gate did not report, so nothing here is established', 'run spec-gate.mjs directly and read the error');

const to = gate.target;
const fails = (gate.gates ?? []).filter((g) => g.verdict === 'FAIL');
const manuals = (gate.gates ?? []).filter((g) => g.verdict === 'MANUAL');

// A failing gate first: it is the thing that refuses, and a judgement made against a spec that
// cannot pass its mechanical half is a judgement made twice.
if (fails.length) {
  const g = fails[0];
  const more = fails.length > 1 ? ` (+${fails.length - 1} more)` : '';
  say(`${specRel} cannot reach ${to}: ${g.detail}${more}`, REMEDY[g.name]?.(specRel) ?? 'read spec-gate.mjs for the detail', { gate: g.name, blocking: fails.length });
}

// Then evidence: a spec whose CURRENT status no longer stands should not be advanced past it.
const ev = ask('spec-evidence.mjs', ['--root', ROOT, '--json']);
const failing = (ev?.records ?? []).find((r) => r.spec === specRel && r.failing);
if (failing) {
  const fix = failing.verdict === 'amended'
    ? `decide whether that was intended, then \`spec-amend.mjs ${specRel} --because "…"\` or re-run the gate`
    : failing.verdict === 'unsound'
      ? 're-run the gate — records are not to be edited'
      : `re-run the gate for ${failing.to}`;
  say(`${specRel} claims ${failing.to}, and that record no longer stands: ${failing.reason}`, fix, { verdict: failing.verdict });
}

if (manuals.length) {
  const g = manuals[0];
  const more = manuals.length > 1 ? ` (+${manuals.length - 1} more)` : '';
  say(`${specRel} is mechanically clear for ${to}; ${manuals.length} judgement(s) remain${more ? ':' : ''} ${g.detail.split('—')[0].trim()}${more}`,
    REMEDY[g.name]?.(specRel) ?? 'make the judgement, then advance with --attest', { gate: g.name, human: manuals.length });
}

say(`${specRel} has nothing outstanding for ${to}`, `spec-advance.mjs ${specRel} --to ${to} --attest "…"`, { clear: true });
