// Spec 0018's borrowings, asserted where they actually live — in prompt files.
//
// B5: rigor is a spec header row, persisted, obeyed, never re-inferred.
// B6: `docs/GLOSSARY.md` and `docs/CONTEXT.md` are optional documents, seeded on evidence and
//     refreshed rather than regenerated.
//
// These are content assertions against Markdown, which is the only executable check a prompt file
// admits. They catch a deletion and a rename; they cannot catch a model ignoring what it reads.
// The `(review obligation)` criteria in §5 are the half that stays human on purpose.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rigorOf } from './lib/specs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// AC8, AC9 and AC10 are unit tests of `rigorOf()` and `listSpecs()`, and §6 puts them in
// `lib/specs.test.mjs` beside the rest of the parser. What stays here is the half that can only be
// asserted against prompt files.

test('AC11: both byte-identical templates carry the row, and its example is safe', () => {
  for (const p of ['specs/TEMPLATE.md', 'ml-specs/templates/specs/TEMPLATE.md']) {
    const t = read(p);
    assert.match(t, /^\| \*\*Rigor\*\* \|/m, `${p} has no Rigor row`);
    // §4.2's trap: `field()` matches the first line whose label is `Rigor` and cannot tell a
    // fenced example from a real header row. The template's own value must therefore be a real
    // one, not the `light | standard | deep` menu — which would parse, harmlessly, as standard.
    assert.equal(rigorOf((t.match(/^\| \*\*Rigor\*\* \| (.*?) \|/m) ?? [])[1]), 'standard');
  }
});

test('AC12: the agents obey the row and are told not to re-infer it', () => {
  const dev = read('ml-specs/agents/developer.md');
  const rev = read('ml-specs/agents/reviewer.md');
  for (const [name, text] of [['developer', dev], ['reviewer', rev]]) {
    assert.match(text, /`?Rigor`? row/i, `${name}.md never mentions the Rigor row`);
    assert.match(text, /\bdeep\b/, `${name}.md does not say what deep owes`);
  }
  // The point of the borrow: SAF found re-inferring depth per invocation makes rigor drift
  // between phases of the same feature. Both ends must be told, or it drifts between them.
  assert.match(dev, /do not re-infer/i);
  assert.match(rev, /do not re-derive/i);
});

test('AC12b: rigor scales ceremony and never lowers the seam floor', () => {
  // The precedence rule §4.2 settles. Without it, `light` reads as a licence to skip a test the
  // seam analysis requires — which is rigor lowering the floor rather than scaling the ceiling.
  const dev = read('ml-specs/agents/developer.md');
  assert.match(dev, /never lowers the floor/i);
  assert.match(dev, /does \*\*not\*\* license skipping|does not license skipping/i);
  assert.match(read('ml-specs/agents/reviewer.md'), /never excuses a test the seam/i);
});

test('AC12b: a wrong-looking rigor is a finding about the SPEC', () => {
  // Otherwise the reviewer silently accepts whatever depth the row claims, and the row becomes a
  // way to lower the bar rather than a declaration anybody can challenge.
  assert.match(read('ml-specs/agents/reviewer.md'), /finding about the spec/i);
});

// ── B6 ──────────────────────────────────────────────────────────────────────────────────────

const B6_DOCS = ['GLOSSARY', 'CONTEXT'];

test('AC13: both templates exist, and neither is an empty file', () => {
  for (const name of B6_DOCS) {
    const body = read(`ml-specs/templates/docs/${name}.template.md`);
    // A template shipped empty is the failure mode §7.1 names for the documents themselves: a file
    // a reader opens, learns nothing from, and stops opening.
    assert.ok(body.split('\n').length > 10, `${name}.template.md is too thin to be worth seeding`);
    assert.match(body, /optional/i, `${name}.template.md does not say it is optional`);
  }
});

test('AC14: all three repo commands name both documents', () => {
  for (const cmd of ['repo-init', 'repo-refresh', 'repo-doctor']) {
    const body = read(`ml-specs/commands/${cmd}.md`);
    for (const name of B6_DOCS) {
      assert.match(body, new RegExp(name), `${cmd}.md never mentions ${name}`);
    }
  }
});

test('AC14c: repo-refresh forbids copying between CLAUDE.md and CONTEXT.md', () => {
  // The single mitigation §7 rests on for "CONTEXT.md drifts into a second CLAUDE.md". No
  // criterion covered it before revision 5, and a mitigation nothing asserts is a sentence.
  // Whitespace-collapsed: this is wrapped prose, and a sentence that survives re-wrapping at a
  // different column is the only kind worth asserting on.
  const body = read('ml-specs/commands/repo-refresh.md').replace(/\s+/g, ' ');
  assert.match(body, /never copy content between `CONTEXT\.md` and `CLAUDE\.md`/i);
  assert.match(body, /never overwrite the human prose/i);
});

test('AC15: repo-doctor treats absence as optional, not as a gap', () => {
  const body = read('ml-specs/commands/repo-doctor.md');
  const para = body.split('\n\n').find((p) => p.includes('GLOSSARY'));
  assert.ok(para, 'repo-doctor.md has no paragraph about the optional documents');
  assert.match(para, /optional/i);
  // `not in use` is the exact idiom the file already uses for `docs/SKILLS.md`, and asserting the
  // shared phrase is what keeps the two optional documents reported the same way.
  assert.match(para, /not in use/);
  const skills = body.split('\n\n').find((p) => /`docs\/SKILLS\.md` is \*\*optional\*\*/.test(p));
  assert.ok(skills, 'the SKILLS.md optional paragraph this idiom comes from is gone');
  assert.match(skills, /not in use/);
  // No assertion that the paragraph avoids the words "missing" or "gap": it earns them by
  // forbidding the behaviour ("rather than reporting a gap"), and a negative match on prose cannot
  // tell a prohibition from the thing prohibited. AC15 is a review obligation for that reason.
});

test('AC19: both ladders name the documents as inline code, never as a link', () => {
  for (const p of ['CLAUDE.md', 'ml-specs/templates/CLAUDE.fragment.md']) {
    const body = read(p);
    for (const name of B6_DOCS) {
      assert.match(body, new RegExp(`\`docs/${name}\\.md\``), `${p} does not name docs/${name}.md`);
      // `.github/scripts/knowledge-check.mjs` errors on a CLAUDE.md link whose target is absent,
      // and neither document exists in this repo. A link here would redden knowledge-layer.yml.
      assert.doesNotMatch(body, new RegExp(`\\]\\([^)]*${name}\\.md`), `${p} links to ${name}.md`);
    }
  }
});

test('AC19: the ladder is still numbered consecutively after the insertion', () => {
  // Two entries were spliced into the middle of a numbered list. Markdown renumbers silently, so a
  // duplicated ordinal reads correctly and tells the next editor the wrong thing about the tiers.
  const body = read('ml-specs/templates/CLAUDE.fragment.md');
  const from = body.indexOf('load the **least**');
  // Bounded at the next heading. The fragment carries more numbered lists further down, and an
  // unbounded slice collects their ordinals too — which fails for a reason that is not the ladder.
  const end = body.indexOf('\n## ', from);
  const ladder = body.slice(from, end === -1 ? undefined : end);
  const ns = [...ladder.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]));
  assert.ok(ns.length >= 6, `only found ${ns.length} ladder entries`);
  assert.deepEqual(ns, ns.map((_, i) => ns[0] + i), `ladder ordinals are ${ns.join(',')}`);
});

// ── B1 ──────────────────────────────────────────────────────────────────────────────────────

test('AC1: spec-build resumes from a handoff note, within the hook\'s window', () => {
  const body = read('ml-specs/commands/spec-build.md');
  assert.match(body, /handoff/);
  assert.match(body.replace(/\s+/g, ' '), /supporting context/i);
  // The window is the half prose alone does not close: a note the SessionStart hook has already
  // stopped surfacing must not become live context here, or "stale note authorises skipping work"
  // is reachable through a command that never says anything false.
  assert.match(body, /7-day window/);
  assert.match(body, /ML_HANDOFF_MAX_AGE_DAYS/);
});

test('AC1b: the note is read BEFORE the spec, and never outranks it', () => {
  const body = read('ml-specs/commands/spec-build.md');
  // Step 0, not a step 1a: the ordering is the feature. A note read after the spec is a note that
  // can only argue with a contract already loaded.
  assert.match(body, /^0\. \*\*Resume/m, 'the resume step is not step 0');
  assert.ok(body.indexOf('handoff/') < body.indexOf('**Read the spec in full**'),
    'the resume step does not come before the read-the-spec step');
  assert.match(body.replace(/\s+/g, ' '), /never authorises skipping work/i);
});

test('AC2: spec-build never writes, updates or deletes a note', () => {
  // A pinned-literal check, deliberately. "Does not instruct any agent to write a note" is a
  // negative existence claim over prose that no regex holds; AC2b carries the real obligation and
  // stays human. This catches the three spellings the failure would most likely take.
  const body = read('ml-specs/commands/spec-build.md').toLowerCase();
  for (const phrase of ['write the note', 'update the note', 'delete the note']) {
    assert.ok(!body.includes(phrase), `spec-build.md contains "${phrase}"`);
  }
  // And the ownership rule is stated positively, which is what a reader acts on.
  assert.match(read('ml-specs/commands/spec-build.md').replace(/\s+/g, ' '), /Read only\./);
});

// ── B3 and B4 ───────────────────────────────────────────────────────────────────────────────

test('AC6: both ends say IMPLEMENT mutates nothing outside the working tree', () => {
  for (const rel of ['ml-specs/commands/spec-build.md', 'ml-specs/agents/developer.md']) {
    const body = read(rel);
    assert.match(body, /tracker/i, `${rel} never mentions a tracker`);
    // The surface B3 adds beyond the commit/push rule that already existed. Each is visible to
    // people outside the conversation and survives the diff being thrown away.
    const flat = body.replace(/\s+/g, ' ');
    assert.match(flat, /repository configuration/i, `${rel} does not name repository configuration`);
    assert.match(flat, /remote PR|pull request/i, `${rel} does not name remote PRs`);
    assert.match(flat, /git history/i, `${rel} does not name git history`);
  }
});

test('AC7: the developer states an authority order with the spec first and preference last', () => {
  const body = read('ml-specs/agents/developer.md');
  assert.match(body, /authority order/i);

  // The ORDER is the content, so assert the order rather than the words. A ladder that listed the
  // same five sources with preference at the top would pass a literal check and invert the rule.
  const ladder = body.slice(body.search(/authority order/i));
  const rows = [...ladder.matchAll(/^\s*\| (\d) \| \*\*(.+?)\*\*/gm)].slice(0, 5);
  assert.equal(rows.length, 5, `expected a five-rung ladder, found ${rows.length}`);
  assert.deepEqual(rows.map((r) => Number(r[1])), [1, 2, 3, 4, 5]);
  assert.match(rows[0][2], /^The spec/i, `the strongest source is "${rows[0][2]}", not the spec`);
  assert.match(rows[4][2], /preference/i, `the weakest source is "${rows[4][2]}", not preference`);
});

test('AC7b: the order does not contradict the reviewer, and names its two exceptions', () => {
  const dev = read('ml-specs/agents/developer.md').replace(/\s+/g, ' ');
  // §4.5: an earlier draft put standards above the spec, which would have made the developer and
  // the reviewer disagree about what wins inside one loop. Both halves of that reasoning are
  // load-bearing prose, so both are pinned.
  assert.match(dev, /contract defect/i, 'the standard-contradicts-spec case is not called a defect');
  assert.match(dev, /local style/i, 'the standards rule is not scoped to local style');
  // And the reviewer still ranks the spec's criteria above the repo's contracts, which is the
  // overlap AC7b turns on.
  //
  // Scoped to the ladder's own ROWS, the way AC7 above does for the developer. Comparing
  // `search()` positions across the whole file was vacuous: `acceptance criteria` appears in
  // reviewer.md's frontmatter `description:` at :3, so the comparison never reached the ladder and
  // swapping its top two rows still passed. Caught by mutation.
  const rev = read('ml-specs/agents/reviewer.md');
  const ladder = rev.slice(rev.indexOf('| | Evidence |'));
  const rungs = [...ladder.matchAll(/^\s*\|[^|]*\| (.+?) \|\s*$/gm)].map((m) => m[1].trim());
  const criteria = rungs.findIndex((r) => /acceptance criteria/i.test(r));
  const contracts = rungs.findIndex((r) => /normative contracts/i.test(r));
  assert.ok(criteria !== -1 && contracts !== -1,
    `reviewer.md's evidence ladder no longer names both rungs (${rungs.slice(0, 4).join(' / ')})`);
  assert.ok(criteria < contracts,
    "reviewer.md no longer ranks the spec's criteria above the repo's contracts");
});

// ── D1's regression sensor ──────────────────────────────────────────────────────────────────

test('AC16: the developer does not write a Status, and points at the command that does', () => {
  // The criterion §2 designates the regression sensor for D1 — the defect that motivated this
  // spec — on the stated grounds that "nothing mechanical stops it returning". Nothing did: AC16
  // was ticked and §6 named this file, but no assertion existed here, and `spec-gate.mjs` checks
  // only that a NAMED FILE exists on disk. So the transition passed with the sensor absent.
  //
  // Deliberately narrow. The file also carries "Never set `Verified` yourself" — a guard that must
  // STAY and is itself an instruction about Status — so a blanket "says nothing about Status"
  // assertion would be unsatisfiable. Pinned to the exact clause D1 removed.
  const dev = read('ml-specs/agents/developer.md');
  assert.doesNotMatch(dev, /set the spec's Status to/,
    'developer.md instructs an agent to write a Status — D1 has returned');
  assert.match(dev, /\/ml-specs:spec-advance/,
    'developer.md no longer points at the command that owns Status');
});

test('AC16b: the check the removed clause carried still runs, in the gate', () => {
  // D1's clause also said "but only if every test named in the §6 test-plan table actually exists".
  // Removing it loses no coverage *because* the gate performs exactly that at every transition —
  // which is a claim about another file, so it is asserted rather than assumed.
  //
  // Anchored to the REGISTRATION, not to the literal. `spec-gate.mjs` names `tests-exist` in three
  // comments (`:96`, `:97`, `:234`), so a whole-file match for the bare token passes with every
  // real `add('tests-exist', …)` call gutted — verified by mutation, which is how this assertion
  // was caught being vacuous before it shipped.
  const gate = read('ml-specs/scripts/spec-gate.mjs');
  const registrations = [...gate.matchAll(/add\(\s*'tests-exist'\s*,\s*'(PASS|FAIL)'/g)];
  assert.ok(registrations.length >= 2,
    `spec-gate.mjs registers ${registrations.length} tests-exist verdict(s); D1 removed a real check after all`);
  assert.ok(registrations.some(([, v]) => v === 'FAIL'),
    'spec-gate.mjs can no longer FAIL tests-exist — the check cannot refuse anything');
});

test('AC12b: the authoring surface asks for Rigor, so the reviewer is not flagging every spec', () => {
  // Found reviewing the whole branch as one diff. `developer.md` and `reviewer.md` both obey the
  // row and `reviewer.md` raises a finding when §1 carries no reason — but nothing on the AUTHORING
  // side asked for either, and `TEMPLATE.md` ships the row pre-filled with `standard`. So "fill
  // every section" never prompted a decision, every spec shipped `standard` with no reason, and the
  // reviewer was instructed to flag that on all of them. A rule that fires on every correct spec is
  // the cry-wolf failure this repo keeps re-learning.
  const spec = read('ml-specs/commands/spec.md');
  assert.match(spec, /`Rigor`/,
    'spec.md never mentions Rigor — the row has two consumers and no author');
  const flat = spec.replace(/\s+/g, ' ');
  assert.match(flat, /uncertainty and blast radius, not by diff size/i,
    'spec.md does not tell the author which axis to size Rigor on');
  assert.match(flat, /one line in §1/i,
    'spec.md does not ask for the §1 reason that reviewer.md flags the absence of');
});
