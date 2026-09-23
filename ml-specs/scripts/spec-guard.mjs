#!/usr/bin/env node
// Refuse a write that falls outside the active spec's declared `Touches` — before it lands.
//
//   node spec-guard.mjs src/billing/tax.ts            # ask about named paths
//   node spec-guard.mjs --stdin                       # read a PreToolUse payload on stdin
//   node spec-guard.mjs src/x.ts --spec specs/0001-a.md --root /repo --json
//
// `spec-gate.mjs` already fails a transition whose branch touched something the spec never
// declared. That is the right check at the wrong moment: by then the work exists, the agent has
// moved on, and somebody has to choose between reverting good code and widening the spec after
// the fact to cover what was already written. This runs before the edit, where the answer is
// still cheap — about a quarter of a second against a gate that has to run your suite.
//
// ── The exit code is the HOST's contract, not this toolkit's ────────────────────────────────
//
// Everywhere else in these scripts: 0 fine, 1 a gate failed, 2 could not run. Here 2 means BLOCK
// THE EDIT, because that is what a `PreToolUse` hook must return to refuse a tool call. This
// exists to be called by that hook, so it speaks the host's language rather than its own.
//
// ── It fails open, always ───────────────────────────────────────────────────────────────────
//
// No active spec, a spec with no `Touches`, an unreadable spec, no paths in the payload: ALLOW,
// and say why on stderr. A guard that blocks when it is confused gets switched off after one bad
// afternoon, and a switched-off guard protects nothing — including against the write it was
// added for. Every refusal below is a case where the answer is known, not merely suspected.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { listSpecs } from './lib/specs.mjs';
import { outside, toRepoRelative } from './lib/scope.mjs';
import { shellWriteTargets } from './lib/shell.mjs';
import { record as logDecision } from './lib/activity.mjs';

const BLOCK = 2;
const ALLOW = 0;

const argv = process.argv.slice(2);
const flagged = new Set(['spec', 'root']);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : (argv[i + 1] ?? null); };
const has = (n) => argv.includes(`--${n}`);
const JSON_OUT = has('json');
const ROOT = resolve(flag('root') ?? process.cwd());

const paths = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && flagged.has(argv[i - 1]?.replace(/^--/, ''))));

// Both exits log, because there are seven return points and an eighth would be added without a
// line here — which is exactly how a record ends up with holes in the paths nobody thought about.
// Writing the log never changes the decision; see `lib/activity.mjs`.
const allow = (why, extra = {}) => {
  logDecision(ROOT, { decision: 'allow', reason: why, spec: extra.spec ?? null, files: extra.files ?? extra.stray, tool: TOOL });
  if (JSON_OUT) console.log(JSON.stringify({ decision: 'allow', reason: why, ...extra }, null, 2));
  else if (why) console.error(`spec-guard: allowing — ${why}`);
  process.exit(ALLOW);
};
const block = (why, extra = {}) => {
  logDecision(ROOT, { decision: 'block', reason: why, spec: extra.spec ?? null, files: extra.stray ?? extra.files, tool: TOOL });
  // stderr on purpose: a PreToolUse hook hands stderr back to the model as the refusal reason.
  if (JSON_OUT) console.log(JSON.stringify({ decision: 'block', reason: why, ...extra }, null, 2));
  else console.error(`spec-guard: BLOCKED — ${why}`);
  process.exit(BLOCK);
};

/** Pull the file paths out of a PreToolUse payload. Shapes differ by tool; read them all. */
export function pathsFromPayload(text) {
  if (!text || !text.trim()) return [];
  try {
    const payload = JSON.parse(text);
    TOOL = typeof payload.tool_name === 'string' ? payload.tool_name : (payload.toolName ?? null);
    const input = payload.tool_input ?? payload.toolInput ?? payload.input ?? payload;
    const out = [input.file_path, input.filePath, input.path, input.notebook_path]
      .filter((v) => typeof v === 'string');
    for (const edit of input.edits ?? input.files ?? []) {
      const p = edit?.file_path ?? edit?.path;
      if (typeof p === 'string') out.push(p);
    }
    // A Bash payload carries no file_path — it carries a command that names its own write
    // targets. Without reading it, one `echo … > src/other.ts` walks past a guard watching the
    // four write tools. `shellWriteTargets` covers redirections and `tee` and says so; anything
    // it cannot read yields nothing, which allows.
    if (typeof input.command === 'string') out.push(...shellWriteTargets(input.command));
    return [...new Set(out)];
  } catch {
    // A payload we cannot parse is not a write we can judge.
    return [];
  }
}

// Which tool is writing, when the host says. No host is obliged to, so this is read where it is
// present and left null where it is not — never demanded.
let TOOL = null;
const requested = has('stdin')
  ? pathsFromPayload((() => { try { return readFileSync(0, 'utf8'); } catch { return ''; } })())
  : paths;

if (!requested.length) allow('no file paths in this call');

// ---------------------------------------------------------------------------- the active spec

/**
 * Which spec is being worked on: `--spec` if given, else the one whose `Branch` row names the
 * current branch. Exactly one match, or none — two specs on one branch is ambiguous, and
 * guessing would bound the writes of one spec by the declarations of another.
 */
function activeSpec() {
  let specs;
  try {
    specs = listSpecs(ROOT);
  } catch (e) {
    return { spec: null, why: `the specs could not be read (${e.code ?? 'error'})` };
  }

  const explicit = flag('spec');
  if (explicit) {
    const want = explicit.replace(/^\.\//, '');
    const hit = specs.find((s) => s.file === want || s.id === want || s.file.endsWith(`/${want.split('/').pop()}`));
    return hit ? { spec: hit, via: '--spec' } : { spec: null, why: `no spec matching '${explicit}'` };
  }

  let branch;
  try {
    // stderr ignored: git prints `fatal: not a git repository` there, and this command's output
    // is handed to a model as the reason a write was refused. Somebody else's error text arriving
    // in that slot reads as the guard malfunctioning.
    branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return { spec: null, why: 'not a git work tree, so no branch to match a spec against' };
  }
  if (!branch || branch === 'HEAD') return { spec: null, why: 'no named branch to match a spec against' };

  const matches = specs.filter((s) => s.branch && s.branch.replace(/[`*]/g, '').trim() === branch);
  if (matches.length === 1) return { spec: matches[0], via: `branch ${branch}` };
  if (matches.length > 1) return { spec: null, why: `${matches.length} specs name branch ${branch} — ambiguous` };
  return { spec: null, why: `no spec names branch ${branch}` };
}

const { spec, via, why } = activeSpec();
if (!spec) allow(why, { files: requested });
if (!spec.touches.length) {
  allow(`${spec.id} declares no Touches — nothing to bound`, { spec: spec.file, files: requested });
}

// ---------------------------------------------------------------------------- the decision

// A redirect outside the repository is not this guard's business. `git diff > /tmp/d.patch` is
// outside every spec's scope in the sense that it is outside the tree, and refusing it would be
// a false block on a routine command — which is how a guard gets switched off.
const relative_ = requested
  .map((f) => toRepoRelative(ROOT, f))
  .filter((f) => !isAbsolute(f));
if (!relative_.length) allow('nothing in this call writes inside the repository');

const stray = outside(spec.touches, relative_);

if (!stray.length) {
  allow('', { spec: spec.file, via, files: relative_ });
}

block(
  `${stray.join(', ')} ${stray.length === 1 ? 'is' : 'are'} outside the scope ${spec.id} declares.\n` +
  `  Declared Touches: ${spec.touches.join(', ')}\n` +
  `  Active spec:      ${spec.file} (${via})\n\n` +
  '  This is a contract change, not an implementation detail: widen the Touches row in the spec\n' +
  '  first — with a human — then retry. `specs/` is always writable, so you can make that edit.',
  { spec: spec.file, via, stray, declared: spec.touches },
);
