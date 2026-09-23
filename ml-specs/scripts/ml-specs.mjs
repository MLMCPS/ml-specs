#!/usr/bin/env node
// `ml-specs` — the bin. How a host with no plugin system reaches the gates.
//
// Every comparable toolkit publishes one, and that is not a coincidence: a skill file can tell an
// agent to run a command, and that is the only mechanism every host shares. Without a bin, this
// toolkit's gates are reachable through `${CLAUDE_PLUGIN_ROOT}` and nowhere else, which is a
// variable exactly one host defines.
//
// THIN ON PURPOSE. `gate`, `evidence` and `why` delegate to scripts that already exist and are
// already tested, so what this file freezes as a published contract is a VERB LIST, not behaviour.
// It spawns them as `node <path>` rather than executing them directly — `spec-evidence.mjs` and
// `spec-why.mjs` are committed `100644`, and relying on an exec bit they do not have would make
// two verbs fail on a fresh clone.
//
// EXIT CODES follow `docs/PATTERNS.md:95-102`, which is stricter than it first looks:
//   0  everything asked for happened
//   1  a finding — including a REFUSAL. A template naming an absent mechanism, a target we will
//      not clobber, a host served by the plugin. Each is an answer, not a failure to answer.
//   2  could not run — an unknown host, an unreadable template, a scope this host has no concept
//      of. `2` is not a general-purpose "hard block"; it means the question could not be put.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, lstatSync, realpathSync } from 'node:fs';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { HOSTS, hostIds, installableIds, resolveHost, installTarget, sharedTargets, needsVerificationWarning } from './lib/hosts.mjs';
import { buildCanonical, render, forbidden, SHIM_VERSION, VERBS, INVOCATION } from './lib/adapters.mjs';
import { readConfig, recordHosts } from './lib/config.mjs';

const OK = 0;
const FINDING = 1;
const CANNOT_RUN = 2;

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENTS = join(HERE, '..', 'agents');
const DEFAULT_TEMPLATE = join(HERE, '..', 'templates', 'ML-SPECS.template.md');
const CANONICAL = 'ML-SPECS.md';

const argv = process.argv.slice(2);
const verb = argv[0];
const rest = argv.slice(1);
const flag = (n, d = null) => { const i = rest.indexOf(`--${n}`); return i === -1 ? d : (rest[i + 1] ?? d); };
const has = (n) => rest.includes(`--${n}`);
const root = flag('root', process.cwd());
// A TEST SEAM, deliberately not a flag. The refusal path needs an injection point — without one,
// "install refuses a poisoned document and writes nothing" is a claim no test can make, which is
// exactly how it shipped unguarded the first time. But as `--template` it was also an
// undocumented arbitrary-file-read in a published bin: any path, read and written into
// `ML-SPECS.md`. An env var keeps the seam and takes it off the CLI surface.
const TEMPLATE = process.env.ML_SPECS_TEMPLATE || DEFAULT_TEMPLATE;

const die = (code, msg) => { console.error(`ml-specs: ${msg}`); process.exit(code); };

// One resolution of "home", read from the environment rather than baked in at load. This is the
// whole reason the suite can exercise `--scope user` without writing into a developer's actual
// home directory: the tests spawn this bin with HOME pointing at a mkdtemp.
const ENV = { HOME: process.env.HOME || homedir() };

/** Agent names, by prose, read from the directory — so the scan tracks a rename (ARCHITECTURE.md:43-44). */
const agentNames = () => (existsSync(AGENTS)
  ? readdirSync(AGENTS).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3))
  : []);

// ── delegation ──────────────────────────────────────────────────────────────────────────────

const DELEGATE = {
  gate: 'spec-gate.mjs',
  evidence: 'spec-evidence.mjs',
  why: 'spec-why.mjs',
  // Spec 0036. Delegated like the rest — the bin stays a verb list, not behaviour.
  new: 'spec-new.mjs',
  check: 'spec-check.mjs',
  changelog: 'spec-changelog.mjs',
};

if (Object.hasOwn(DELEGATE, verb)) {
  const r = spawnSync(process.execPath, [join(HERE, DELEGATE[verb]), ...rest], { stdio: 'inherit' });
  process.exit(r.status ?? CANNOT_RUN);
}

// ── shared helpers ──────────────────────────────────────────────────────────────────────────

const bannerVersion = (text) => {
  const m = text.match(/<!-- ml-specs install v(\d+) —/);
  return m ? Number(m[1]) : null;
};

/**
 * What is already at a target, and whether we may write it.
 * `foreign` covers both "somebody else's file" and "a NEWER shim contract" — fail toward leaving
 * it alone, because a file from a version this build does not understand is not ours to rewrite.
 */
function classify(path) {
  // A symlink is `foreign` whatever it points at. `classify` reads CONTENT, so a dangling symlink
  // looked `absent` and a symlink onto a real file looked like ours — either way the write
  // followed the link out of the tree the operator consented to.
  try { if (lstatSync(path).isSymbolicLink()) return 'foreign'; } catch { /* not there at all */ }
  if (!existsSync(path)) return 'absent';
  const v = bannerVersion(readFileSync(path, 'utf8'));
  if (v === null) return 'foreign';
  if (v > SHIM_VERSION) return 'foreign';
  return v === SHIM_VERSION ? 'ours-current' : 'ours-older';
}

const canonicalDir = (scope) => (scope === 'user'
  ? join(ENV.HOME, '.ml-specs')
  : join(root, '.ml-specs'));

/**
 * Is `path` still inside `base` once every symlink on the way has been resolved?
 *
 * `join()` produces a path under the root; it does not keep it there. A cloned repository can
 * commit `.cursor/rules` as a symlink to anywhere, and `mkdirSync(..., {recursive:true})` +
 * `writeFileSync` will follow it out without a word. So resolve the deepest ancestor that exists
 * and compare that, rather than trusting the string.
 */
function contained(path, base) {
  let real;
  try { real = realpathSync(base); } catch { return false; }
  let probe = path;
  for (;;) {
    if (existsSync(probe)) {
      let here;
      try { here = realpathSync(probe); } catch { return false; }
      const rel = relative(real, here);
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
    }
    const up = dirname(probe);
    if (up === probe) return false;
    probe = up;
  }
}

// ── hosts ───────────────────────────────────────────────────────────────────────────────────

function detect(host) {
  const dirs = host.detect.dirs.some((d) => existsSync(join(root, d)));
  let binary = false;
  if (host.detect.bin) {
    const path = process.env.PATH || '';
    const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
    binary = path.split(process.platform === 'win32' ? ';' : ':').some((d) => d && exts.some((e) => {
      try { return statSync(join(d, host.detect.bin + e)).isFile(); } catch { return false; }
    }));
  }
  return { binary, dirs };
}

function drift() {
  const project = join(canonicalDir('project'), CANONICAL);
  const user = join(ENV.HOME, '.ml-specs', CANONICAL);
  if (!existsSync(project) || !existsSync(user)) return null;
  return readFileSync(project, 'utf8') === readFileSync(user, 'utf8')
    ? null
    : { project, user };
}

if (verb === 'hosts') {
  const recorded = new Set(readConfig(root).hosts);
  const rows = hostIds().map((id) => {
    const host = resolveHost(id);
    const d = detect(host);
    return {
      id,
      name: host.name,
      vendor: host.vendor,
      format: host.format,
      target: host.project,
      detected: d.binary || d.dirs,
      signals: d,
      installed: recorded.has(id),
      servedBy: host.servedBy ?? null,
      mechanisms: host.mechanisms,
      verified: host.verified,
      verifiedBy: host.verifiedBy ?? null,
    };
  });
  const d = drift();

  if (has('json')) {
    console.log(JSON.stringify({ hosts: rows, drift: d }, null, 2));
    process.exit(OK);
  }

  for (const r of rows) {
    const mark = r.servedBy ? '▣' : r.installed ? '✓' : r.detected ? '·' : ' ';
    const note = r.servedBy
      ? `served by the ${r.servedBy}, not by a shim`
      : r.installed ? 'installed'
        : r.detected ? 'detected here' : '';
    console.log(`  ${mark} ${r.id.padEnd(14)} ${r.name.padEnd(30)} ${note}`);
    if (!r.verified && !r.servedBy) {
      console.log(`      ${'unverified'.padEnd(12)} path and format from vendor docs; not exercised`);
    }
  }
  if (d) {
    console.log('');
    console.log(`  drift: ${d.project} and ${d.user} differ — re-run install for the one you want to keep`);
  }
  process.exit(OK);
}

// ── install ─────────────────────────────────────────────────────────────────────────────────

if (verb === 'install') {
  const scope = flag('scope', 'project');
  if (scope !== 'project' && scope !== 'user') die(CANNOT_RUN, `--scope must be project or user, got '${scope}'`);

  const want = flag('host');
  if (!want) die(CANNOT_RUN, `install needs --host <id|all> — known: ${hostIds().join(', ')}`);

  let ids;
  if (want === 'all') {
    ids = installableIds();
  } else {
    let host;
    try { host = resolveHost(want); } catch (e) { die(CANNOT_RUN, e.message); }
    if (host.servedBy) {
      die(FINDING, `${host.id} is served by the ${host.servedBy}, not by a shim — `
        + 'add the ml-tools marketplace and you have the commands, agents and hooks already');
    }
    ids = [want];
  }

  const dryRun = has('dry-run');
  const names = agentNames();

  // 1. Build the canonical document and scan it BEFORE anything is written. It is the file every
  //    shim points at, so a violation here reaches every host.
  let canonical;
  try {
    canonical = buildCanonical(readFileSync(TEMPLATE, 'utf8'));
  } catch (e) {
    die(CANNOT_RUN, `could not read the canonical template at ${TEMPLATE}: ${e.message}`);
  }
  const bad = forbidden(canonical, names);
  if (bad.length) {
    console.error('ml-specs: refusing to install — the canonical document names a mechanism no host has:');
    for (const b of bad) console.error(`  ${CANONICAL}:${b.line}  ${b.rule}: ${JSON.stringify(b.found)}`);
    console.error('  nothing was written.');
    process.exit(FINDING);
  }

  // 2. Where the document lands, and how each shim should refer to it.
  const docDir = canonicalDir(scope);
  const docPath = join(docDir, CANONICAL);
  const pointer = scope === 'user' ? docPath : relative(root, docPath);

  // 3. Render every shim, scan them too, and only then touch the disk.
  // Keyed by PATH, carrying every host that wants it. Five hosts resolve to one `AGENTS.md`, and
  // an earlier pass deduped by skipping the later ones — which wrote the right file and then
  // reported 11 hosts where there are 15, and would have recorded only 11 in `.ml-specs.json`.
  // One file, all its owners named.
  const planned = new Map();
  const shared = sharedTargets(ids, root, scope, ENV);

  for (const id of ids) {
    const host = resolveHost(id);
    const target = installTarget(id, scope, root, ENV);
    if (!target) {
      die(CANNOT_RUN, `${id} has no user scope — install it with --scope project, or pick another host`);
    }
    let rendered;
    try {
      rendered = render({ pointer }, host);
    } catch (e) {
      // `EBADPOINTER` (a pointer with a newline or backtick — a HOME the shell allows) and
      // `ENOFORMAT`. The library refuses correctly; without this the refusal reached the operator
      // as a raw V8 stack at exit 1, which is the shape AC21 exists to eliminate and the wrong
      // code besides: an input the script cannot use is could-not-run.
      die(CANNOT_RUN, e.message);
    }
    for (const file of rendered) {
      const path = file.path === '' ? target : join(target, file.path);
      // Scanned BEFORE the dedupe below, not after. With the order reversed, every host after the
      // first on a shared target skipped the scan entirely — harmless while the five `AGENTS.md`
      // sharers all render byte-identically, and not harmless the moment one of them has a
      // different format or extension.
      const violations = forbidden(file.contents, names);
      if (violations.length) {
        console.error(`ml-specs: refusing to install — the ${id} shim names a mechanism it cannot use:`);
        for (const b of violations) console.error(`  ${path}:${b.line}  ${b.rule}: ${JSON.stringify(b.found)}`);
        console.error('  nothing was written.');
        process.exit(FINDING);
      }
      if (planned.has(path)) { planned.get(path).ids.push(id); continue; }
      // Containment is a property of the RESOLVED path, checked once here so a symlink cannot
      // carry a write out of the tree the operator named.
      const base = scope === 'user' ? ENV.HOME : root;
      const state = contained(path, base) ? classify(path) : 'escapes';
      planned.set(path, { ids: [id], path, contents: file.contents, state });
    }
  }

  // 4. Decide the canonical document BEFORE writing anything. It was decided after the shims, so
  //    a refused document left shims on disk pointing at a file that was never written — reported
  //    honestly, but a half-install all the same.
  const docBase = scope === 'user' ? ENV.HOME : root;
  const docState = contained(docPath, docBase) ? classify(docPath) : 'escapes';
  const docBlocked = docState === 'escapes' || docState === 'foreign';
  if (docBlocked && !dryRun) {
    console.error(docState === 'escapes'
      ? `ml-specs: refusing to install — ${docPath} would land outside ${scope === 'user' ? 'your home directory' : 'the repository'}`
      : `ml-specs: refusing to install — a file is already at ${docPath} and it is not ours to rewrite`);
    console.error('  nothing was written: every shim points at that document.');
    process.exit(FINDING);
  }

  // 5. Write, or say what would be written.
  const wrote = [];
  const refused = [];
  for (const p of planned.values()) {
    if (p.state === 'foreign' || p.state === 'escapes') { refused.push(p); continue; }
    if (!dryRun) {
      try {
        mkdirSync(dirname(p.path), { recursive: true });
        writeFileSync(p.path, p.contents);
      } catch (e) {
        // `contained()` walks to the deepest EXISTING ancestor, and a dangling link is not one —
        // so a `.cursor/rules` pointing at a path that does not exist reads as contained, and
        // `mkdirSync` then throws ENOENT. It fails closed (nothing is written outside), but it
        // used to fail closed behind a stack trace on exit 1.
        die(CANNOT_RUN, `could not write ${p.path}: ${e.message}`);
      }
    }
    wrote.push(p);
  }
  const installed = [...new Set(wrote.flatMap((p) => p.ids))];
  let recorded = null;

  if (!dryRun && wrote.length) {
    mkdirSync(docDir, { recursive: true });
    writeFileSync(docPath, canonical);
    if (scope === 'project') recorded = recordHosts(root, installed);
  }

  const verb2 = dryRun ? 'would write' : 'wrote';
  console.log(`ml-specs: ${verb2} ${wrote.length} file(s) for ${installed.length} host(s), ${scope} scope`);
  if (!dryRun && wrote.length) console.log(`  ${relative(root, docPath) || docPath} — the loop every shim points at`);

  for (const [target, group] of shared) {
    if (group.length > 1) console.log(`  ${target} — one file, shared by ${group.join(', ')}`);
  }
  for (const id of installed) {
    const host = HOSTS[id];
    if (needsVerificationWarning(host)) {
      console.log(`  ${id}: unverified — the path and format come from ${host.vendor}'s documentation `
        + 'and have not been exercised here');
    }
  }
  for (const p of wrote) {
    if (p.state === 'ours-older') console.log(`  ${p.ids.join(', ')}: upgraded from an older shim contract`);
  }
  for (const p of refused) {
    console.log(p.state === 'escapes'
      ? `  ${p.path} — refused: it resolves outside ${scope === 'user' ? 'your home directory' : 'the repository'} (a symlink on the way)`
      : `  ${p.path} — left alone: it is not ours to rewrite (no ml-specs banner, or a newer one)`);
  }
  if (recorded?.refused) console.log(`  ${recorded.refused}`);
  if (want === 'all') console.log('  claude-code: served by the plugin, not by a shim');

  process.exit(refused.length || recorded?.refused ? FINDING : OK);
}

// ── usage ───────────────────────────────────────────────────────────────────────────────────

console.error(`usage: ml-specs <verb>

  gate <spec> [--to <Status>]   may this spec advance?  0 ok · 1 a finding · 2 could not run
  evidence [--json]             do the gates that already passed still describe this tree?
  why <spec>                    why can this one not advance?
  new <slug> [--rigor R]        scaffold the next spec, number taken across every branch
  check [--to <Status>]         gate the whole board — mechanical gates only, one exit code
  changelog [--write]           what shipped, from the specs that shipped it
  hosts [--json]                which agent hosts are set up here
  install --host <id|all> [--scope project|user] [--dry-run]

  verbs: ${VERBS.join(', ')}
  more:  ${INVOCATION} hosts`);
process.exit(CANNOT_RUN);
