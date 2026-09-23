// Spec 0022 — the six loop commands close by offering their next steps as options.
//
// WHAT THIS FILE ASSERTS, AND WHAT IT DELIBERATELY DOES NOT
//
// Structural facts about prompt files, in the `*-wiring.test.mjs` genre (docs/PATTERNS.md): a
// literal is present, two things co-occur inside one block, a sweep finds nothing where nothing
// should be. Every assertion IS the fact, with no interpretation in between — it catches deletion,
// reversion and drift, and nothing else.
//
// NON-VACUITY IS THE WHOLE DESIGN HERE. `AskUserQuestion` already appeared in `spec.md`,
// `spec-build.md` and `spec-verify.md` before this spec, for a blocking mid-run decision (spec 0022
// §3). A file-global match for that literal therefore passes on three of the six with the closing
// block deleted — which is why AC2 scopes every assertion to the BLOCK, bounded by two shared
// literals, and separately requires the prose next-step line to survive alongside it.
//
// AC4 ("no option offers something the command has already decided against, and none asks consent")
// and AC6 ("a run that stops on a blocking decision does not then also present a menu") have NO
// TEST and are recorded in spec 0022 §5 as review obligations. Both are claims about what a model
// does at runtime given this prose, and a regex over a prompt cannot reach them — the same boundary
// `saf-borrowings-wiring.test.mjs:7-9` records for spec 0018.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** The six loop commands, and the only files this convention applies to (spec 0022 §2). */
const LOOP = ['spec', 'spec-build', 'spec-verify', 'spec-advance', 'pr', 'pr-address'];
const cmd = (name) => read(`ml-specs/commands/${name}.md`);

// The block's two ends. Both are shared verbatim by all six files so a seventh command can be
// written by copying one, and so this test has an exact unit to assert on rather than "somewhere
// near the bottom of the file".
const BLOCK_START = '**Then offer those steps as actions.**';
const BLOCK_END = 'all a non-interactive run emits.';

/** A concrete next command, in the backticked form the loop's prose already uses. */
const NEXT_COMMAND = /`\/(?:ml-specs:[a-z][a-z0-9-]*|code-review)[^`]*`/;

function closingBlock(name) {
  const body = cmd(name);
  const i = body.indexOf(BLOCK_START);
  assert.notEqual(i, -1, `${name}.md has no closing-options block — "${BLOCK_START}" is missing`);
  const j = body.indexOf(BLOCK_END, i);
  assert.notEqual(j, -1, `${name}.md's closing block does not end with the shared rules paragraph`);
  return { body, block: body.slice(i, j + BLOCK_END.length), start: i };
}

test('AC1: each of the six loop commands names the AskUserQuestion tool', () => {
  for (const name of LOOP) {
    assert.ok(cmd(name).includes('AskUserQuestion'), `${name}.md never names AskUserQuestion`);
  }
});

test('AC2: the closing block both names next commands AND offers them as options', () => {
  for (const name of LOOP) {
    const { block } = closingBlock(name);
    // The co-occurrence AC2 exists for. Either half alone is satisfied by the file as it stood
    // before spec 0022: the prose line already named the next command, and three of the six
    // already mentioned AskUserQuestion for a mid-run decision.
    assert.ok(block.includes('AskUserQuestion'),
      `${name}.md's closing block does not instruct that the steps be OFFERED as options`);
    assert.match(block, NEXT_COMMAND,
      `${name}.md's closing block names no concrete next command in the backticked form`);
    // §4.1's table wants 2-4 options, each a concrete command. Counted across the whole block
    // here; the per-BRANCH count is asserted separately below, because a block-level total of 2
    // is also what two one-option branches look like.
    const options = [...block.matchAll(new RegExp(NEXT_COMMAND.source, 'g'))];
    assert.ok(options.length >= 2,
      `${name}.md's closing block offers ${options.length} command(s); §4.1 wants 2-4`);
  }
});

test('AC2: every per-status branch offers 2-4 commands, not one', () => {
  // The defect the adversarial review caught. `spec-advance.md` branches on the status it just
  // wrote, and two of those rows named a single command each — which the HOST cannot render:
  // AskUserQuestion's schema is `options: { minItems: 2, maxItems: 4 }`. A block-level total of 2
  // passes the check above while every individual menu is unbuildable, so the count has to be
  // per branch.
  //
  // `after Archived` is the deliberate exception and is asserted as one: the loop is over and the
  // file says "do not ask". Not calling the tool is always allowed; calling it with one option is
  // not.
  const { block } = closingBlock('spec-advance');
  const rows = block.split(/\n(?=- after )/).filter((r) => r.startsWith('- after '));
  assert.ok(rows.length >= 3, `expected a row per status, found ${rows.length}`);

  for (const row of rows) {
    const status = row.match(/^- after `?(\w+)`?/)[1];
    const n = [...row.matchAll(new RegExp(NEXT_COMMAND.source, 'g'))].length;
    if (/do not ask/i.test(row)) {
      assert.equal(n, 0, `the ${status} row says "do not ask" but still names ${n} command(s)`);
      continue;
    }
    assert.ok(n >= 2 && n <= 4,
      `the ${status} row offers ${n} command(s); the host renders 2-4, and \u00a74.1 rule 2 forbids padding`);
  }
});

test('AC2: the prose next-step line survives, immediately above the block', () => {
  // §4.1's contract: the block is ADDITIVE. The prose line is the only record that survives into
  // the transcript, the whole output of a non-interactive run, and the fallback when the channel
  // rule says not to ask.
  //
  // Scoped to the paragraph IMMEDIATELY above the block — not the whole file, and not a window of
  // lines. Both looser forms were tried and both passed with the prose line deleted: these files
  // name `/ml-specs:…` commands throughout their bodies (`spec-build.md`'s carve-out sentence about
  // `/ml-specs:pr-address` sits nine lines above its close), so anything wider than the adjacent
  // paragraph is satisfied by prose that has nothing to do with the close. Verified by mutation.
  for (const name of LOOP) {
    const { body, start } = closingBlock(name);
    const above = body.slice(0, start).trimEnd().split('\n');
    const gap = above.length - 1 - [...above].reverse().findIndex((l) => l.trim() === '');
    const before = above.slice(gap).join('\n');
    // BOTH halves, because either alone is vacuous here — also verified by mutation. These bodies
    // name commands in passing all the way down (pr.md's hard-rules list cites
    // `/ml-specs:pr-address` in the paragraph directly above its close), so the backticked form
    // alone survives deleting the real line; and "next step" alone would pass on a line that names
    // no command at all.
    assert.match(before, /next step/i,
      `${name}.md has options but the paragraph above them is not the next-step line — the block `
      + 'replaced the line instead of being added to it');
    assert.match(before, NEXT_COMMAND,
      `${name}.md's next-step line no longer names a command in the backticked form`);
  }
});

test('AC3: the block puts the recommended option first, and marks it', () => {
  for (const name of LOOP) {
    const { block } = closingBlock(name);
    // Ordering IS the recommendation (§4.1 rule 4), so both halves are asserted: that it goes
    // first, and that it is labelled. A menu where every option looks equal has handed the human
    // back the judgement the command was supposed to make.
    assert.match(block.replace(/\s+/g, ' '), /recommend \*\*first\*\*/i,
      `${name}.md's closing block does not say the recommended option goes FIRST`);
    // Anchored to an option BULLET, not to the block. `block.includes('(Recommended)')` was
    // satisfied by the shared boilerplate itself — every block contains the sentence "its label
    // suffixed `(Recommended)`" — so it passed with every marker stripped from every real option.
    // Third vacuity of this genre found in this file; the other two were caught during the build.
    assert.match(block, /^- .*\*\*\(Recommended\)\*\*/m,
      `${name}.md's closing block has no option bullet marked **(Recommended)**`);
  }
});

test('AC5: the block states the channel rule — only a command asks', () => {
  for (const name of LOOP) {
    // Whitespace-collapsed: this is wrapped prose, and a sentence that survives re-wrapping at a
    // different column is the only kind worth asserting on (`saf-borrowings-wiring.test.mjs:90`).
    const block = closingBlock(name).block.replace(/\s+/g, ' ');
    assert.match(block, /only a command asks, never an agent/i,
      `${name}.md's closing block does not state that only a command asks`);
    assert.match(block, /no channel to the human/i,
      `${name}.md's closing block does not say why: an agent has no channel to the human`);
  }
});

test('AC5: no agent gains a closing-options block', () => {
  // The negative half, swept over every agent on disk rather than a hard-coded list, so a new
  // agent is covered the day it lands. `AskUserQuestion` itself is NOT forbidden here —
  // `agents/spec-author.md` uses it for a mid-run decision and predates this spec — so the sweep
  // is for the closing block specifically.
  const dir = join(ROOT, 'ml-specs/agents');
  const agents = readdirSync(dir).filter((f) => f.endsWith('.md'));
  assert.ok(agents.length >= 10, `only found ${agents.length} agents; the sweep is not reaching them`);
  for (const f of agents) {
    const body = readFileSync(join(dir, f), 'utf8');
    assert.ok(!body.includes(BLOCK_START),
      `ml-specs/agents/${f} carries a closing-options block; an agent has no channel to the human`);
    assert.doesNotMatch(body, /only a command asks, never an agent/i,
      `ml-specs/agents/${f} has copied the closing convention's rules paragraph`);
  }
});

test('AC8: the 23 non-loop commands keep their prose ending', () => {
  // Spec 0022 §2's non-goal, asserted in the one direction a regex can hold. The other half of
  // AC8 — `explain-wiring.test.mjs` and `spec-explore-wiring.test.mjs` passing untouched — is
  // evidence no new test can produce.
  const dir = join(ROOT, 'ml-specs/commands');
  const others = readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !LOOP.includes(f.replace(/\.md$/, '')));
  // The count is a guard on the list, not the point: without it, a filter that silently matched
  // nothing would make the loop below vacuous. 23 since spec 0031 added `next`, which is a report
  // command and correctly ends in prose — as `repo-hosts` did before it.
  assert.equal(others.length, 23, `expected 23 non-loop commands, found ${others.length}`);
  for (const f of others) {
    assert.ok(!readFileSync(join(dir, f), 'utf8').includes(BLOCK_START),
      `ml-specs/commands/${f} gained a closing-options block; spec 0022 scopes this to the six`);
  }
});

test('AC9: all three docs describe the convention, including the options half', () => {
  // All three or none, in ONE test on purpose: two of the three agreeing is the exact state AC9
  // exists to prevent, and three separate tests would report it as "one failure" rather than as
  // the disagreement it is. `docs/PATTERNS.md` cites `CONTRIBUTING.md` as its own rationale, so a
  // reader who follows that pointer must not land on the older rule.
  for (const rel of ['CLAUDE.md', 'docs/PATTERNS.md', 'CONTRIBUTING.md']) {
    const flat = read(rel).replace(/\s+/g, ' ');
    assert.ok(flat.includes('AskUserQuestion'),
      `${rel} describes the closing convention without the options half`);
    assert.match(flat, /recommend\w*[^.]{0,80}\bfirst\b/i,
      `${rel} does not say the recommended option goes first`);
    assert.match(flat, /only a command (ever )?asks/i,
      `${rel} does not carry the channel rule — that only a command asks, never an agent`);
  }
});
