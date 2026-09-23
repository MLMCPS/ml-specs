#!/usr/bin/env node
// What shipped, from the specs that shipped it. Spec 0036.
//
// `ml-specs/CHANGELOG.md` is written by hand from memory, while every merged spec already says
// what it changed and why in its Revisions table. `scripts/changelog-section.mjs` prints one
// version's section and checks it; nothing assembles one.
//
// SCOPED TO `[Unreleased]`, AND ONLY WITH `--write`. The `release` skill owns versions and
// `CLAUDE.md` says never bump one by hand. This assembles the section and stops. Released sections
// are left byte-identical, which is asserted by comparison rather than promised in a comment.
//
// A spec with no Revisions table contributes its title alone — `specs/TEMPLATE.md:31-33` says to
// skip that section when a spec was approved first pass, so treating its absence as a defect would
// punish the specs that went smoothest.
//
// Exit codes: 0 assembled, 1 nothing to assemble or the splice had nowhere to go, 2 could not run.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shipped, spliceUnreleased } from './lib/board.mjs';

const OK = 0;
const FINDING = 1;
const CANNOT_RUN = 2;

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : (argv[i + 1] ?? d); };
const has = (n) => argv.includes(`--${n}`);
const root = flag('root', process.cwd());
const CHANGELOG = flag('changelog', join(HERE, '..', 'CHANGELOG.md'));

const specs = shipped(root);
if (!specs.length) {
  console.log('spec-changelog: no Verified or Archived specs — nothing has shipped to describe.');
  process.exit(FINDING);
}

const body = specs.map((s) => {
  // The newest revision is the one that describes what the spec ended up being. Earlier rows are
  // the argument that got it there, which belongs in the spec and not in a changelog.
  const latest = s.revisions.sort((a, b) => b.n - a.n)[0];
  const what = latest ? latest.what : s.title;
  return `- **${s.title}** (spec ${s.number})${latest ? `\n  ${latest.why}` : ''}\n  ${what}`;
}).join('\n');

if (!has('write')) {
  console.log(body);
  console.log('');
  console.log(`spec-changelog: ${specs.length} shipped spec(s). Nothing written — pass --write to splice`);
  console.log(`  this into ${CHANGELOG}'s [Unreleased] section. Released sections are never touched.`);
  process.exit(OK);
}

if (!existsSync(CHANGELOG)) die(CANNOT_RUN, `${CHANGELOG} does not exist`);
const before = readFileSync(CHANGELOG, 'utf8');
const { text, error } = spliceUnreleased(before, body);
if (error) {
  console.error(`spec-changelog: ${error}`);
  process.exit(FINDING);
}

writeFileSync(CHANGELOG, text);
console.log(`spec-changelog: spliced ${specs.length} spec(s) into ${CHANGELOG}'s [Unreleased] section.`);
console.log('  Read it before committing — this assembles, it does not write prose.');
process.exit(OK);

function die(code, msg) { console.error(`spec-changelog: ${msg}`); process.exit(code); }
