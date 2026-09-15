// Wiring of /ml-specs:explain and the explainer agent — spec 0011.
//
// WHAT THIS FILE ASSERTS, AND WHAT IT DELIBERATELY DOES NOT
//
// Structural facts only: a file exists, its frontmatter carries a key, a literal token is present,
// a roster names the new command, the typo-guard alternation is live for a new name. Every
// assertion here IS the fact, with no interpretation in between — it catches deletion, reversion
// and drift.
//
// It makes NO claim to catch semantic inversion of the prompt prose. The governing header at
// `repo-skills-wiring.test.mjs:10-24` records four adversarial passes that tried to hold
// directional properties of English with regexes, each finding prose that kept every asserted
// keyword while reversing the instruction, and a fourth that produced eight false positives.
// Spec 0011 follows that ruling: the three review-only obligations in its §4.5 (the family list at
// `docs/architecture/prompt-surface.md:42-45`, the marketplace command list at `README.md:15`, and
// the CHANGELOG entry) are recorded in the spec, not asserted here.
//
// NON-VACUITY. `command` and `agent` below are read through `readPlugin`, which is deliberately
// NOT defensive: an absent file throws and every test in this file fails. AC2 ("contains no
// ${CLAUDE_PLUGIN_ROOT}"), AC10 ("/ml-specs:spec still globs explore-*") and AC16 ("the loop is
// untouched") are all trivially true on a branch where nothing was built, so each of them is
// reached only after those two reads have already succeeded. Spec 0007 revision 11 is this repo's
// record of shipping the other kind of assertion — one that matched a token appearing incidentally
// elsewhere in the file, and stayed green with the feature deleted.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
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

// The non-vacuity precondition, executed at module load: both reads throw if the feature is absent.
const command = readPlugin('commands/explain.md');
const agent = readPlugin('agents/explainer.md');
const specCommand = readPlugin('commands/spec.md');

/** Frontmatter keys of a prompt file, as a flat object. */
function frontmatter(text, label) {
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(fm, `${label} has no frontmatter block`);
  return Object.fromEntries(
    fm[1].split('\n').map((l) => l.match(/^([a-z-]+):\s*(.*)$/i)).filter(Boolean).map((m) => [m[1], m[2].trim()]),
  );
}

describe('explain and explainer are well-formed', () => {
  test('the command carries the frontmatter and body conventions the house style requires', () => {
    // AC1. CONTRIBUTING.md:63-68 — frontmatter, the prohibition up front, the literal $ARGUMENTS
    // token, and stack detection before anything else. Presence, not meaning.
    const fields = frontmatter(command, 'explain.md');
    assert.ok(fields.description && fields.description.length > 0, 'description is empty');
    assert.ok(fields['argument-hint'] && fields['argument-hint'].length > 0, 'argument-hint is empty');

    // "Opens by naming what the command must NOT do" — scoped to the opening block, so moving the
    // prohibition into a footnote fails. Stack detection is a numbered STEP, not an opening
    // paragraph, so it is asserted against the whole file; the same scoping as
    // spec-explore-wiring.test.mjs:62-71.
    const body = command.slice(command.indexOf('\n---', 4) + 4);
    const opening = body.trim().split(/\n\s*\n/).slice(0, 2).join('\n');
    assert.match(opening, /do NOT|does NOT|must not|never/i,
      'the command must state up front what it does not do');

    assert.match(command, /\$ARGUMENTS/, 'the user\'s input is passed as the literal $ARGUMENTS token');
    assert.match(command, /[Dd]etect the stack/, 'the command must detect the stack before explaining');
    assert.match(command, /`CLAUDE\.md`/);
    assert.match(command, /`docs\/PATTERNS\.md`/);
  });

  test('explainer is declared read-only, with a router-trigger description', () => {
    // AC4 and AC5. Least privilege is a stated rule, not an observation (CONTRIBUTING.md:102-103):
    // this agent describes code, so it must not be able to change it, and the note is its caller's
    // to write — exactly the split analyst.md:11-14 makes.
    const fields = frontmatter(agent, 'explainer.md');
    assert.equal(fields.name, 'explainer');
    assert.equal(fields.model, 'inherit');
    assert.equal(fields.tools, 'Read, Grep, Glob, Bash');
    assert.doesNotMatch(fields.tools, /\bWrite\b/);
    assert.doesNotMatch(fields.tools, /\bEdit\b/);
    assert.doesNotMatch(fields.tools, /\bWebFetch\b/);

    // Router-trigger phrasing (CONTRIBUTING.md:95, docs/PATTERNS.md:46-48): a "Use to/for …"
    // clause and an explicit negative boundary. The boundary is what keeps ticket analysis with
    // `analyst` and code explanation here — the one risk spec 0011 §7 names that no structural
    // test can hold.
    const d = fields.description;
    assert.ok(d && d.length > 0, 'description is empty');
    assert.match(d, /\bUse (to|for)\b/, 'the description must carry a "Use to/for …" clause');
    assert.match(d, /does NOT modify code/i, 'the negative boundary must say it does not modify code');
    assert.match(d, /does NOT write the note/i, 'the negative boundary must say it does not write the note');
  });

  test('the agent states all six output-contract items', () => {
    // AC6. Presence of each item as a bold heading, plus the sentence that makes citation the
    // agent's standing obligation rather than a preference. Deletion-detecting, not
    // meaning-checking.
    for (const item of [
      /\*\*What it does\*\*/,
      /\*\*Entry points\*\*/,
      /\*\*Flow\*\*/,
      /\*\*Contracts & callers\*\*/,
      /\*\*Gotchas\*\*/,
      /\*\*What you could not determine\*\*/,
    ]) {
      assert.match(agent, item, `the output contract omits ${item}`);
    }
    assert.match(agent, /[Ee]very claim carries a `file:line`/,
      'the agent must state that every claim carries a file:line');
  });
});

describe('explain wiring', () => {
  test('the command invokes the agent in the form the validator accepts', () => {
    // AC3b. scripts/validate-plugin.mjs:227-228 accepts ONE form as an invocation: an imperative
    // verb plus the BOLDED agent name. A backticked mention is a description, and an agent nothing
    // invokes is a check-6 HARD ERROR at validate-plugin.mjs:242-247 — which is how `reviewer` and
    // `pr-author` looked wired up while nothing ran them for two releases (CONTRIBUTING.md:74-78).
    // Asserted here with the validator's own regex, so the two cannot drift apart.
    assert.match(command, /\b(use|spawn|run|delegate to|hand off to)\s+(the\s+)?\*\*explainer\*\*/i,
      'the command must INVOKE explainer in the bolded idiom, not merely mention it in backticks');
  });

  test('the command names the next command in the loop', () => {
    // AC3. docs/PATTERNS.md:67 — a command ends by naming the next one, so the workflow is
    // self-describing. This command is outside the loop, so it points at the loop's entry, the way
    // code.md:28 does.
    //
    // Scoped to the literal NEXT-COMMAND form, not a bare mention: `/ml-specs:spec` also appears
    // incidentally in this file's prose, and spec 0007 revision 11 records a whole-file match for
    // the bare token passing with the closing step deleted. The bolded-around-a-code-span form
    // (spec-explore.md:67) appears only where the command hands off.
    assert.match(command, /\*\*`\/ml-specs:spec <ticket>`\*\*/,
      'the command must NAME /ml-specs:spec as the next command, not merely mention it');
  });

  test('the command contains no ${CLAUDE_PLUGIN_ROOT}', () => {
    // AC2. It references no template, so it must not carry the token — the usage counts at
    // docs/ARCHITECTURE.md:34 and docs/architecture/prompt-surface.md:63 ("10 commands … 13
    // files") are asserted against the commands that actually contain it, by
    // repo-skills-wiring.test.mjs:237-259. spec-explore.md is the precedent: zero occurrences.
    //
    // Non-vacuous only because `command` was read non-defensively at module load: a file that does
    // not exist contains no token either.
    assert.ok(!command.includes('CLAUDE_PLUGIN_ROOT'),
      'explain.md references no template; adding the token invalidates the documented counts');
  });

  test('the command prescribes the note\'s header table and its six headings', () => {
    // AC7. All THREE header rows — Target says what was explained, Date says how old the snapshot
    // is, and note rot is an accepted risk bounded by exactly that row (spec 0011 §7).
    for (const row of ['**Target**', '**Title**', '**Date**']) {
      assert.ok(command.includes(row), `the header table omits the ${row} row`);
    }
    for (const heading of ['## 1. What it does', '## 2. Entry points', '## 3. Flow',
      '## 4. Contracts & callers', '## 5. Gotchas', '## 6. What you could not determine']) {
      assert.ok(command.includes(heading), `the section contract omits "${heading}"`);
    }
    assert.match(command, /specs\/explain-<slug>\.md/, 'the command must name the artefact path');
  });

  test('the command confirms before replacing an existing note', () => {
    // AC8. docs/PATTERNS.md:100 — never silently overwrite a user's file.
    assert.match(command, /Never silently overwrite/i);
    assert.match(command, /already exists/i);
    assert.match(command, /\bask\b/i);
  });
});

describe('explain notes and explore notes are disjoint families', () => {
  test('/ml-specs:spec step 0 still globs explore-*.md, which cannot match an explain note', () => {
    // AC10. specs/ now holds three file families. The boundary rests on TWO facts and no new
    // filter code: SPEC_FILE's four-digit rule (AC9, lib/specs.test.mjs) keeps explain notes out
    // of the lifecycle, and /ml-specs:spec's step-0 glob keeps them out of the ANALYZE hand-off.
    //
    // Both operands are DERIVED — the glob from spec.md, the note name from explain.md — so this
    // fails if either side moves, rather than restating two literals this test typed itself.
    const stepZero = specCommand.indexOf('\n0. ');
    const stepOne = specCommand.indexOf('\n1. Detect the stack');
    assert.notStrictEqual(stepZero, -1, 'spec.md has no step 0');
    assert.ok(stepZero < stepOne, 'step 0 must come before step 1');
    const step = specCommand.slice(stepZero, stepOne);

    const globbed = step.match(/`(specs\/[a-z*-]+\*[^`]*\.md)`/);
    assert.ok(globbed, 'spec.md step 0 states no specs/ glob');
    assert.equal(globbed[1], 'specs/explore-*.md', 'step 0 must still glob the ANALYZE notes only');

    const notePath = command.match(/specs\/explain-<slug>\.md/);
    assert.ok(notePath, 'explain.md names no note path');
    const noteName = notePath[0].replace('<slug>', 'foo');

    const asRegExp = new RegExp(`^${globbed[1].replace(/\./g, '\\.').replace(/\*/g, '[^/]*')}$`);
    assert.ok(asRegExp.test('specs/explore-foo.md'), 'the glob must still match an analysis note');
    assert.ok(!asRegExp.test(noteName),
      `/ml-specs:spec step 0 would pick up ${noteName} — the two note families must stay disjoint`);
  });
});

describe('the repo validator knows the new agent', () => {
  test('the typo guard fires for explainer (fixture)', () => {
    // AC11. Proves the alternation at scripts/validate-plugin.mjs:254 is LIVE for the new name,
    // not merely that the string is present in the source. The guard matches a hardcoded
    // alternation of CORRECTLY SPELLED names and fires when the agent file is missing — a
    // misspelling is invisible to it by construction, so asserting one would be asserting output
    // that can never appear.
    //
    // Same fixture contract as plugin-wiring.test.mjs:180-225: the validator pins ROOT to its own
    // location, so pointing it at another tree means copying it plus its one non-stdlib import —
    // omit file-identity.mjs and the child dies on ERR_MODULE_NOT_FOUND before any check runs.
    // Deliberately NO manifests: supplying them half-built hard-errors before control reaches the
    // guard.
    //
    // THE ASSERTION IS ON THE STDOUT LINE, NOT THE EXIT CODE. The guard calls warn(), not err()
    // (validate-plugin.mjs:257), so it moves no exit code; the 1 this fixture exits with comes
    // from the missing manifests failing checks 1-5 and would be there with the guard deleted.
    const dir = mkdtempSync(join(tmpdir(), 'sdd-explain-'));
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      mkdirSync(join(dir, 'ml-specs', 'agents'), { recursive: true });
      mkdirSync(join(dir, 'ml-specs', 'commands'), { recursive: true });
      copyFileSync(VALIDATOR, join(dir, 'scripts', 'validate-plugin.mjs'));
      mkdirSync(join(dir, 'ml-specs', 'scripts', 'lib'), { recursive: true });
      copyFileSync(join(ROOT, 'ml-specs', 'scripts', 'lib', 'file-identity.mjs'),
        join(dir, 'ml-specs', 'scripts', 'lib', 'file-identity.mjs'));
      // The agent is referenced, correctly spelled, and ml-specs/agents/explainer.md is absent.
      writeFileSync(
        join(dir, 'ml-specs', 'commands', 'explain.md'),
        '---\ndescription: fixture\nargument-hint: <target>\n---\n\nUse the **explainer** agent.\n',
      );

      let stdout = '';
      try {
        stdout = execFileSync('node', [join(dir, 'scripts', 'validate-plugin.mjs')],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        stdout = e.stdout ?? '';
      }

      assert.match(
        stdout,
        /references "explainer", which is neither an agent nor a command/,
        `typo guard did not fire; stdout was:\n${stdout}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the roster surfaces the gates do not watch', () => {
  test('the ungated command-count sites were updated too', (t) => {
    // AC13b. Five of the six command-count sites are gated by repo-skills-wiring.test.mjs:217-235
    // and :261-271, which count ml-specs/commands/ on disk. These two are not, and this is what
    // the criterion exists for: ml-specs/mcp/README.md's prose count was missed once already, by
    // spec 0007, and README.md's tree comment is outside the agents-only slice that
    // plugin-wiring.test.mjs:267 takes.
    // Derived from disk, not from the digit 21 typed here: a count asserted against a literal goes
    // stale the next time a command lands, and a count asserted against reality cannot.
    const commandCount = readdirSync(join(PLUGIN, 'commands')).filter((f) => f.endsWith('.md')).length;

    const mcpReadme = readPlugin('mcp/README.md');
    const claimed = mcpReadme.match(/all (\d+) of them/);
    assert.ok(claimed, 'ml-specs/mcp/README.md no longer states the served-prompt count');
    assert.equal(Number(claimed[1]), commandCount,
      `ml-specs/mcp/README.md claims ${claimed[1]} commands are served as prompts, not ${commandCount}`);

    // Scoped to the commands half of the tree: a file-global grep is satisfied by the marketplace
    // table row at README.md:15, which is a different site with its own review obligation.
    const rootReadme = readRoot('README.md');
    const tree = rootReadme.slice(rootReadme.indexOf('├── commands/'), rootReadme.indexOf('├── skills/'));
    assert.ok(tree.length > 0, 'README.md\'s commands tree comment could not be located');
    assert.match(tree, /(^|[^\w-])explain(?![\w-])/, 'README.md\'s commands tree comment omits explain');

    // CLAUDE.md is a GENERATED layer, absent from a clean clone and from the npm package, so it is
    // read defensively — absent means "not applicable here", not "the assertion failed".
    const claude = readGenerated('CLAUDE.md');
    if (!claude) return t.diagnostic('CLAUDE.md absent (generated layer) — its count check skipped');
    const m = claude.match(/(\d+) commands, \d+ skill/);
    assert.ok(m, 'CLAUDE.md states no roster command count');
    assert.equal(Number(m[1]), commandCount, `CLAUDE.md claims ${m[1]} commands, not ${commandCount}`);
  });

  test('the dispatch table names the new agent', (t) => {
    // AC14. plugin-wiring.test.mjs:282-285 slices this table but asserts a different row, so
    // adding one is not otherwise watched. Scoped to the table: the shard names `explainer`
    // elsewhere too, in the agents enumeration.
    const shard = readGenerated('docs/architecture/prompt-surface.md');
    if (!shard) return t.diagnostic('prompt-surface.md absent (generated layer) — dispatch check skipped');
    const table = shard.slice(shard.indexOf('| Command | Agent |'), shard.indexOf('## Commands'));
    assert.ok(table.length > 0, 'the dispatch table could not be located');
    assert.match(table, /\| `ml-specs\/commands\/explain\.md:\d+` \| `explainer` \|/,
      'the dispatch table has no row mapping ml-specs/commands/explain.md to explainer');
  });

  test('the README documents the command', () => {
    // AC15. ml-specs/README.md is COMMITTED and ships to npm and the public mirror, so this always
    // has teeth. Scoped to the command roster: the agents roster above it names /ml-specs:explain
    // too, and a file-global grep would be satisfied by that alone.
    const readme = readPlugin('README.md');
    const roster = readme.slice(readme.indexOf('**Commands** (`commands/`)'),
      readme.indexOf('**Skills** (`skills/`)'));
    assert.ok(roster.length > 0, 'ml-specs/README.md\'s command roster could not be located');
    assert.match(roster, /^- `\/ml-specs:explain [^`]*` —/m,
      'ml-specs/README.md\'s command roster has no /ml-specs:explain bullet');

    // The MCP server reads COMMANDS_DIR at ml-specs/mcp/ml-specs-server.mjs:551, so the new
    // command is served automatically and only the prose count can go stale. Asserted against
    // disk, which is what "21" means.
    const onDisk = readdirSync(join(PLUGIN, 'commands')).filter((f) => f.endsWith('.md')).length;
    const mcpCount = readme.match(/all (\d+) commands as MCP prompts/);
    assert.ok(mcpCount, 'ml-specs/README.md no longer states the MCP-prompt count');
    assert.equal(Number(mcpCount[1]), onDisk, `the MCP-prompt count reads ${mcpCount[1]}, not ${onDisk}`);
  });
});

describe('the loop is untouched', () => {
  test('/ml-specs:explain is in no loop chain and no loop roster', (t) => {
    // AC16. /ml-specs:explain is deliberately OUTSIDE the SDD loop, like /ml-specs:code and
    // /ml-specs:fix. Adding it to a chain would teach an out-of-loop command as a loop step.
    //
    // The COUNT is what makes this non-vacuous. An absence assertion alone passes on a branch
    // where nothing was built — which is why `command` is read non-defensively at module load, and
    // why the ten chain heads are counted here rather than only checked for absence.
    //
    // The absence half is scoped to CHAIN LINES, not whole files: ml-specs/README.md is one of the
    // nine files below AND is required by AC15 to carry an /ml-specs:explain bullet, so a
    // whole-file absence assertion would make AC15 and AC16 mutually unsatisfiable.
    assert.ok(command.length > 0, 'commands/explain.md is empty — nothing to keep out of the loop');

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
      const heads = text.split('\n').filter((l) => HEAD.test(l));
      assert.equal(heads.length, expected,
        `${rel}: expected ${expected} chain head(s) reading "/ml-specs:spec-explore (optional) →", found ${heads.length}`);
      for (const line of heads) {
        assert.ok(!line.includes('/ml-specs:explain'),
          `${rel}: a loop chain names /ml-specs:explain, which is not a loop step:\n  ${line.trim()}`);
      }
      total += heads.length;
    }
    // Ten chains when the generated knowledge layer is present, nine on a clean clone — the rule
    // at spec-explore-wiring.test.mjs:283.
    assert.equal(total, skipped.length ? 9 : 10, `chain count is ${total}; skipped: ${skipped.join(', ')}`);
    if (skipped.length) t.diagnostic(`skipped (absent): ${skipped.join(', ')}`);

    // The loop-team tables and the loop's own README map the SDD phases. `explainer` belongs in
    // none of them, for the reason `coder`, `scanner` and `security-reviewer` are absent today.
    for (const rel of ['specs/AGENTS.md', 'ml-specs/templates/specs/AGENTS.md',
      'specs/README.md', 'ml-specs/templates/specs/README.md']) {
      const text = readRoot(rel);
      assert.ok(!text.includes('/ml-specs:explain'), `${rel} names /ml-specs:explain; it is not a loop step`);
      assert.ok(!/\bexplainer\b/.test(text), `${rel} names the explainer agent; it is not on the loop team`);
    }
  });
});
