#!/usr/bin/env node
// Scaffold the next spec. Spec 0036.
//
// A spec was created by copying `specs/TEMPLATE.md`, picking the next number by looking, and
// filling the header by hand. The number is the part that goes wrong: two people both take 0031,
// and `specs/README.md` says numbers are never reused.
//
// `nextSpecNumber` already existed — inside the MCP server, where a model could call it and a
// shell user could not. It now lives in `lib/board.mjs` and both consume one implementation.
//
// THE NUMBER CARRIES ITS CAVEAT. A number derived without fetching a remote can collide, and a
// caller handed "0042" with no warning has no way to know. The warning prints; `--force` is
// deliberately absent, because a flag whose purpose is getting past a caveat becomes the reflex
// (specs 0005 §7, 0010 §4).
//
// Exit codes: 0 written, 1 refused, 2 could not run.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextSpecNumber, usableSlug, RIGORS } from './lib/board.mjs';
import { lines } from './lib/text.mjs';

const OK = 0;
const FINDING = 1;
const CANNOT_RUN = 2;

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : (argv[i + 1] ?? d); };
const has = (n) => argv.includes(`--${n}`);
const root = flag('root', process.cwd());
const slug = argv.find((a, i) => !a.startsWith('--') && !String(argv[i - 1] ?? '').startsWith('--'));

const die = (code, msg) => { console.error(`spec-new: ${msg}`); process.exit(code); };

const slugProblem = usableSlug(slug);
if (slugProblem) die(CANNOT_RUN, `${slugProblem}\n  usage: spec-new <slug> [--rigor light|standard|deep] [--title "…"]`);

const rigor = flag('rigor', 'standard');
if (!RIGORS.includes(rigor)) die(CANNOT_RUN, `--rigor must be one of: ${RIGORS.join(', ')}`);

// The template ships with the plugin, and an adopting repo may also have its own. Prefer theirs.
const TEMPLATES = [join(root, 'specs', 'TEMPLATE.md'), join(HERE, '..', 'templates', 'specs', 'TEMPLATE.md')];
const template = TEMPLATES.find((p) => existsSync(p));
if (!template) die(CANNOT_RUN, `no spec template found — looked in ${TEMPLATES.join(' and ')}`);

const num = nextSpecNumber(root, { fetch: !has('no-fetch') });
const file = join(root, 'specs', `${num.next}-${slug}.md`);
if (existsSync(file)) die(FINDING, `${file} already exists — nothing written`);

const title = flag('title', slug.replace(/-/g, ' '));
const today = new Date().toISOString().slice(0, 10);
const branch = flag('branch', '—');

// Fill what is DERIVABLE. Everything below the header stays as the template wrote it: the prompts
// in §1–§8 are the point of a template, and pre-filling them with plausible text is how a spec
// gets written by autocomplete rather than by thinking.
//
// Author and project come from git and the directory. Stack and Ticket do not — nothing here knows
// them, and a guess in a header field is worse than a placeholder, because a placeholder is
// visibly unfilled while a wrong guess reads as a decision. They are listed on the way out instead.
const author = (() => {
  try {
    return execFileSync('git', ['-C', root, 'config', 'user.name'], { encoding: 'utf8' }).trim() || null;
  } catch { return null; }
})();
const project = basename(root) || null;

const filled = lines(readFileSync(template, 'utf8')).map((l) => {
  if (/^# Spec:/.test(l)) return `# Spec: ${title}`;
  if (/^\|\s*\*\*Rigor\*\*/.test(l)) return `| **Rigor** | ${rigor} |`;
  if (/^\|\s*\*\*Status\*\*/.test(l)) return '| **Status** | Draft |';
  if (/^\|\s*\*\*Date\*\*/.test(l)) return `| **Date** | ${today} |`;
  if (/^\|\s*\*\*Branch\*\*/.test(l)) return `| **Branch** | ${branch} |`;
  if (author && /^\|\s*\*\*Author\*\*/.test(l)) return `| **Author** | ${author} |`;
  if (project && /^\|\s*\*\*Project \/ service\*\*/.test(l)) return `| **Project / service** | ${project} |`;
  return l;
}).join('\n');

/** Header fields still carrying a `<placeholder>` — named, so they are not discovered at the gate. */
const unfilled = lines(filled)
  .slice(0, lines(filled).findIndex((l) => /^## /.test(l)))
  .filter((l) => /^\|\s*\*\*/.test(l) && /<[^>]+>|XXX-0000/.test(l))
  .map((l) => (l.match(/\*\*(.+?)\*\*/) ?? [, '?'])[1]);

if (has('dry-run')) {
  console.log(`spec-new: would write ${file}`);
  if (num.warning) console.log(`  ${num.warning}`);
  process.exit(OK);
}

mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, filled);

console.log(`spec-new: wrote ${file}`);
if (unfilled.length) {
  // Said now rather than discovered at the gate: `spec-gate`'s placeholder check refuses
  // Draft → Approved over exactly these, and finding out then costs a round trip.
  console.log(`  still to fill: ${unfilled.join(', ')} — the gate refuses an unfilled header.`);
}
console.log(`  rigor ${rigor} — state the reason in §1 in one line. An unstated \`light\` is`);
console.log('  indistinguishable at review from a correct one.');
if (num.warning) console.log(`  ${num.warning}`);
console.log(`  next: /ml-specs:spec-review specs/${num.next}-${slug}.md`);
process.exit(OK);
