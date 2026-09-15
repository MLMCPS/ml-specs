// Wiring of /spec-explore and the analyst agent — spec 0007.
//
// WHAT THIS FILE ASSERTS, AND WHAT IT DELIBERATELY DOES NOT
//
// Structural facts only: a file exists, its frontmatter carries a key, a literal token is
// present, a diagram line is what it claims, the typo-guard alternation is live for a new name.
// Every assertion here IS the fact, with no interpretation in between — it catches deletion,
// reversion and drift.
//
// It makes NO claim to catch semantic inversion of the prompt prose. The governing header at
// `repo-skills-wiring.test.mjs:10-24` records four adversarial passes that tried to hold
// directional properties ("delegates to scanner") with regexes over English, each finding prose
// that kept every asserted keyword while reversing the instruction — and a fourth pass that
// produced eight false positives. Spec 0007 follows that ruling: AC9a and AC9b (the matching
// rule and the consumption clause of /spec's step 0) are REVIEW obligations recorded in the
// spec's §5, not assertions here. AC9's test below is deliberately structure-only.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)));  // ml-specs/
const ROOT = dirname(PLUGIN);                                     // repo root
const VALIDATOR = join(ROOT, 'scripts', 'validate-plugin.mjs');

const readPlugin = (rel) => readFileSync(join(PLUGIN, rel), 'utf8');
const readRoot = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * `CLAUDE.md` and `docs/` are a GENERATED knowledge layer. They are committed in THIS repo, but the
 * plugin ships into repos where they are not, and the npm package excludes them — so read them
 * defensively: absent means "not applicable here", not "the assertion failed".
 */
const readGenerated = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null);

const command = readPlugin('commands/spec-explore.md');
const agent = readPlugin('agents/analyst.md');
const specCommand = readPlugin('commands/spec.md');

/** Frontmatter keys of a prompt file, as a flat object. */
function frontmatter(text, label) {
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(fm, `${label} has no frontmatter block`);
  return Object.fromEntries(
    fm[1].split('\n').map((l) => l.match(/^([a-z-]+):\s*(.*)$/i)).filter(Boolean).map((m) => [m[1], m[2].trim()]),
  );
}

describe('spec-explore and analyst are well-formed', () => {
  test('the command carries the frontmatter and body conventions the house style requires', () => {
    // AC1. CONTRIBUTING.md:63-67 — frontmatter, the phase and the prohibition up front, the
    // literal $ARGUMENTS token, and stack detection before anything else. Presence, not meaning.
    const fields = frontmatter(command, 'spec-explore.md');
    assert.ok(fields.description && fields.description.length > 0, 'description is empty');
    assert.ok(fields['argument-hint'] && fields['argument-hint'].length > 0, 'argument-hint is empty');

    // "Opens by naming the phase and what the command must NOT do" — scoped to the opening block,
    // so moving either into a footnote fails.
    const body = command.slice(command.indexOf('\n---', 4) + 4);
    const opening = body.trim().split(/\n\s*\n/).slice(0, 2).join('\n');
    assert.match(opening, /\bANALYZE\b/, 'the command must open by naming the ANALYZE phase');
    assert.match(opening, /do NOT|does NOT|must not|never/i,
      'the command must state up front what it does not do');

    assert.match(command, /\$ARGUMENTS/, 'the user\'s input is passed as the literal $ARGUMENTS token');
    assert.match(command, /[Dd]etect the stack/, 'the command must detect the stack before analysing');
    assert.match(command, /`CLAUDE\.md`/);
    assert.match(command, /`docs\/PATTERNS\.md`/);
  });

  test('analyst is declared read-only, with a router-trigger description', () => {
    // AC4. Least privilege is a stated rule, not an observation (CONTRIBUTING.md:102-103): this
    // agent compares designs, it must never be able to commit to one by writing it.
    const fields = frontmatter(agent, 'analyst.md');
    assert.equal(fields.name, 'analyst');
    assert.equal(fields.model, 'inherit');
    assert.equal(fields.tools, 'Read, Grep, Glob, Bash');
    assert.doesNotMatch(fields.tools, /\bWrite\b/);
    assert.doesNotMatch(fields.tools, /\bEdit\b/);
    assert.doesNotMatch(fields.tools, /\bWebFetch\b/);

    // Router-trigger phrasing (CONTRIBUTING.md:95, docs/PATTERNS.md:46-48): the SDD phase, a
    // "Use to/for …" clause, and an explicit negative boundary.
    const d = fields.description;
    assert.ok(d && d.length > 0, 'description is empty');
    assert.match(d, /\bANALYZE\b/, 'the description must name the SDD phase the router matches on');
    assert.match(d, /\bUse (to|for)\b/, 'the description must carry a "Use to/for …" clause');
    assert.match(d, /does NOT write the analysis note/i, 'the negative boundary must say it does not write the note');
    assert.match(d, /does NOT ask the human/i, 'the negative boundary must say it does not ask the human');
  });
});

describe('spec-explore wiring', () => {
  test('the command names the next command in the loop', () => {
    // AC3. docs/PATTERNS.md:67 — a command ends by naming the next one, so the workflow is
    // self-describing.
    //
    // Scoped to the literal NEXT-COMMAND form, not a bare mention: `/ml-specs:spec` also appears
    // incidentally in this file's prose (spec-explore.md:10, :13, :32, :37), so a whole-file match
    // for the bare token passed even with the closing step deleted — verified by mutation. The
    // bolded-with-argument form appears only where the command hands off.
    assert.match(command, /\*\*`\/ml-specs:spec <ticket>`\*\*/,
      'the command must NAME /ml-specs:spec as the next command, not merely mention it');
  });

  test('the agent states all five output-contract items', () => {
    // AC5. Presence of each item, plus the literal sentence that keeps the questions with
    // /ml-specs:spec rather than with this agent. Deletion-detecting, not meaning-checking.
    for (const item of [
      /\*\*What exists\*\*/,
      /\*\*What it touches\*\*/,
      /\*\*Approaches\*\*/,
      /\*\*Blocking contract questions\*\*/,
      /\*\*What you could not determine\*\*/,
    ]) {
      assert.match(agent, item, `the output contract omits ${item}`);
    }
    assert.match(agent, /\*\*You do not ask them\.\*\*/,
      'the agent reports blocking questions; /ml-specs:spec step 3 asks them');
    assert.match(agent, /`\/ml-specs:spec`\s+step 3/,
      'the agent must name who does ask them');
  });

  test('the command contains no ${CLAUDE_PLUGIN_ROOT}', () => {
    // AC6. It references no template, so it must not carry the token — the usage counts at
    // docs/ARCHITECTURE.md:34 and docs/architecture/prompt-surface.md:60 ("10 commands … 13
    // files") are asserted against the commands that actually contain it, by
    // repo-skills-wiring.test.mjs:237-259. spec-review.md is the precedent: zero occurrences.
    assert.ok(!command.includes('CLAUDE_PLUGIN_ROOT'),
      'spec-explore.md references no template; adding the token invalidates the documented counts');
  });

  test('the command prescribes the note\'s header table and its five headings', () => {
    // AC7. All THREE header rows: Title is the primary matching path for a repo whose specs all
    // read "— (no tracker)", so a note written without one is unmatchable by /ml-specs:spec.
    for (const row of ['**Ticket**', '**Title**', '**Date**']) {
      assert.ok(command.includes(row), `the header table omits the ${row} row`);
    }
    for (const heading of ['## 1. What exists', '## 2. What it touches', '## 3. Approaches',
      '## 4. Blocking questions', '## 5. Not determined']) {
      assert.ok(command.includes(heading), `the section contract omits "${heading}"`);
    }
    assert.match(command, /specs\/explore-<slug>\.md/, 'the command must name the artefact path');
  });

  test('the command confirms before replacing an existing note', () => {
    // AC8. docs/PATTERNS.md:100 — never silently overwrite a user's file.
    assert.match(command, /Never silently overwrite/i);
    assert.match(command, /already exists/i);
    assert.match(command, /\bask\b/i);
  });
});

describe('/ml-specs:spec looks for an analysis first', () => {
  test('spec.md carries a step before step 1 that globs specs/explore-*.md', () => {
    // AC9 — STRUCTURE ONLY, by the ruling at repo-skills-wiring.test.mjs:19-24. That the step
    // exists, that it sits before the current step 1, and that the glob is present. The matching
    // rule itself (AC9a) and the consumption clause (AC9b) are review obligations in spec 0007
    // §5: they are directional properties of English, and this repo has already paid for trying
    // to machine-check those.
    const stepZero = specCommand.indexOf('\n0. ');
    const stepOne = specCommand.indexOf('\n1. Detect the stack');
    assert.notStrictEqual(stepZero, -1, 'spec.md has no step 0');
    assert.notStrictEqual(stepOne, -1, 'spec.md no longer has its "Detect the stack" step 1');
    assert.ok(stepZero < stepOne, 'the new step must come BEFORE the current step 1');

    const step = specCommand.slice(stepZero, stepOne);
    assert.ok(step.includes('specs/explore-*.md'),
      'step 0 must glob specs/explore-*.md — matching is on the header table, not the filename');
  });
});

describe('the repo validator knows the new agent', () => {
  test('the typo guard fires for analyst (fixture)', () => {
    // AC11. Proves the alternation at scripts/validate-plugin.mjs:254 is LIVE for the new name,
    // not merely that the string is present in the source. The guard matches a hardcoded
    // alternation of CORRECTLY SPELLED names and fires when the file is missing — a misspelling
    // is invisible to it by construction, so asserting one would be asserting output that can
    // never appear.
    //
    // Same fixture contract as plugin-wiring.test.mjs:180-225: the validator pins ROOT to its own
    // location, so pointing it at another tree means copying it plus its one non-stdlib import.
    // Deliberately NO manifests — supplying them half-built hard-errors before control reaches
    // the guard, so sections 1-5 push errors, the guard still runs, and the process exits 1.
    const dir = mkdtempSync(join(tmpdir(), 'sdd-explore-'));
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      mkdirSync(join(dir, 'ml-specs', 'agents'), { recursive: true });
      mkdirSync(join(dir, 'ml-specs', 'commands'), { recursive: true });
      copyFileSync(VALIDATOR, join(dir, 'scripts', 'validate-plugin.mjs'));
      mkdirSync(join(dir, 'ml-specs', 'scripts', 'lib'), { recursive: true });
      copyFileSync(join(ROOT, 'ml-specs', 'scripts', 'lib', 'file-identity.mjs'),
        join(dir, 'ml-specs', 'scripts', 'lib', 'file-identity.mjs'));
      // The agent is referenced, correctly spelled, and ml-specs/agents/analyst.md is absent.
      writeFileSync(
        join(dir, 'ml-specs', 'commands', 'spec-explore.md'),
        '---\ndescription: fixture\nargument-hint: <ticket>\n---\n\nUse the **analyst** agent.\n',
      );

      let stdout = '';
      let code = 0;
      try {
        stdout = execFileSync('node', [join(dir, 'scripts', 'validate-plugin.mjs')],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        code = e.status ?? 1;
        stdout = e.stdout ?? '';
      }

      assert.equal(code, 1, 'fixture without manifests should exit 1');
      assert.match(
        stdout,
        /references "analyst", which is neither an agent nor a command/,
        `typo guard did not fire; stdout was:\n${stdout}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the loop is five phases everywhere', () => {
  // AC16. Sixteen statements of the loop ship, and nothing else asserts them: two diagrams, two
  // narrative walkthroughs, two agent tables and ten command chains. A diagram that says five
  // phases beside prose that says four is worse than either alone.
  const PAIRS = [['specs', 'specs'], ['ml-specs/templates/specs', 'the shipped template']];

  test('both loop diagrams begin with 0. ANALYZE', () => {
    for (const [dir, label] of PAIRS) {
      assert.match(readRoot(`${dir}/README.md`), /^\s*0\. ANALYZE\s+→\s+1\. SPECIFY\b/m,
        `${label}/README.md's diagram does not begin with 0. ANALYZE`);
    }
  });

  test('both narrative walkthroughs gain a 0. Analyze section', () => {
    for (const [dir, label] of PAIRS) {
      const text = readRoot(`${dir}/README.md`);
      assert.match(text, /^0\. \*\*Analyze\*\*/m, `${label}/README.md has no "0. **Analyze**" section`);
      // The diagram and the prose must not contradict each other: the section precedes Specify.
      assert.ok(text.indexOf('0. **Analyze**') < text.indexOf('1. **Specify**'),
        `${label}/README.md puts Analyze after Specify`);
      assert.match(text, /\/ml-specs:spec-explore/, `${label}/README.md never names the command`);
    }
  });

  test('both AGENTS.md copies carry the analyst row', () => {
    for (const [dir, label] of PAIRS) {
      assert.match(readRoot(`${dir}/AGENTS.md`), /^\| `analyst` \| ANALYZE \| `\/ml-specs:spec-explore` \|/m,
        `${label}/AGENTS.md has no analyst row mapped to ANALYZE`);
    }
  });

  test('all ten command chains name the optional ANALYZE step at their head', () => {
    // The literal word `optional` is load-bearing: a chain otherwise lists REQUIRED commands, so
    // without it, adding /ml-specs:spec-explore to ten of them teaches an optional step as
    // mandatory.
    const HEAD = /`?\/ml-specs:spec-explore`?\s+\(optional\)\s*→/;
    const chains = [
      ['CLAUDE.md', 1],                                  // generated, skipped when absent
      ['ml-specs/templates/CLAUDE.fragment.md', 1],
      ['ml-specs/README.md', 2],                         // the roster head and the closing chain
      ['CONTRIBUTING.md', 1],
      ['TEAM-SETUP.md', 1],
      ['.github/mirror-README.md', 1],
      ['ml-specs/commands/repo-init.md', 1],
      ['examples/promo-service/CLAUDE.md', 1],
      ['ml-specs/mcp/README.md', 1],
    ];
    const skipped = [];
    let total = 0;
    for (const [rel, expected] of chains) {
      const text = rel === 'CLAUDE.md' ? readGenerated(rel) : readRoot(rel);
      if (!text) { skipped.push(rel); continue; }
      const hits = [...text.matchAll(new RegExp(HEAD.source, 'g'))].length;
      assert.equal(hits, expected,
        `${rel}: expected ${expected} chain head(s) reading "/ml-specs:spec-explore (optional) →", found ${hits}`);
      total += hits;
    }
    // Ten chains when the generated knowledge layer is present, nine on a clean clone.
    assert.equal(total, skipped.length ? 9 : 10, `chain count is ${total}; skipped: ${skipped.join(', ')}`);
  });

  test('repo-init also enumerates the new agent', () => {
    // The command that writes every adopting repo's CLAUDE.md fragment names the agents by hand.
    assert.match(readPlugin('commands/repo-init.md'), /The agents \(`analyst`,/,
      'repo-init.md enumerates the agents; a ninth one it does not name ships invisible');
  });
});

describe('the README documents the faster path', () => {
  // AC21. Brought into scope at /ml-specs:spec-verify (spec 0007 §4.5 group G, site 43): the
  // section was written before this build and shipped in the same tree, so it is specced rather
  // than reverted. It reaches npm and the public mirror, so it is a product surface.
  const readme = readFileSync(join(PLUGIN, 'README.md'), 'utf8');

  test('the section exists, between its two neighbours', () => {
    const here = readme.indexOf('\n## Going faster on an existing app\n');
    const before = readme.indexOf('\n## First-time setup in a new service\n');
    const after = readme.indexOf('\n## Opting out of architecture standards\n');
    assert.ok(here !== -1, 'the "Going faster on an existing app" section is missing');
    assert.ok(before !== -1 && after !== -1, 'a neighbouring section is missing — check the anchors');
    assert.ok(before < here && here < after,
      'the section must sit after "First-time setup" and before "Opting out of architecture standards"');
  });

  test('it names the commands it is about', () => {
    // Asserted per command, so dropping any one of them fails with the name that went missing —
    // a single all-or-nothing regex would say only "the section changed".
    const section = readme.slice(
      readme.indexOf('\n## Going faster on an existing app\n'),
      readme.indexOf('\n## Opting out of architecture standards\n'),
    );
    for (const cmd of ['/ml-specs:repo-init', '/ml-specs:code', '/ml-specs:fix',
                       '/ml-specs:spec-review', '/ml-specs:spec-fanout',
                       '/ml-specs:repo-impact', '/ml-specs:repo-rollout']) {
      assert.ok(section.includes(cmd), `the section no longer names ${cmd}`);
    }
  });
});
