// Spec 0031 AC1, AC2, AC3, AC6 — the pure half.
//
// `next-wiring.test.mjs` drives the CLI and proves it writes nothing. These are the two functions
// underneath, and they are worth testing here because all four criteria are properties of the
// ANSWER rather than of the output: which command, whether the record outranks the status, whether
// an unmatched sentence says so, and whether every answer carries its derivation. A property
// asserted only through a rendered line is one that survives a rendering change.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextFor, route, ROUTES, BY_STATUS, DEFAULT_ROUTE, namedCommands } from './route.mjs';
import { LIFECYCLE } from './specs.mjs';
import { FAILING, STALE, AMENDED, UNSOUND, FRESH, UNKNOWN, SUPERSEDED } from './evidence.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const spec = (status, file = 'specs/0031-routing-and-next.md') => ({ status, file });

describe('AC1 — a next command per status, and null at the end', () => {
  test('each of the five statuses', () => {
    assert.match(nextFor(spec('Draft')).command, /^\/ml-specs:spec-review /);
    assert.match(nextFor(spec('Approved')).command, /^\/ml-specs:spec-build /);
    assert.match(nextFor(spec('Implemented')).command, /^\/ml-specs:spec-verify /);
    assert.match(nextFor(spec('Verified')).command, /^\/ml-specs:pr /);
    assert.equal(nextFor(spec('Archived')), null);
  });

  test('Archived returns null rather than inventing one', () => {
    // The criterion exists because the obvious implementation — index into the lifecycle and take
    // the next one — has nowhere to go at the end and reaches for something. A finished spec has
    // nothing to do, and work invented for it is how a board grows noise nobody reads.
    assert.equal(nextFor(spec('Archived')), null);
    assert.equal(BY_STATUS.Archived, null, 'the table gave Archived a command');
  });

  test('the answer names the spec it is about', () => {
    // Without it the suggestion is unrunnable: `/ml-specs:spec-build` with no argument asks the
    // reader to work out which spec, which is the question they came with.
    assert.equal(nextFor(spec('Approved', 'specs/0042-x.md')).command,
      '/ml-specs:spec-build specs/0042-x.md');
  });

  test('the table covers the lifecycle exactly — no more, no less', () => {
    // Drift guard. A status added to `specs.mjs` and not to this table would fall through to
    // repo-doctor, which reads as "your board is broken" for a status the toolkit just shipped.
    assert.deepEqual(Object.keys(BY_STATUS), [...LIFECYCLE]);
  });

  test('a status that is not a lifecycle value routes to repo-doctor, saying which', () => {
    const a = nextFor(spec('Done-ish'));
    assert.equal(a.command, '/ml-specs:repo-doctor');
    assert.match(a.why, /Done-ish/, 'the answer does not name the value it could not read');
  });

  test('and so does an empty Status cell, without printing `null` at the reader', () => {
    const a = nextFor(spec(null));
    assert.equal(a.command, '/ml-specs:repo-doctor');
    assert.doesNotMatch(a.why, /null|undefined/);
  });
});

describe('AC2 — a failing record outranks the lifecycle', () => {
  test('a Verified spec over a stale record is told to re-earn it, not to open a PR', () => {
    const a = nextFor(spec('Verified'), { verdict: STALE, to: 'Verified', reason: 'two §6 tests changed' });
    assert.match(a.command, /^\/ml-specs:spec-advance /,
      'the lifecycle won — the unearned Verified claim would have gone into a PR');
    assert.match(a.command, /--to Verified/, 'the suggestion does not name the status to re-record');
    assert.match(a.why, /stale/);
    assert.match(a.why, /two §6 tests changed/, 'the record\'s own reason was dropped');
  });

  test('every failing verdict does it, not just the one that was easy to think of', () => {
    for (const verdict of [STALE, AMENDED, UNSOUND]) {
      const a = nextFor(spec('Implemented'), { verdict, to: 'Implemented' });
      assert.match(a.command, /^\/ml-specs:spec-advance /, `${verdict} fell through to the lifecycle`);
    }
  });

  test('and a passing or unjudgeable verdict does NOT — the lifecycle keeps running', () => {
    // The other half. A rule that fires on everything is one that has stopped discriminating:
    // `unknown` means nobody could judge it, and `unavailable ≠ pass` cuts both ways — it is also
    // not a failure.
    for (const verdict of [FRESH, UNKNOWN, SUPERSEDED]) {
      const a = nextFor(spec('Implemented'), { verdict, to: 'Implemented' });
      assert.match(a.command, /^\/ml-specs:spec-verify /, `${verdict} was treated as failing`);
    }
    assert.match(nextFor(spec('Implemented'), null).command, /^\/ml-specs:spec-verify /);
  });

  test('the failing set is imported, not restated', () => {
    // Two copies of which verdicts block would drift, and this copy would drift SILENTLY: it
    // produces advice, not an error. Asserted against the source because that is where the
    // duplication would reappear.
    const src = readFileSync(join(HERE, 'route.mjs'), 'utf8');
    assert.match(src, /import \{[^}]*\bFAILING\b[^}]*\} from '\.\/evidence\.mjs'/);
    assert.doesNotMatch(src, /new Set\(\[\s*'stale'/, 'the failing set was restated in route.mjs');
    assert.deepEqual([...FAILING].sort(), [AMENDED, STALE, UNSOUND].sort());
  });

  test('a record with no `to` still produces a runnable suggestion', () => {
    const a = nextFor(spec('Implemented'), { verdict: STALE });
    assert.match(a.command, /--to Implemented$/, 'it fell back to something unrunnable');
  });
});

describe('AC3 — an unmatched sentence says so, and does not guess', () => {
  test('the default is /ml-specs:spec, reported AS a default', () => {
    const r = route('please make the thing do the other thing by tuesday');
    assert.equal(r.command, '/ml-specs:spec');
    assert.equal(r.matched, false, 'an unmatched sentence was reported as a match');
    assert.equal(r.id, null);
    assert.match(r.why, /matched a row|route table/,
      'the reason does not say the table matched nothing — a reader cannot tell a guess from a hit');
  });

  test('empty, whitespace and null input land on the default rather than throwing', () => {
    for (const input of ['', '   ', null, undefined]) {
      const r = route(input);
      assert.equal(r.matched, false, `${JSON.stringify(input)} matched something`);
      assert.equal(r.command, DEFAULT_ROUTE.command);
    }
  });

  test('a matched sentence is NOT reported as a default', () => {
    // The sensor for the above: a router that answered `matched: false` for everything would pass
    // every assertion in this block.
    const r = route('the checkout page crashes when the cart is empty');
    assert.equal(r.matched, true);
    assert.equal(r.command, '/ml-specs:fix');
    assert.equal(r.id, 'defect');
  });

  test('representative sentences land where a person would expect', () => {
    const cases = [
      ['there is review feedback on the PR to deal with', '/ml-specs:pr-address'],
      ['login is broken for SSO users', '/ml-specs:fix'],
      ['explain how the evidence record is written', '/ml-specs:explain'],
      ['open a PR for this branch', '/ml-specs:pr'],
      ['what is the status of the board', '/ml-specs:repo-status'],
      ['investigate the options for multi-tenant storage', '/ml-specs:spec-explore'],
      ['fix a typo in the README', '/ml-specs:code'],
      ['set up this repo to use the toolkit', '/ml-specs:repo-init'],
    ];
    for (const [sentence, command] of cases) {
      assert.equal(route(sentence).command, command, `"${sentence}"`);
    }
  });

  test('PR feedback beats the bare PR row, because it is the more specific one', () => {
    // Order is priority and this pair is why: "review comments on the PR" contains "PR", and a
    // table that answered `/ml-specs:pr` would send someone to write a description for a PR that
    // is already open and already has comments waiting.
    const r = route('address the review comments on the pull request');
    assert.equal(r.command, '/ml-specs:pr-address');
    assert.equal(ROUTES.findIndex((x) => x.id === 'pr-feedback') < ROUTES.findIndex((x) => x.id === 'open-pr'),
      true, 'the specific row sits below the general one');
  });

  test('a sentence matching two rows names the runner-up, so the answer is arguable', () => {
    const r = route('investigate why the import crashes on large files');
    assert.equal(r.matched, true);
    assert.ok(r.runnerUp, 'two rows matched and only one was reported');
    assert.notEqual(r.runnerUp.command, r.command);
    assert.ok(r.runnerUp.why, 'the runner-up has no reason, so there is nothing to argue with');
  });

  test('a single match reports no runner-up rather than an invented one', () => {
    assert.equal(route('explain how the gate works').runnerUp, null);
  });
});

describe('AC6 — every answer carries a reason that names its artifact', () => {
  test('every nextFor answer, at every status and verdict', () => {
    const verdicts = [null, { verdict: FRESH }, { verdict: STALE, to: 'Verified' }, { verdict: UNKNOWN }];
    for (const status of [...LIFECYCLE, 'Nonsense', null]) {
      for (const ev of verdicts) {
        const a = nextFor(spec(status), ev);
        if (a === null) continue;
        assert.ok(a.why && a.why.length > 20, `${status}/${ev?.verdict}: no usable reason`);
        // The artifact, not just a sentiment. "it is Implemented" tells a reader nothing they can
        // go and look at; "its Status cell reads Implemented" names the thing to check.
        assert.match(a.why, /Status cell|evidence record/,
          `${status}/${ev?.verdict}: the reason names no artifact — "${a.why}"`);
      }
    }
  });

  test('every route row and the default carry one too', () => {
    for (const r of [...ROUTES, DEFAULT_ROUTE]) {
      assert.ok(r.why && r.why.length > 20, `${r.id ?? 'default'} has no usable reason`);
    }
  });

  test('the reason is not the command restated', () => {
    // The degenerate pass: a `why` of "run /ml-specs:spec-build" satisfies "carries a reason" and
    // explains nothing.
    for (const r of [...ROUTES, DEFAULT_ROUTE]) {
      assert.doesNotMatch(r.why, /\/ml-specs:/, `${r.id ?? 'default'} restates a command as its reason`);
    }
    for (const row of Object.values(BY_STATUS).filter(Boolean)) {
      assert.doesNotMatch(row.why, /\/ml-specs:/);
    }
  });
});

describe('the tables themselves', () => {
  test('route ids are unique', () => {
    const ids = ROUTES.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, 'two rows share an id');
  });

  test('every row has a real regex and a command', () => {
    for (const r of ROUTES) {
      assert.ok(r.when instanceof RegExp, `${r.id} has no pattern`);
      assert.match(r.command, /^\/ml-specs:[\w-]+$/, `${r.id}'s command is not a slash command`);
    }
  });

  test('namedCommands covers BOTH tables, not just the route one', () => {
    // A check that walked half the surface would read as complete. `next-wiring.test.mjs` uses
    // this list to prove every named command exists, so a gap here silently narrows that.
    const named = namedCommands();
    for (const c of ROUTES.map((r) => r.command)) assert.ok(named.includes(c), `${c} missing`);
    for (const c of Object.values(BY_STATUS).filter(Boolean).map((r) => r.command)) {
      assert.ok(named.includes(c), `${c} missing — a nextFor suggestion is unchecked`);
    }
    assert.ok(named.includes('/ml-specs:repo-doctor'), 'the off-lifecycle suggestion is unchecked');
    assert.ok(named.includes('/ml-specs:spec-advance'), 'the failing-record suggestion is unchecked');
    assert.ok(named.includes(DEFAULT_ROUTE.command));
    assert.equal(new Set(named).size, named.length, 'namedCommands returns duplicates');
  });
});
