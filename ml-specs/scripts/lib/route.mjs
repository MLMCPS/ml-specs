// The command you did not know to type, and the one thing to do next. Spec 0031.
//
// This toolkit has 29 commands and expects you to know which one you are in. A newcomer with a
// ticket reads `specs/README.md` to learn the answer is `/ml-specs:spec`; somebody mid-loop has to
// remember whether the next step is `spec-verify` or `spec-advance`. Both answers are already
// derivable — from the request's shape in the first case, from the spec's artifacts in the second.
//
// ADVISORY, AND READ-ONLY BY CONSTRUCTION. These functions return an answer; nothing here runs a
// command or writes a file. Navigation is never consent — the rule `CLAUDE.md` already states for
// the six loop commands' closing options.
//
// EVERY ANSWER CARRIES ITS REASON, AND THE REASON NAMES THE ARTIFACT IT CAME FROM. "Run
// spec-verify" is a suggestion you either trust or do not; "run spec-verify — its Status cell reads
// Implemented" is one you can argue with. A confident wrong suggestion with no derivation is worse
// than none.
//
// NO MODEL CALL. Both answers come from the artifacts and two literal tables. A router that has to
// ask a model what to type has not saved anybody anything.
//
// BOTH TABLES ARE DATA, not code, so AC4 can walk every command either of them can name and prove
// it exists. A table naming a command nobody shipped is the `--all`-flag defect specs 0025 and 0026
// both record: output describing a capability that is not there.
//
// A `lib/` module never consoles. It returns answers; the caller prints them.

import { FAILING } from './evidence.mjs';

/**
 * The next command per status, and the artifact that says so.
 *
 * `Archived` is `null` on purpose. A finished spec has nothing to do, and inventing work for it is
 * how a board grows noise nobody reads.
 */
export const BY_STATUS = Object.freeze({
  Draft: { command: '/ml-specs:spec-review', why: 'its Status cell reads Draft, so the contract has had no adversarial pass' },
  Approved: { command: '/ml-specs:spec-build', why: 'its Status cell reads Approved, so the contract is agreed and nothing is built against it' },
  Implemented: { command: '/ml-specs:spec-verify', why: 'its Status cell reads Implemented, and no review has judged it against its own criteria' },
  Verified: { command: '/ml-specs:pr', why: 'its Status cell reads Verified, and the work is unmerged' },
  Archived: null,
});

/** What to suggest when the Status cell holds something that is not a lifecycle value. */
const OFF_LIFECYCLE = Object.freeze({ command: '/ml-specs:repo-doctor' });

/** What to suggest when the spec's own evidence record has stopped standing. */
const RECORD_FAILING = Object.freeze({ command: '/ml-specs:spec-advance' });

/**
 * What to do next for one spec.
 *
 * Pure: the same board gives every developer the same answer. A suggestion that depends on who is
 * asking is one nobody trusts twice.
 *
 * @param {{status: string|null, file: string}} spec
 * @param {{verdict?: string, reason?: string, to?: string}|null} evidence  its freshness verdict
 * @returns {{command: string, why: string}|null}  null when there is nothing left to do
 */
export function nextFor(spec, evidence = null) {
  const file = spec?.file ?? '';

  // A failing record outranks the lifecycle. A spec reading `Verified` over a record that went
  // stale a fortnight ago does not need the next transition — it needs the claim re-earned. The
  // lifecycle's next step would be `/ml-specs:pr`, which ships the unearned claim.
  //
  // `FAILING` is imported rather than restated. Two copies of which verdicts block would drift,
  // and this one would drift silently: it produces advice, not an error.
  if (evidence && FAILING.has(evidence.verdict)) {
    return {
      command: `${RECORD_FAILING.command} ${file} --to ${evidence.to ?? spec?.status ?? 'Draft'}`,
      why: `its evidence record reads \`${evidence.verdict}\` — ${evidence.reason ?? 'the tree moved under the gate that granted this status'}`,
    };
  }

  const status = spec?.status ?? null;
  if (Object.hasOwn(BY_STATUS, status)) {
    const row = BY_STATUS[status];
    return row ? { command: `${row.command} ${file}`.trim(), why: row.why } : null;
  }

  return {
    command: `${OFF_LIFECYCLE.command}`,
    why: status === null
      ? `its Status cell holds nothing a lifecycle value could be read out of`
      : `its Status cell reads \`${status}\`, which is not a lifecycle value`,
  };
}

/**
 * The route table: a sentence to a command.
 *
 * A literal table, not a heuristic, and every row states why — so a wrong route is arguable rather
 * than mysterious. Order is priority: the first match wins and the second is reported beside it.
 */
export const ROUTES = Object.freeze([
  { id: 'pr-feedback',
    when: /\b(review|feedback|comments?)\s+(on\s+)?(the\s+|my\s+)?(pr|pull request)\b|\bpr\s+(feedback|comments?)\b/i,
    command: '/ml-specs:pr-address', why: 'there is review feedback on an open PR to turn into work' },
  { id: 'defect',
    when: /\b(bug|broken|crash(es|ed)?|regression|not working|defect|throws?)\b/i,
    command: '/ml-specs:fix', why: 'a defect already has a contract — the code is violating it' },
  { id: 'explain',
    when: /\b(explain|how does|what does|walk me through|understand)\b/i,
    command: '/ml-specs:explain', why: 'you are asking what existing code does, not changing it' },
  { id: 'open-pr',
    when: /\b(open|raise|draft|write)\s+(a\s+|the\s+)?(pr|pull request)\b/i,
    command: '/ml-specs:pr', why: 'you want the PR text for work that is already done' },
  { id: 'board',
    when: /\b(status|board|in flight|where are we|what.s left)\b/i,
    command: '/ml-specs:repo-status', why: 'you are asking about the board, not about one change' },
  { id: 'explore',
    when: /\b(explore|investigate|options|approaches|spike|research|trade.?offs?)\b/i,
    command: '/ml-specs:spec-explore', why: 'the problem space is not settled enough to write a contract' },
  { id: 'trivial',
    when: /\b(one.?liner?|trivial|typo|rename|tiny)\b/i,
    command: '/ml-specs:code', why: 'a trivial change is exempt from the spec loop' },
  { id: 'onboard',
    when: /\b(onboard|adopt|set ?up|new repo|install)\b/i,
    command: '/ml-specs:repo-init', why: 'this repo has not learned its own knowledge layer yet' },
]);

/** Where an unmatched sentence goes, said out loud rather than guessed at. */
export const DEFAULT_ROUTE = Object.freeze({
  command: '/ml-specs:spec',
  why: 'nothing in the request matched a row of the route table, and a non-trivial change starts with a spec',
});

/**
 * Route a sentence.
 *
 * @returns {{command, why, matched: boolean, id: string|null, runnerUp: {command, why, id}|null}}
 */
export function route(sentence) {
  const text = String(sentence ?? '');
  const hits = ROUTES.filter((r) => r.when.test(text));

  if (!hits.length) {
    // AC3: the default is reported AS a default. A router that answers an unmatched sentence with
    // the same confident shape as a matched one teaches people to stop reading the reason.
    return { ...DEFAULT_ROUTE, matched: false, id: null, runnerUp: null };
  }

  const [first, second] = hits;
  return {
    command: first.command,
    why: first.why,
    matched: true,
    id: first.id,
    // Named so the answer is arguable. A single confident suggestion with nothing beside it gives
    // a reader no way to see what it nearly said instead.
    runnerUp: second ? { command: second.command, why: second.why, id: second.id } : null,
  };
}

/**
 * Every command either table can name — AC4's input.
 *
 * Both tables, not just the route one. `nextFor`'s suggestions rot exactly the same way, and a
 * check that walked half the surface would read as complete.
 */
export const namedCommands = () => [...new Set([
  ...ROUTES.map((r) => r.command),
  DEFAULT_ROUTE.command,
  ...Object.values(BY_STATUS).filter(Boolean).map((r) => r.command),
  OFF_LIFECYCLE.command,
  RECORD_FAILING.command,
])];
