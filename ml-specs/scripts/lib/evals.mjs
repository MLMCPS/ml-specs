// Evaluating the prompts. Spec 0046.
//
// WHY THIS EXISTS
//
// This repository is 25 commands, 10 agents and a skill — most of what it *is*, is prompt text —
// and it has 850 tests, none of which can tell whether a prompt works. Every assertion over the
// prompt surface checks that a literal is PRESENT. `mlskills-flag-wiring.test.mjs:10-13` says why
// that is the right call and names the hole it leaves: it does not assert what the prose MEANS,
// because pinning wording "pressures people to write worse prose to appease the test", and whether
// each site honours its instruction is "a REVIEW obligation, not a test".
//
// So a command can be rewritten into something that no longer works and every gate stays green.
//
// THE ONE RULE THAT KEEPS THIS FROM BECOMING THE THING IT REPLACES
//
// An expectation is a FILE, an EXIT CODE, or an ABSENCE. Never a string the model produced. That
// is enforced by the schema rather than by discipline: `KINDS` is a closed set and not one of its
// members carries a pattern to match against output. A checker cannot be talked into "and it must
// say it refused" one convenient review at a time if there is no field to put it in.
//
// `not run` IS A RESULT
//
// No runner configured means every case reports `not run` — counted separately, never folded into
// passes. The same distinction `lib/evidence.mjs:14` draws for `unknown`, and for the same reason:
// "could not determine" collapsing into "fine" is the failure this toolkit exists to prevent.
//
// A `lib/` module never consoles. It returns results; the caller prints them.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every expectation kind, and what each inspects.
 *
 * A CLOSED SET, and the closure is the design. None of these takes a regex, a substring or any
 * other handle on what the model wrote — so spec 0046 AC4 is checkable against this table rather
 * than against a convention somebody has to remember.
 */
export const KINDS = Object.freeze({
  exists: { takes: 'path', inspects: 'filesystem' },
  absent: { takes: 'path', inspects: 'filesystem' },
  unchanged: { takes: 'path', inspects: 'filesystem' },
  exit: { takes: 'number', inspects: 'exit-code' },
});

export const RESULTS = Object.freeze({ PASS: 'pass', FAIL: 'fail', NOT_RUN: 'not run' });

/** The runner that can drive an agent headlessly. Absent is a valid, silent state. */
export const runnerFrom = (env = process.env) => env.ML_SPECS_EVAL_RUNNER || null;

/**
 * Validate one eval file's shape. Returns findings; empty means usable.
 *
 * @param {string} name  the file's basename without `.json`
 * @param {unknown} doc
 * @returns {Array<{rule: string, message: string}>}
 */
export function validate(name, doc) {
  const out = [];
  const bad = (rule, message) => out.push({ rule, message });

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    bad('shape', 'not a JSON object');
    return out;
  }
  if (doc.command !== name) bad('command', `declares \`command: ${doc.command}\` but is named ${name}.json`);
  if (!Array.isArray(doc.cases) || doc.cases.length === 0) {
    bad('cases', 'no cases — an eval file with none asserts nothing');
    return out;
  }

  doc.cases.forEach((c, i) => {
    const at = `case ${i + 1}${c?.name ? ` (${c.name})` : ''}`;
    if (!c || typeof c !== 'object') return bad('case', `${at}: not an object`);
    if (!c.name) bad('case', `${at}: no name — a failing case has to be nameable`);
    if (!c.given || typeof c.given !== 'object') bad('case', `${at}: no \`given\` fixture`);
    if (typeof c.invoke !== 'string' || !c.invoke.trim()) bad('case', `${at}: no \`invoke\``);

    if (!Array.isArray(c.expect) || c.expect.length === 0) {
      return bad('case', `${at}: no expectations — the case would pass whatever happened`);
    }
    c.expect.forEach((e, j) => {
      const where = `${at}, expectation ${j + 1}`;
      if (!e || typeof e !== 'object') return bad('expect', `${where}: not an object`);
      const kinds = Object.keys(e).filter((k) => k !== 'why');
      if (kinds.length !== 1) {
        return bad('expect', `${where}: names ${kinds.length} kinds (${kinds.join(', ')}) — one each`);
      }
      const [kind] = kinds;
      if (!Object.hasOwn(KINDS, kind)) {
        // The rule this whole layer rests on. An unknown kind is almost always somebody reaching
        // for `contains` or `matches`, which is the wording-pin this file exists to refuse.
        return bad('expect', `${where}: \`${kind}\` is not an expectation kind — `
          + `known: ${Object.keys(KINDS).join(', ')}. An expectation is a file, an exit code or an `
          + 'absence, never a string the model produced (docs/PROMPTS.md, spec 0046)');
      }
      const want = KINDS[kind].takes;
      const got = typeof e[kind];
      if (want === 'path' && (got !== 'string' || !e[kind].trim())) {
        bad('expect', `${where}: \`${kind}\` takes a path, got ${got}`);
      }
      if (want === 'number' && got !== 'number') {
        bad('expect', `${where}: \`${kind}\` takes a number, got ${got}`);
      }
    });
  });

  return out;
}

/** Load every eval file from a directory. Derived from the filesystem, never from a registry. */
export function readEvals(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const name = f.slice(0, -5);
      const path = join(dir, f);
      try {
        return { name, path, doc: JSON.parse(readFileSync(path, 'utf8')), unreadable: null };
      } catch (e) {
        return { name, path, doc: null, unreadable: e.message };
      }
    });
}

/**
 * Judge one case's expectations against a fixture directory and an exit code.
 *
 * Pure apart from reading the filesystem it is asked about — it runs nothing. The runner is the
 * caller's job, which is what lets every expectation here be tested without a model.
 *
 * @param {object} c  the case
 * @param {{dir: string, code: number, before: Map<string, string>}} observed
 */
export function judge(c, observed) {
  const failures = [];
  for (const e of c.expect) {
    const [kind] = Object.keys(e).filter((k) => k !== 'why');
    const value = e[kind];
    if (kind === 'exists' && !existsSync(join(observed.dir, value))) {
      failures.push(`expected ${value} to exist`);
    }
    if (kind === 'absent' && existsSync(join(observed.dir, value))) {
      failures.push(`expected ${value} to be absent, and it is there`);
    }
    if (kind === 'unchanged') {
      const now = existsSync(join(observed.dir, value))
        ? readFileSync(join(observed.dir, value), 'utf8') : null;
      if (now !== (observed.before.get(value) ?? null)) failures.push(`${value} changed`);
    }
    if (kind === 'exit' && observed.code !== value) {
      failures.push(`expected exit ${value}, got ${observed.code}`);
    }
  }
  return { result: failures.length ? RESULTS.FAIL : RESULTS.PASS, failures };
}

/** Counts, with `not run` held apart from passes. */
export function tally(results) {
  const count = (r) => results.filter((x) => x.result === r).length;
  return {
    total: results.length,
    pass: count(RESULTS.PASS),
    fail: count(RESULTS.FAIL),
    notRun: count(RESULTS.NOT_RUN),
  };
}
