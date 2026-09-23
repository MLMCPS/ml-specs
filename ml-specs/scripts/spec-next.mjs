#!/usr/bin/env node
// The one thing to do next, and the command you did not know to type. Spec 0031.
//
//   node spec-next.mjs                              # read the board, print the next command
//   node spec-next.mjs specs/0031-routing.md        # ...for one spec
//   node spec-next.mjs --route "the login page crashes on submit"
//   node spec-next.mjs --json --root /path/to/repo
//
// `spec-why.mjs` says why a spec CANNOT advance. This says what it can do — the inverse, and the
// question people actually ask first.
//
// READ-ONLY AND ADVISORY. It prints a command; it never runs one, and it writes nothing. Routing
// is navigation, never consent — the rule `CLAUDE.md` already states for the six loop commands'
// closing options.
//
// The evidence verdict is ASKED OF `spec-evidence.mjs`, not re-derived. Two sources of truth about
// whether a record still stands would be one too many, and `spec-why.mjs:99` already made this
// call for the same reason. That script is read-only too, so the no-write property survives the
// spawn — `next-wiring.test.mjs` asserts that rather than assuming it.
//
// Exit codes: 0 whenever it could answer — "nothing is outstanding" is an answer, not a failure —
// and 2 when the board cannot be read. Never 1: there is no finding here, only a suggestion.

import { existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listSpecs, LIFECYCLE } from './lib/specs.mjs';
import { nextFor, route } from './lib/route.mjs';

const OK = 0;
const CANNOT_RUN = 2;

const HERE = fileURLToPath(new URL('.', import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : (argv[i + 1] ?? null); };
const has = (n) => argv.includes(`--${n}`);
const JSON_OUT = has('json');
const ROOT = resolve(flag('root') ?? process.cwd());

// A flag's VALUE is not a positional. `--root /tmp/x` would otherwise hand `/tmp/x` back as the
// spec to look at, which is the argv bug 0059 shipped with and had to fix.
const positional = argv.filter((a, i) => !a.startsWith('--') && !String(argv[i - 1] ?? '').startsWith('--'));

const die = (msg) => { console.error(`spec-next: ${msg}`); process.exit(CANNOT_RUN); };

/** One answer, one reason, out. */
function say(answer, extra = {}) {
  if (JSON_OUT) {
    console.log(JSON.stringify({ ...answer, ...extra }, null, 2));
  } else if (answer.command === null) {
    console.log(`  ${answer.why}`);
  } else {
    console.log(`  → ${answer.command}`);
    console.log(`    because ${answer.why}`);
    if (extra.runnerUp) console.log(`    (next closest: ${extra.runnerUp.command} — ${extra.runnerUp.why})`);
    if (extra.alsoReady?.length) {
      console.log(`    ${extra.alsoReady.length} other spec(s) are equally ready: ${extra.alsoReady.join(', ')}`);
    }
  }
  process.exit(OK);
}

// ── --route ───────────────────────────────────────────────────────────────────────────────────

if (has('route')) {
  const sentence = flag('route');
  if (sentence === null) die('--route needs a sentence');
  const r = route(sentence);
  say({ command: r.command, why: r.why },
    { matched: r.matched, id: r.id, ...(r.runnerUp ? { runnerUp: r.runnerUp } : {}) });
}

// ── the board ─────────────────────────────────────────────────────────────────────────────────

let specs;
try {
  specs = listSpecs(ROOT);
} catch (e) {
  die(`could not read the board at ${ROOT}: ${e.message}`);
}

/**
 * Failing verdicts by spec file, from the one script that judges them.
 *
 * A board this cannot read is not an error: the answer degrades to the lifecycle alone, and the
 * reason printed says which artifact it came from either way. `unavailable ≠ pass` cuts the other
 * way here — the suggestion is advisory, so a missing verdict costs a worse suggestion, not a
 * wrong claim.
 */
function failingRecords() {
  let out;
  try {
    out = execFileSync(process.execPath, [join(HERE, 'spec-evidence.mjs'), '--root', ROOT, '--json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    // It exits 1 when something IS failing, which is the result and not a crash.
    out = e.stdout || '';
  }
  try {
    const parsed = JSON.parse(out);
    return new Map((parsed.records ?? []).filter((r) => r.failing).map((r) => [r.spec, r]));
  } catch {
    return new Map();
  }
}

const failing = failingRecords();

// ── one spec ──────────────────────────────────────────────────────────────────────────────────

const specArg = positional[0];
if (specArg) {
  const abs = resolve(ROOT, specArg);
  if (!existsSync(abs)) die(`no spec at ${specArg}`);
  const rel = relative(ROOT, abs).split('\\').join('/');
  const spec = specs.find((s) => s.file === rel);
  if (!spec) die(`${rel} is not a spec this board lists — it must sit in specs/ and be named NNNN-slug.md`);

  const answer = nextFor(spec, failing.get(rel) ?? null);
  say(answer ?? { command: null, why: `${rel} is Archived — there is nothing left to do` }, { spec: rel });
}

// ── the whole board ───────────────────────────────────────────────────────────────────────────

/**
 * Lower sorts first.
 *
 * A claim that stopped standing outranks new work, and a Status cell nobody can read outranks the
 * rest of the lifecycle: both are board health, and building on top of either compounds it.
 * Within the lifecycle, finish what is furthest along before starting something else.
 */
function rank(spec) {
  if (failing.has(spec.file)) return 0;
  const i = LIFECYCLE.indexOf(spec.status);
  if (i === -1) return 1;
  return 2 + (LIFECYCLE.length - 1 - i);
}

const live = specs
  .filter((s) => !s.archived && s.status !== 'Archived')
  .map((s) => ({ spec: s, rank: rank(s), answer: nextFor(s, failing.get(s.file) ?? null) }))
  .filter((c) => c.answer)
  .sort((a, b) => a.rank - b.rank || a.spec.id.localeCompare(b.spec.id));

if (!live.length) {
  say({ command: null, why: specs.length
    ? 'every spec on this board is Archived — start one with /ml-specs:spec'
    : 'this repo has no specs yet — start one with /ml-specs:spec' },
  { considered: specs.length });
}

const [winner, ...rest] = live;
// §8's open question, answered the safe way: one command, plus a count of the specs that tied with
// it. A verb that silently picked one of six equal candidates would be a coin flip wearing a
// reason.
const alsoReady = rest.filter((c) => c.rank === winner.rank).map((c) => c.spec.file);

say(winner.answer, { spec: winner.spec.file, considered: live.length, alsoReady });
