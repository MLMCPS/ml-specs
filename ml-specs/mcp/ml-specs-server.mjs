#!/usr/bin/env node
// ml-specs MCP server — the DETERMINISTIC half of the toolkit, exposed to any MCP client.
//
//   node ml-specs-server.mjs [--root <repo path>]     (stdio transport; --root defaults to cwd)
//
// Why this exists alongside the plugin: the parts that are pure computation over a repo's files
// are useful to *any* agent in any tool, and shouldn't need a model to run. Those are the tools.
// The commands are exposed too, as MCP prompts (see below), with the agents they delegate to
// inlined into them. Skills and hooks have no MCP equivalent at all — those stay Claude Code,
// and so does the real subagent execution the plugin gets.
//
// Everything is READ-ONLY. No tool writes, moves, or deletes anything. Writing is the plugin's
// job, where a human is in the loop to approve it.
//
// No dependencies, by the same convention as scripts/validate-plugin.mjs — the MCP SDK would
// mean a package.json and node_modules in a repo that deliberately has neither. stdio MCP is
// newline-delimited JSON-RPC 2.0, which is short enough to implement honestly.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { runChecks } from '../templates/ci/knowledge-check.mjs';
import { listSpecs as parseSpecs, analyze } from '../scripts/lib/specs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROTOCOL_VERSION = '2024-11-05';

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
// Absolute, always. ROOT is both the spawn cwd and the --root passed to the scripts; a relative
// value composes with itself and every script ends up looking inside <root>/<root>.
const ROOT = resolve(rootFlag !== -1 ? (argv[rootFlag + 1] ?? '.') : process.cwd());

// Version skew is the predictable failure of distributing this: one teammate on a stale npx
// cache, another on a fresh plugin update, both reporting different answers. Make "what am I
// actually running?" a one-liner rather than an archaeology exercise.
const VERSION = '1.2.0';
if (argv.includes('--version') || argv.includes('-v')) {
  console.log(`ml-specs-mcp ${VERSION}  (${fileURLToPath(import.meta.url)})`);
  process.exit(0);
}

const abs = (p) => join(ROOT, p);
const git = (...a) => {
  try {
    return execFileSync('git', ['-C', ROOT, ...a], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
};

// --- docs/ESTATE.md parsing -------------------------------------------------
// The estate index is markdown tables under `### Synchronous` / `### Asynchronous` /
// `### Shared data` headings. Column meaning depends on which table a row is in.

const SECTION_SHAPES = {
  sync: ['caller', 'callee', 'via', 'what', 'evidence'],
  async: ['contract', 'producer', 'consumer', 'notes', 'evidence'],
  shared: ['contract', 'owner', 'usedBy', 'notes'],
};

function parseEstate() {
  if (!existsSync(abs('docs/ESTATE.md'))) return { present: false, edges: [], services: [] };

  const lines = readFileSync(abs('docs/ESTATE.md'), 'utf8').split('\n');
  const edges = [];
  const services = [];
  let section = null;

  const cells = (line) =>
    line.split('|').slice(1, -1).map((c) => c.trim().replace(/^`|`$/g, ''));
  const isSeparator = (line) => /^\|[\s:|-]+\|$/.test(line.trim());
  // A row is unresolved if it's a placeholder or was never confirmed against the peer's code.
  const unresolved = (row) => /_TBD_|\(inferred\)/i.test(row);

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('#')) {
      const h = line.toLowerCase();
      // "asynchronous" contains "synchronous" — test the longer one first or every event
      // table is parsed with the sync column shape.
      if (h.includes('service registry')) section = 'registry';
      else if (h.includes('asynchronous')) section = 'async';
      else if (h.includes('synchronous')) section = 'sync';
      else if (h.includes('shared')) section = 'shared';
      else if (line.startsWith('## ')) section = null;
      continue;
    }
    if (!section || !line.startsWith('|') || isSeparator(line)) continue;

    const c = cells(line);
    if (c.length < 2) continue;
    // Skip header rows and the template's placeholder rows.
    const first = c[0].toLowerCase();
    if (['service', 'caller', 'event / queue / topic', 'shared thing', 'event / queue (fifo)'].includes(first)) continue;
    if (/^<.*>$/.test(c[0])) continue;

    if (section === 'registry') {
      services.push({ service: c[0], owns: c[1] ?? '', stack: c[2] ?? '', doc: c[3] ?? '', unresolved: unresolved(line) });
      continue;
    }

    const shape = SECTION_SHAPES[section];
    const edge = { kind: section, unresolved: unresolved(line) };
    shape.forEach((k, i) => { edge[k] = c[i] ?? ''; });
    edges.push(edge);
  }

  return { present: true, edges, services };
}

// --- specs ------------------------------------------------------------------

// Parsing lives in scripts/lib/specs.mjs so the dashboard generator and this server agree on
// what a spec says. Mapped to this tool's field names, which are part of its published contract.
function listSpecs() {
  return parseSpecs(ROOT).map((s) => ({
    file: s.file,
    number: s.id,
    slug: s.slug,
    title: s.title,
    status: s.status,                      // the canonical lifecycle word, or null
    rawStatus: s.rawStatus,                // what the cell literally holds
    statusIsCanonical: s.statusIsCanonical,
    branch: s.branch,
    ticket: s.ticket,
    acceptanceCriteria: { total: s.acTotal, checked: s.acChecked },
    archived: s.archived,
  }));
}

function nextSpecNumber() {
  // Every branch, not just the working tree — otherwise two people speccing in parallel
  // both take the next number and collide at merge.
  const used = new Set();
  for (const s of listSpecs()) used.add(Number(s.number));

  const hasRemote = git('remote') !== '';
  let fetched = false;
  if (hasRemote) {
    try {
      execFileSync('git', ['-C', ROOT, 'fetch', '--quiet'], { stdio: 'ignore' });
      fetched = true;
    } catch {
      fetched = false; // offline, or no credentials — reported below, never silently assumed
    }
  }
  const historical = git(
    'log', '--all', '--pretty=format:', '--name-only', '--diff-filter=A', '--', 'specs/[0-9]*',
  );
  for (const line of historical.split('\n')) {
    const m = basename(line.trim()).match(/^(\d{4})-/);
    if (m) used.add(Number(m[1]));
  }

  const max = used.size ? Math.max(...used) : 0;
  return {
    next: String(max + 1).padStart(4, '0'),
    highestUsed: used.size ? String(max).padStart(4, '0') : null,
    countUsed: used.size,
    scannedAllBranches: historical !== '',
    remoteChecked: fetched,
    warning: fetched ? null
      : hasRemote
        ? 'Remote exists but fetch failed (offline or no credentials) — branches you have not pulled were not counted, so a collision is possible.'
        : 'No git remote — only local branches were counted.',
  };
}

// --- deterministic scripts as tools ------------------------------------------
// scripts/ holds the half of the toolkit that must not be a model call: the lifecycle gate, the
// ticket-to-test chain, the NFR compiler. Until now only Claude Code could reach them, which made
// the most load-bearing check in the toolkit — "does this spec have the evidence for Verified?" —
// unavailable to CI, to Cursor, and to any other agent. These expose them.
//
// They are INVOKED, not imported. The scripts parse their own arguments at module top level, so
// importing one would run its CLI; but more than that, invoking is the stronger no-drift
// guarantee. An imported function can diverge from the CLI in argument handling and default
// values, where a subprocess is the same execution path a human gets. The cost is one process
// spawn per call, which is nothing for a read-only tool.
//
// Read-only is preserved by construction: the write-capable flags (`--apply`, `--out`) are never
// passed, and there is no parameter that could smuggle one in.

const SCRIPTS_DIR = join(HERE, '..', 'scripts');

/**
 * @param okExit exit codes that are a RESULT rather than a failure. Several of these scripts exit
 *   1 to mean "the gate failed" — that is an answer, and treating it as an error would turn a
 *   legitimate FAIL into a tool crash the caller cannot read.
 */
/**
 * spec-gate.mjs takes a path; spec-trace.mjs and spec-brief.mjs take a path OR a bare id. A caller
 * cannot be expected to know which is which, so accept both everywhere and resolve here.
 */
function resolveSpecPath(spec) {
  const given = String(spec);
  if (given.includes('/') || given.endsWith('.md')) return given;
  const match = parseSpecs(ROOT).find((s) => String(s.id ?? s.number ?? '').replace(/^0+/, '') === given.replace(/^0+/, ''));
  if (!match) throw new Error(`no spec with id ${given} under ${join(ROOT, 'specs')}`);
  return match.path ?? match.file ?? given;
}

function runScript(file, args, { json = true, okExit = [0, 1] } = {}) {
  const path = join(SCRIPTS_DIR, file);
  if (!existsSync(path)) throw new Error(`script not found: ${file} (expected at ${path})`);

  const r = spawnSync(process.execPath, [path, ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024, shell: false,
  });
  if (r.error) throw new Error(`${file} could not be run: ${r.error.message}`);
  if (r.signal) throw new Error(`${file} was killed by ${r.signal} — likely a timeout`);

  const stdout = String(r.stdout ?? '');
  const stderr = String(r.stderr ?? '').trim();
  if (!okExit.includes(r.status)) {
    throw new Error(`${file} exited ${r.status}${stderr ? `: ${stderr.split('\n').slice(0, 3).join(' ')}` : ''}`);
  }
  if (!json) return { output: stdout.trimEnd(), exitCode: r.status };

  try {
    const parsed = JSON.parse(stdout);
    // exitCode is part of the answer, not noise: 1 means a gate failed, and a caller reading only
    // the payload should not have to infer that from the fields.
    return Array.isArray(parsed) ? { results: parsed, exitCode: r.status } : { ...parsed, exitCode: r.status };
  } catch {
    throw new Error(`${file} did not return JSON (exit ${r.status}). First line: ${stdout.split('\n')[0]?.slice(0, 160) ?? '(no output)'}`);
  }
}

// --- tools ------------------------------------------------------------------

const TOOLS = [
  {
    name: 'estate_lookup',
    description:
      'Who consumes or produces a cross-service contract? Reads docs/ESTATE.md and returns the ' +
      'matching edges (sync HTTP/RPC calls, async events, shared data) with producers, consumers, ' +
      'and whether the row was confirmed against real code or is unverified. Call with no ' +
      'contract to list the whole index. Returns present:false if the repo has no estate index — ' +
      'that means "unknown", NOT "no consumers".',
    inputSchema: {
      type: 'object',
      properties: {
        contract: {
          type: 'string',
          description: 'Event name, endpoint, table, client, or service to match (substring, case-insensitive). Omit for everything.',
        },
      },
    },
  },
  {
    name: 'knowledge_check',
    description:
      'Verify the repo\'s knowledge layer (CLAUDE.md, docs/PATTERNS.md, docs/ARCHITECTURE.md, ' +
      'shards) still matches the code: every file:line reference resolves, doc links resolve, ' +
      'every shard is reachable from the router, docs are within budget. Mechanical only — no ' +
      'judgment about whether a documented pattern is still the right one.',
    inputSchema: {
      type: 'object',
      properties: {
        base: {
          type: 'string',
          description: 'Optional git ref. If given, also reports when source changed and no doc did.',
        },
      },
    },
  },
  {
    name: 'spec_list',
    description:
      'List every spec under specs/ with its lifecycle status, acceptance-criteria progress, ' +
      'branch, and ticket. Includes specs/archive/ flagged as archived.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Optional filter: Draft | Approved | Implemented | Verified | Archived.',
        },
        summaryOnly: {
          type: 'boolean',
          description: 'Return only the summary counts, omitting the per-spec rows. Use on repos with hundreds of specs.',
        },
      },
    },
  },
  {
    name: 'spec_next_number',
    description:
      'The next free spec number, computed across ALL git branches rather than the working ' +
      'tree, so parallel spec authoring does not collide. Fetches first when a remote exists ' +
      'and says so when it could not.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'spec_gate',
    description:
      'The MECHANICAL half of a lifecycle transition, checked exactly: lifecycle ordering, ' +
      'leftover <placeholder> text, whether every acceptance criterion is ticked, whether every ' +
      'test file named in the §6 table ACTUALLY EXISTS ON DISK, and whether the recorded branch ' +
      'is merged. Returns PASS / FAIL / MANUAL per gate. ' +
      'MANUAL means a script cannot witness it — human approval, whether a §8 question is ' +
      'blocking, whether the suite ran green — and a MANUAL is NOT a pass; those still need ' +
      'judging. exitCode 1 means at least one gate FAILED, which is a result, not an error.',
    inputSchema: {
      type: 'object',
      properties: {
        spec: { type: 'string', description: 'Spec file path (specs/0001-foo.md) or bare id (0001).' },
        to: { type: 'string', description: 'Target status: Approved | Implemented | Verified | Archived. Omit for the next one in the lifecycle.' },
      },
      required: ['spec'],
    },
  },
  {
    name: 'spec_trace',
    description:
      'The id chain from ticket to test case, for one spec or every spec — the question an ' +
      'auditor asks and the one a repo usually cannot answer. ' +
      'Distinguishes BROKEN from UNVERIFIABLE on purpose: a ticket reference typed into a header ' +
      'table cannot be checked from inside the repo, and counting it as passing would make the ' +
      'report a lie. exitCode 1 means at least one chain is broken.',
    inputSchema: {
      type: 'object',
      properties: {
        spec: { type: 'string', description: 'Spec path or bare id. Omit for every spec in the repo.' },
      },
    },
  },
  {
    name: 'spec_brief',
    description:
      'Package an approved spec for whoever implements it: acceptance criteria paired with ' +
      'reserved test-case ids, the constraints in force, and the gates that will fail the build — ' +
      'assembled from the three files they are otherwise scattered across. ' +
      'Returns MARKDOWN, not JSON, and deliberately so: it is the same document whether a person ' +
      'or an agent implements the spec. Anything an agent would need that a new engineer would ' +
      'not is a sign the spec is underspecified. exitCode 1 means the spec is not past approval.',
    inputSchema: {
      type: 'object',
      properties: {
        spec: { type: 'string', description: 'Spec path or bare id (e.g. 0031).' },
        repo: { type: 'string', description: 'Optional repo name, for a brief that spans an estate.' },
      },
      required: ['spec'],
    },
  },
  {
    name: 'nfr_check',
    description:
      'Compile the project\'s non-functional requirements and report what does NOT route: an NFR ' +
      'with no machine-checkable threshold, one flattened into an acceptance criterion, or one a ' +
      'spec names that is defined nowhere. Reads docs/NFRS.md (falling back to nfrs.json). ' +
      'Dry-run ONLY — this tool never writes docs/CONSTRAINTS.md or a gates file; run /nfr in the ' +
      'plugin for that. exitCode 1 means at least one NFR could not be compiled, which is the ' +
      'point: an NFR nothing can fail is not being enforced, whatever the document says.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'estate_survey',
    description:
      'Cheap, mechanical inventory of candidate repos before onboarding: stack, knowledge-layer ' +
      'state, spec count, 90-day activity, uncommitted changes, cross-service edge signals, and ' +
      'an init/adopt/refresh/review recommendation each. Costs no model calls and writes nothing. ' +
      'Every judgment is a labelled heuristic — it tells you where to look, not what to conclude.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Parent directory to survey (default: the parent of this repo), or a single repo path.' },
        paths: { type: 'array', items: { type: 'string' }, description: 'Explicit repo paths instead of scanning a parent.' },
      },
    },
  },
];

function callTool(name, args = {}) {
  switch (name) {
    case 'estate_lookup': {
      const estate = parseEstate();
      if (!estate.present) {
        return {
          present: false,
          edges: [],
          note:
            'No docs/ESTATE.md in this repo. This means the cross-service contracts are UNKNOWN, ' +
            'not that there are none. Run /repo-estate (ml-specs) to build the index before ' +
            'concluding a change is safe.',
        };
      }
      const q = (args.contract ?? '').toLowerCase();
      const edges = q
        ? estate.edges.filter((e) => Object.values(e).some((v) => String(v).toLowerCase().includes(q)))
        : estate.edges;
      return {
        present: true,
        query: args.contract ?? null,
        matched: edges.length,
        totalEdges: estate.edges.length,
        unresolvedMatches: edges.filter((e) => e.unresolved).length,
        edges,
        services: estate.services,
        note: edges.some((e) => e.unresolved)
          ? 'Some matched rows are (inferred) or _TBD_ — never confirmed against the peer repo. Treat those as hypotheses.'
          : null,
      };
    }

    case 'knowledge_check': {
      const r = runChecks({ root: ROOT, base: args.base ?? null });
      if (r.empty) {
        return { ok: true, empty: true, note: 'No knowledge layer found (CLAUDE.md / docs/). Run /repo-init.' };
      }
      return {
        ok: r.errors.length === 0,
        docsChecked: r.docs,
        refsChecked: r.refsChecked,
        errors: r.errors,
        warnings: r.warnings,
      };
    }

    case 'spec_list': {
      const all = parseSpecs(ROOT);
      const summary = analyze(all);
      let specs = listSpecs();
      if (args.status) {
        const want = String(args.status).toLowerCase();
        specs = specs.filter((s) => (s.status ?? '').toLowerCase() === want);
      }
      // The summary is what a caller usually needs on a repo with hundreds of specs — it lets
      // a client answer "what's the state?" without rendering every row.
      return {
        count: specs.length,
        summary: {
          total: summary.total,
          active: summary.active,
          byStatus: summary.byStatus,
          withoutLifecycleWord: summary.unknownStatus,
          acceptanceCriteria: { total: summary.acTotal, checked: summary.acChecked },
          duplicateIds: summary.duplicateIds.map((d) => d.id),
          needsAttention: summary.attention.length,
        },
        specs: args.summaryOnly ? undefined : specs,
      };
    }

    case 'spec_next_number':
      return nextSpecNumber();

    case 'spec_gate': {
      if (!args.spec) throw new Error('spec_gate needs a spec: a path (specs/0001-foo.md) or a bare id (0001)');
      const extra = args.to ? ['--to', String(args.to)] : [];
      return runScript('spec-gate.mjs', [resolveSpecPath(args.spec), '--root', ROOT, '--json', ...extra]);
    }

    case 'spec_trace': {
      const target = args.spec ? [String(args.spec)] : [];
      return runScript('spec-trace.mjs', [...target, '--root', ROOT, '--json']);
    }

    case 'spec_brief': {
      if (!args.spec) throw new Error('spec_brief needs a spec: a path or a bare id (e.g. 0031)');
      // Markdown by design — see the tool description. Never pass --out; this server does not write.
      const extra = args.repo ? ['--repo', String(args.repo)] : [];
      return runScript('spec-brief.mjs', [String(args.spec), '--root', ROOT, ...extra], { json: false });
    }

    case 'nfr_check': {
      // Same distinction estate_lookup makes, for the same reason: a repo with no NFR file has
      // UNKNOWN non-functional requirements, not zero. Reporting "nothing failed to compile"
      // would be a false all-clear on exactly the requirements most likely to be agreed and then
      // lost. The CLI exits 1 with a message here, which is right for a CLI and wrong for a tool.
      const nfrFile = ['docs/NFRS.md', 'nfrs.json'].find((f) => existsSync(abs(f)));
      if (!nfrFile) {
        return {
          present: false,
          nfrs: [],
          note:
            'No docs/NFRS.md or nfrs.json in this repo. The non-functional requirements are ' +
            'UNKNOWN, not absent — nothing here says the project has none, only that none are ' +
            'written down where they can be enforced. Run /nfr (ml-specs) to route them.',
        };
      }
      // No --apply and no --gates, ever: those write. The plugin's /nfr is where writing happens,
      // with a human in the loop to approve it.
      return { present: true, source: nfrFile, ...runScript('nfr-compile.mjs', ['--root', ROOT, '--json']) };
    }

    case 'estate_survey': {
      const resolveAgainstRoot = (p) => (isAbsolute(p) ? p : resolve(ROOT, p));
      const targets = Array.isArray(args.paths) && args.paths.length
        ? args.paths.map((p) => resolveAgainstRoot(String(p)))
        : [resolveAgainstRoot(String(args.path ?? '..'))];
      return runScript('survey-estate.mjs', [...targets, '--json'], { okExit: [0] });
    }

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// --- resources: the plugin's templates --------------------------------------

function listResources() {
  const out = [];
  const walk = (dir, prefix) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      const full = join(dir, f);
      if (statSync(full).isDirectory()) walk(full, `${prefix}${f}/`);
      else if (f.endsWith('.md') || f.endsWith('.json') || f.endsWith('.yml')) {
        out.push({
          uri: `mlspec://templates/${prefix}${f}`,
          name: `${prefix}${f}`,
          description: 'ml-specs template',
          mimeType: f.endsWith('.md') ? 'text/markdown' : 'text/plain',
        });
      }
    }
  };
  walk(join(HERE, '..', 'templates'), '');
  return out;
}

function readResource(uri) {
  const rel = uri.replace(/^mlspec:\/\/templates\//, '');
  if (rel.includes('..')) throw new Error('invalid resource uri');
  const path = join(HERE, '..', 'templates', rel);
  if (!existsSync(path)) throw new Error(`no such resource: ${uri}`);
  return readFileSync(path, 'utf8');
}

// --- prompts: the plugin's slash commands ------------------------------------
// commands/ is the plugin's other half, and it is already the shape of an MCP prompt: YAML
// frontmatter (description, argument-hint) over a markdown body with a $ARGUMENTS placeholder.
// Exposing it here is what lets a non-Claude-Code client run /spec, /code and the rest.
//
// The client namespaces these, so `spec` arrives as `/mcp__ml-specs__spec`, not `/spec`.
// That is the client's doing and cannot be opted out of.
//
// Agents have NO MCP equivalent, and several commands delegate real work to one. Rather than
// let those steps silently no-op, any agent a command names in bold is appended to the prompt
// as an appendix — so a client without subagents still gets the instructions. It runs them
// inline, losing the isolated context, tool restrictions and parallelism the plugin gets.
// /spec-fanout degrades the most; it is parallel-by-design.

const COMMANDS_DIR = join(HERE, '..', 'commands');
const AGENTS_DIR = join(HERE, '..', 'agents');

// Deliberately not a YAML parser. Every key in commands/ and agents/ is a flat `key: scalar`
// on one line; anything richer would be a new convention, not a parsing problem.
function parseFrontmatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: src.slice(m[0].length) };
}

// Commands name an agent in bold prose: "Spawn the **spec-reviewer** agent on the file".
// Match that rather than inventing a machine-readable field the plugin does not use, so the
// two halves cannot drift apart.
function agentAppendix(body) {
  if (!existsSync(AGENTS_DIR)) return '';
  const parts = [];
  for (const f of readdirSync(AGENTS_DIR).filter((n) => n.endsWith('.md')).sort()) {
    const slug = basename(f, '.md');
    if (!body.includes(`**${slug}**`)) continue;
    const { body: agentBody } = parseFrontmatter(readFileSync(join(AGENTS_DIR, f), 'utf8'));
    parts.push(`### Agent: ${slug}\n\n${agentBody.trim()}`);
  }
  if (!parts.length) return '';
  return [
    '\n\n---\n',
    '## Inlined agent instructions',
    '',
    'The steps above delegate to subagents. This client has no subagent mechanism, so each',
    'referenced agent is reproduced below — follow its instructions inline, in the same order',
    'the steps call for, keeping its stated scope and restrictions.',
    '',
    parts.join('\n\n'),
  ].join('\n');
}

let PROMPTS = null;
function loadPrompts() {
  if (PROMPTS) return PROMPTS;
  PROMPTS = [];
  if (!existsSync(COMMANDS_DIR)) return PROMPTS;
  for (const f of readdirSync(COMMANDS_DIR).filter((n) => n.endsWith('.md')).sort()) {
    const name = basename(f, '.md');
    const { meta, body } = parseFrontmatter(readFileSync(join(COMMANDS_DIR, f), 'utf8'));
    PROMPTS.push({
      name,
      description: meta.description ?? `ml-specs /${name}`,
      hint: meta['argument-hint'] ?? '',
      takesArgs: body.includes('$ARGUMENTS'),
      body,
    });
  }
  return PROMPTS;
}

// Never `required: true`. Four commands take no arguments at all, and a client that blocks on
// a required field it cannot fill turns a working prompt into a dead menu entry.
function listPrompts() {
  return loadPrompts().map((p) => ({
    name: p.name,
    description: p.description,
    arguments: p.takesArgs
      ? [{ name: 'arguments', description: p.hint || 'arguments for this command', required: false }]
      : [],
  }));
}

function getPrompt(name, args) {
  const p = loadPrompts().find((x) => x.name === name);
  if (!p) throw new Error(`no such prompt: ${name}`);
  const given = typeof args?.arguments === 'string' ? args.arguments.trim() : '';
  const text = p.body.split('$ARGUMENTS').join(given) + agentAppendix(p.body);
  return {
    description: p.description,
    messages: [{ role: 'user', content: { type: 'text', text } }],
  };
}

// --- JSON-RPC over stdio ----------------------------------------------------

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const ok = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

function handle(msg) {
  const { id, method, params } = msg;
  // Notifications have no id and take no response.
  if (id === undefined) return;

  try {
    switch (method) {
      case 'initialize':
        return ok(id, {
          protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION,
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: 'ml-specs', version: VERSION },
        });

      case 'ping':
        return ok(id, {});

      case 'tools/list':
        return ok(id, { tools: TOOLS });

      case 'tools/call': {
        const result = callTool(params?.name, params?.arguments ?? {});
        return ok(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      }

      case 'resources/list':
        return ok(id, { resources: listResources() });

      case 'prompts/list':
        return ok(id, { prompts: listPrompts() });

      case 'prompts/get':
        return ok(id, getPrompt(params?.name, params?.arguments ?? {}));

      case 'resources/read':
        return ok(id, {
          contents: [{ uri: params?.uri, mimeType: 'text/markdown', text: readResource(params?.uri) }],
        });

      default:
        return fail(id, -32601, `method not found: ${method}`);
    }
  } catch (e) {
    // A tool that throws is a tool error, not a protocol error — report it as content so the
    // client can show it, rather than killing the session.
    if (method === 'tools/call') {
      return ok(id, { content: [{ type: 'text', text: `error: ${e.message}` }], isError: true });
    }
    return fail(id, -32603, e.message);
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    try {
      handle(JSON.parse(line));
    } catch {
      fail(null, -32700, 'parse error');
    }
  }
});
process.stdin.on('end', () => process.exit(0));
