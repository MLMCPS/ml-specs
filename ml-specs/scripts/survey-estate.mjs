#!/usr/bin/env node
// Survey candidate repos before onboarding the toolkit into them.
// Pure Node, no dependencies, read-only, no network calls.
//
//   node survey-estate.mjs ../                    # survey every git repo under a parent dir
//   node survey-estate.mjs ../svc-a ../svc-b      # or name them explicitly
//   node survey-estate.mjs ../ --json             # machine-readable
//
// Why this exists: /repo-init is the most expensive single operation in the toolkit — a full
// codebase scan. Running it blindly across an estate burns a lot of tokens and produces a pile
// of unreviewed knowledge layers. This does the CHEAP, MECHANICAL part first — what's there,
// what state it's in, how much cross-service surface it has — so the expensive part is aimed
// rather than sprayed. It reads files; it never writes.
//
// Every judgment here is a heuristic and is labelled as one. It tells you where to look, not
// what to conclude.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const targets = args.filter((a) => !a.startsWith('--'));
if (targets.length === 0) {
  console.error('usage: survey-estate.mjs <parent-dir | repo...> [--json]');
  process.exit(1);
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'target', 'build', 'dist', 'vendor', '.next', '.venv', 'venv',
  '__pycache__', '.gradle', '.idea', 'coverage', 'out', 'bin', 'obj', '.terraform',
]);
const SOURCE_EXT = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'java', 'kt', 'py', 'go', 'rb', 'cs', 'php', 'scala',
]);
const MAX_FILES = 4000;      // bounded: a survey must stay cheap even on a monorepo
const MAX_BYTES = 200_000;

// Manifest → stack. First match wins.
const MANIFESTS = [
  ['pom.xml', 'Java/Maven'],
  ['build.gradle', 'Java/Gradle'],
  ['build.gradle.kts', 'Kotlin/Gradle'],
  ['package.json', 'Node/JS'],
  ['pyproject.toml', 'Python'],
  ['requirements.txt', 'Python'],
  ['go.mod', 'Go'],
  ['Gemfile', 'Ruby'],
  ['composer.json', 'PHP'],
  ['Cargo.toml', 'Rust'],
  ['pubspec.yaml', 'Dart/Flutter'],
];

// Cross-service surface. These are the edges /repo-estate and /repo-impact need — a repo with
// many of them is worth onboarding early, because it unlocks answers for its peers too.
const EDGE_PATTERNS = {
  events: /@SqsListener|@KafkaListener|@RabbitListener|SqsClient|SnsClient|KafkaProducer|kafkajs|amqplib|@nestjs\/microservices|PubSub\(/,
  httpClients: /@FeignClient|axios\.create|new HttpClient|RestTemplate|WebClient\.builder|got\.extend|httpx\.Client/,
  contracts: /openapi|swagger|\.proto\b|graphql/i,
};

const git = (cwd, ...a) => {
  try {
    return execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

function walk(root) {
  const files = [];
  const stack = [root];
  while (stack.length && files.length < MAX_FILES) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.github') continue;
      if (SKIP_DIRS.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else files.push(full);
      if (files.length >= MAX_FILES) break;
    }
  }
  return files;
}

function surveyRepo(path) {
  const name = basename(path);
  const isRepo = git(path, 'rev-parse', '--is-inside-work-tree') === 'true';

  const stack = MANIFESTS.find(([f]) => existsSync(join(path, f)));
  const has = (p) => existsSync(join(path, p));

  // Knowledge-layer state decides init vs adopt vs nothing-to-do.
  const claude = has('CLAUDE.md');
  const patterns = has('docs/PATTERNS.md');
  const architecture = has('docs/ARCHITECTURE.md') || has('docs/architecture');
  const specs = has('specs');
  const specCount = specs
    ? readdirSync(join(path, 'specs')).filter((f) => /^\d{4}[a-z]?-.*\.md$/.test(f)).length
    : 0;
  // Other tools' agent instructions — these are the repos where /repo-init would clobber.
  const otherAgentDocs = ['AGENTS.md', '.cursorrules', '.github/copilot-instructions.md']
    .filter(has);

  let layer;
  if (claude && patterns && architecture) layer = 'full';
  else if (claude || patterns || architecture) layer = 'partial';
  else if (otherAgentDocs.length) layer = 'other-tool';
  else layer = 'none';

  // Activity — a dormant repo is rarely worth the scan.
  const lastCommit = isRepo ? git(path, 'log', '-1', '--format=%ad', '--date=short') : '';
  const recent = isRepo
    ? Number(git(path, 'rev-list', '--count', '--since=90.days', 'HEAD') || 0)
    : 0;
  const dirty = isRepo ? git(path, 'status', '--porcelain').split('\n').filter(Boolean).length : 0;

  // Edge signals.
  const edges = { events: 0, httpClients: 0, contracts: 0 };
  let scanned = 0;
  for (const f of walk(path)) {
    const ext = f.split('.').pop().toLowerCase();
    const isContractFile = /\.(proto|graphql)$/i.test(f) || /openapi|swagger/i.test(basename(f));
    if (!SOURCE_EXT.has(ext) && !isContractFile) continue;
    let text;
    try {
      if (statSync(f).size > MAX_BYTES) continue;
      text = readFileSync(f, 'utf8');
    } catch { continue; }
    scanned++;
    for (const [k, re] of Object.entries(EDGE_PATTERNS)) if (re.test(text)) edges[k]++;
  }

  // Recommendation. Deliberately conservative: anything ambiguous goes to a human.
  let action, why;
  if (!isRepo) { action = 'skip'; why = 'not a git repo'; }
  else if (!stack) { action = 'review'; why = 'no recognised manifest — may not be a service'; }
  else if (layer === 'full') { action = 'refresh'; why = 'already onboarded; /repo-refresh keeps it current'; }
  else if (layer === 'partial' || layer === 'other-tool') { action = 'adopt'; why = `existing docs (${[...(claude ? ['CLAUDE.md'] : []), ...(patterns ? ['PATTERNS'] : []), ...otherAgentDocs].join(', ')}) — /repo-init would clobber them`; }
  else if (recent === 0) { action = 'review'; why = `no commits in 90 days (last: ${lastCommit || 'unknown'}) — dormant?`; }
  else { action = 'init'; why = 'no knowledge layer, active repo'; }

  return {
    name, path, isRepo,
    stack: stack ? stack[1] : null,
    layer, claude, patterns, architecture, specs: specCount, otherAgentDocs,
    lastCommit, commits90d: recent, dirty,
    edges, edgeTotal: edges.events + edges.httpClients + edges.contracts,
    filesScanned: scanned, truncated: scanned >= MAX_FILES,
    action, why,
  };
}

// --- resolve targets --------------------------------------------------------

// Expand each target independently: a git repo is itself; any other directory is treated as a
// parent and scanned one level for repos. Doing this per-target rather than only when exactly
// one was given means `survey ~/work ~/other` works, and — the case that actually bit — a
// parent directory still expands when the shell appended stray words to the command.
const repos = [];
const missing = [];
for (const t of targets) {
  const p = resolve(t);
  if (!existsSync(p)) { missing.push(t); continue; }
  if (existsSync(join(p, '.git'))) { repos.push(p); continue; }
  let children;
  try { children = readdirSync(p, { withFileTypes: true }); } catch { missing.push(t); continue; }
  const found = children
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && existsSync(join(p, e.name, '.git')))
    .map((e) => join(p, e.name));
  if (found.length) repos.push(...found);
  else missing.push(t);
}

if (missing.length) {
  // zsh does not treat `#` as a comment interactively, so a pasted trailing comment arrives as
  // arguments. Say so plainly instead of reporting six English words as "not a git repo".
  console.error(`Not a repo and no repos inside: ${missing.join(', ')}`);
  console.error('If you pasted a trailing `# comment`, zsh passed those words as arguments — drop it.\n');
}

if (repos.length === 0) {
  console.error('No git repos found. Point at a parent directory, or name the repos.');
  process.exit(1);
}

const results = repos.map(surveyRepo);

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

// --- report -----------------------------------------------------------------

const ORDER = { init: 0, adopt: 1, review: 2, refresh: 3, skip: 4 };
results.sort((a, b) => (ORDER[a.action] - ORDER[b.action]) || (b.edgeTotal - a.edgeTotal));

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
console.log(`Surveyed ${results.length} repo(s). Read-only — nothing was modified.\n`);
console.log(`${pad('REPO', 26)} ${pad('ACTION', 8)} ${pad('STACK', 14)} ${pad('LAYER', 10)} ${pad('SPECS', 6)} ${pad('90d', 5)} ${pad('EDGES', 6)}`);
console.log('─'.repeat(84));
for (const r of results) {
  console.log(
    `${pad(r.name, 26)} ${pad(r.action, 8)} ${pad(r.stack ?? '—', 14)} ${pad(r.layer, 10)} ` +
    `${pad(r.specs || '—', 6)} ${pad(r.commits90d, 5)} ${pad(r.edgeTotal || '—', 6)}`,
  );
}

console.log('\nWhy, and what needs a human:');
for (const r of results) {
  console.log(`  ${r.name}: ${r.why}`);
  if (r.dirty) console.log(`      ⚠ ${r.dirty} uncommitted change(s) — onboard on a clean tree so the diff is reviewable`);
  if (r.truncated) console.log(`      note: file scan hit the ${MAX_FILES}-file cap; edge counts are a floor, not a total`);
}

const init = results.filter((r) => r.action === 'init');
const adopt = results.filter((r) => r.action === 'adopt');
console.log(`\nSuggested first wave (most cross-service surface — onboarding these unlocks /repo-impact for their peers):`);
for (const r of [...init, ...adopt].sort((a, b) => b.edgeTotal - a.edgeTotal).slice(0, 3)) {
  console.log(`  ${r.name}  (${r.edgeTotal} edge signals: ${r.edges.events} event, ${r.edges.httpClients} http-client, ${r.edges.contracts} contract)`);
}
console.log(`\n${init.length} to /repo-init, ${adopt.length} to /repo-adopt, ` +
  `${results.filter((r) => r.action === 'review').length} needing a decision, ` +
  `${results.filter((r) => r.action === 'refresh').length} already onboarded.`);
console.log('Edge counts are FILE counts matching known patterns — a signal of where the contracts are, not a contract inventory.');
