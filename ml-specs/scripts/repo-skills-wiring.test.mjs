// Wiring of /repo-skills and the docs/SKILLS.md knowledge-layer file — spec 0005.
//
// WHAT THIS FILE ASSERTS, AND WHAT IT DELIBERATELY DOES NOT
//
// It asserts facts that are mechanically true of the repo: a file exists, a manifest names a
// command, a stated count equals what is on disk, a cited line says what the citation claims, the
// agent roster is unchanged, the real validator exits 0. Every one of those is exact — the
// assertion IS the fact, with no interpretation in between.
//
// It does NOT assert what the prompt files MEAN. Four adversarial review passes tried to hold
// directional properties — "delegates to scanner", "the guard writes nothing", "the template is
// the fallback" — with regexes over English. Each pass found survivors of the same shape: prose
// that keeps every asserted keyword while reversing the instruction ("do not stop", "Delegate the
// reading was the guidance until…"). The fourth pass also found eight FALSE POSITIVES, where a
// clearer rewrite turned the suite red — including one that accused the author of inverting a
// directive for merging two sentences into the correct single one. That is worse than no test: it
// pressures people to write worse prose to appease a regex.
//
// So those properties are now a REVIEW obligation, recorded as such in the spec's §5, not a test.
// The trade is deliberate: this file catches deletion, reversion, renaming, drift and
// miscounting — everything structural — and makes no claim to catch semantic inversion. An honest
// narrow test beats a broad one that cannot fail. Do not reintroduce prose-directional assertions
// here; if a directional property must be machine-checked, give the prompt files an explicit
// machine-readable marker and read that instead of parsing a sentence.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)));  // ml-specs/
const ROOT = dirname(PLUGIN);                                     // repo root

const readPlugin = (rel) => readFileSync(join(PLUGIN, rel), 'utf8');

/**
 * Read a file that is COMMITTED and must exist — manifests, READMEs, the plugin's own files.
 */
function readRoot(rel) {
  const abs = join(ROOT, rel);
  assert.ok(existsSync(abs), `${rel} is missing — it is tracked and spec 0005 asserts against it`);
  return readFileSync(abs, 'utf8');
}

/**
 * Read a file from this repo's GENERATED knowledge layer, or return null.
 *
 * `CLAUDE.md` and `docs/` are deliberately not committed to this repo: they are the knowledge
 * layer a maintainer generates locally, not part of the published plugin. So these tests must
 * not REQUIRE them — a clean clone has to pass. Where they are present they are checked in full
 * and catch drift exactly as before; where they are absent the check reports itself as skipped
 * rather than passing silently, because a check that quietly evaporates is the failure mode this
 * whole suite was rewritten to avoid.
 *
 * Nothing here is weakened for the files that ARE committed: `ml-specs/README.md`, the root
 * `README.md` and both manifests carry the same claims and are asserted unconditionally.
 */
function readGenerated(rel) {
  const abs = join(ROOT, rel);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

/** Report what was skipped, so an absent knowledge layer is visible rather than silent. */
function noteSkipped(t, names) {
  if (names.length) t.diagnostic(`knowledge layer absent, not checked: ${names.join(', ')}`);
}

/**
 * One `## ` section, BOUNDED at the next heading.
 *
 * Bounding is what makes a "this appears in Step 3" check mean Step 3 — an unbounded slice runs
 * to EOF and is satisfied by Step 4.
 */
function section(text, heading) {
  const start = text.indexOf(heading);
  assert.ok(start !== -1, `expected a "${heading}" section`);
  const after = text.indexOf('\n## ', start + heading.length);
  return after === -1 ? text.slice(start) : text.slice(start, after);
}

const command = readPlugin('commands/repo-skills.md');
const repoInit = readPlugin('commands/repo-init.md');
const repoAdopt = readPlugin('commands/repo-adopt.md');
const fragment = readPlugin('templates/CLAUDE.fragment.md');
const template = readPlugin('templates/docs/SKILLS.template.md');
const commandFiles = readdirSync(join(PLUGIN, 'commands')).filter((f) => f.endsWith('.md'));

describe('/repo-skills wiring', () => {
  // --- the plugin surface ---------------------------------------------------

  test('the validator accepts the new command', () => {
    // The strongest check here: the real validator, end to end. It enforces that BOTH manifest
    // descriptions name every command, which is how a new command avoids shipping invisible.
    const out = execFileSync('node', [join(ROOT, 'scripts', 'validate-plugin.mjs')],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(out, /validation passed/);
  });

  test('both manifest descriptions name /repo-skills', () => {
    for (const rel of ['ml-specs/.claude-plugin/plugin.json', '.claude-plugin/marketplace.json']) {
      assert.match(readRoot(rel), /(?:\/|\/ml-specs:)repo-skills(?![\w-])/,
        `${rel} description is the command list users see — it must name /repo-skills`);
    }
  });

  test('the command has the frontmatter the house style requires', () => {
    assert.match(command, /^---\n/, 'must open with YAML frontmatter');
    assert.match(command, /\ndescription: .+/);
    assert.match(command, /\nargument-hint: .+/);
    assert.match(command, /(?:\/|\/ml-specs:)(?:repo-doctor|repo-refresh)/, 'a command in the loop names the next one');
  });

  test('the agent roster matches disk', () => {
    // A deepEqual roster, not a count: it catches an addition, a removal and a rename.
    assert.deepEqual(readdirSync(join(PLUGIN, 'agents')).filter((f) => f.endsWith('.md')).sort(), [
      'analyst.md', 'coder.md', 'developer.md', 'explainer.md', 'pr-author.md', 'reviewer.md',
      'scanner.md', 'security-reviewer.md', 'spec-author.md', 'spec-reviewer.md',
    ], 'the agent roster drifted from ml-specs/agents/');
  });

  // --- the template ---------------------------------------------------------

  test('the template exists, is documented, and has the §4.1 document shape', (t) => {
    const tpl = readGenerated('docs/architecture/templates.md');
    if (tpl) assert.match(tpl, /docs\/SKILLS\.template\.md/,
      'a template nobody documents is a template nobody finds');
    else noteSkipped(t, ['docs/architecture/templates.md']);
    assert.match(template, /^#\s+Relevant catalog skills/m, 'H1 heading per the doc contract');
    assert.match(template, /\|\s*Skill\s*\|\s*Matched\s*\|\s*Risk\s*\|\s*What it covers\s*\|/,
      'the four table columns the tool actually renders');
    assert.match(template, /##\s+Technologies with no catalog match/,
      '"nothing matched" is a real answer and has its own section');
    // Every table line, not just the header: a column added to a data row is still a column.
    for (const row of template.split('\n').filter((l) => /^\s*\|/.test(l))) {
      assert.ok(!/\bsource\b/i.test(row),
        `no source column — source lives in the catalog entry, reached via skill_fetch: "${row.trim()}"`);
    }
  });

  test('the template carries the no-authority framing §7 relies on', () => {
    // Presence, not meaning. §7 names this framing as the mitigation for "third-party skills read
    // as endorsement"; this catches its DELETION, which is the failure that actually happens.
    // Whether the wording still reads as a disclaimer is a review question.
    assert.match(template, /not this organisation's standards/i);
    assert.match(template, /the standard wins|standard .{0,20}outranks/i);
    assert.match(template, /skill_fetch/i, 'the template must say how to actually read a skill');
    assert.match(template, /fallback/i, 'the template must identify itself as the fallback path');
  });

  // --- the entry points -----------------------------------------------------

  test('both entry points name the command and the file they delegate to', () => {
    // Revert-detection. Before this assertion named /repo-skills specifically, reverting
    // repo-init.md wholesale passed, because the generic ml-skills strings it checked were
    // already present in the pre-existing architecture-standards step 11.
    for (const [label, text] of [['repo-init', repoInit], ['repo-adopt', repoAdopt]]) {
      assert.match(text, /(?:\/|\/ml-specs:)repo-skills(?![\w-])/, `${label} must name /repo-skills`);
      assert.match(text, /docs\/SKILLS\.md/, `${label} must name the file the step produces`);
    }
  });

  test('repo-doctor and repo-refresh know docs/SKILLS.md is part of the layer', () => {
    for (const rel of ['commands/repo-doctor.md', 'commands/repo-refresh.md']) {
      assert.match(readPlugin(rel), /docs\/SKILLS\.md/,
        `${rel} inventories the knowledge layer — a file it does not know about drifts unseen`);
    }
  });

  test('the command has a no-catalog guard section', () => {
    // AC9's mechanical half — and only that half. This asserts the guard EXISTS and names the
    // dependency it guards; it makes no claim about what the guard instructs, which four review
    // passes established cannot be held by a regex. Deleting `## Step 0` outright was previously
    // green, which is the one real (if small) check lost when the prose assertions came out.
    const guard = section(command, '## Step 0');
    assert.match(guard, /ml-skills/,
      'the guard must name the dependency whose absence it checks for');
    assert.ok(guard.trim().split('\n').length > 3,
      'a one-line Step 0 is a placeholder, not a guard');
  });

  // --- the command's dependency on the tool ---------------------------------

  test('Step 3 names the tool fields it consumes', () => {
    // Scoped to Step 3 so moving them elsewhere fails. This is an API-surface check: these are
    // field names from skill_recommend, not prose, so asserting them is asserting a fact.
    const step3 = section(command, '## Step 3');
    for (const field of ['skillsDoc', 'claudeMdPointer']) {
      assert.match(step3, new RegExp(field),
        `Step 3 must consume ${field} rather than hand-building the document`);
    }
    assert.match(command, /skill_fetch/, 'a row is a pointer; reading one is a separate step');
  });

  // --- the CLAUDE.md pointer ------------------------------------------------

  test('the CLAUDE fragment entry carries no inlined skill list', () => {
    // Structural, not semantic: markdown block constructs between the pointer and the next item.
    // It does not catch a prose enumeration — §7's context-budget risk is broader than this test,
    // and the spec says so rather than implying coverage it does not have.
    const i = fragment.indexOf('docs/SKILLS.md');
    assert.ok(i > 0, 'the retrieval ladder must list the file');
    const rest = fragment.slice(i);
    const nextItem = rest.search(/\n\d+\.\s/);
    const entry = nextItem === -1 ? rest.slice(0, 400) : rest.slice(0, nextItem);
    assert.ok(!/\n\s*\|/.test(entry), 'a table under the pointer is the list, not a pointer');
    assert.ok(!/```/.test(entry), 'a code fence under the pointer is the list, not a pointer');
    // TWO OR MORE consecutive id-shaped bullets. One dashed bullet is a clarifying aside, not an
    // inlined list, and failing on it accuses the author of something they did not do.
    const idBullet = String.raw`\n\s*[-*]\s+\`?[a-z0-9][a-z0-9-]{2,}\`?\s*[—-]\s[^\n]*`;
    assert.ok(!new RegExp(`${idBullet}${idBullet}`, 'i').test(entry),
      'consecutive skill-id bullets under the pointer are the list, not a pointer');
  });

  // --- counts, which drift silently and are exactly checkable ---------------

  test('every roster surface agrees on the command count', (t) => {
    const skipped = [];
    // ml-specs/README.md is COMMITTED and states the count, so this test always has teeth.
    for (const rel of ['ml-specs/README.md', 'docs/architecture/prompt-surface.md', 'CLAUDE.md',
                       'docs/ARCHITECTURE.md']) {
      const text = rel.startsWith('ml-specs/') ? readRoot(rel) : readGenerated(rel);
      if (!text) { skipped.push(rel); continue; }
      const claims = [
        ...text.matchAll(/(\d+)\s+commands,\s*\d+\s+skill/g),
        ...text.matchAll(/all\s+(\d+)\s+commands/g),
      ].map((m) => Number(m[1]));
      assert.ok(claims.length, `${rel} states no roster command count — expected one to keep honest`);
      for (const n of claims) {
        assert.equal(n, commandFiles.length,
          `${rel} claims ${n} commands but ml-specs/commands/ holds ${commandFiles.length}`);
      }
    }
    noteSkipped(t, skipped);
  });

  test('the ${CLAUDE_PLUGIN_ROOT} usage claim agrees with reality, including its total', (t) => {
    // This claim went stale twice during this spec, and the first correction was itself wrong
    // (9→10 and 13→14 bumped in lockstep, when the total had never summed). Check both numbers.
    const cmds = commandFiles.filter((f) => readPlugin(`commands/${f}`).includes('CLAUDE_PLUGIN_ROOT')).length;
    const hooks = readdirSync(join(PLUGIN, 'hooks'))
      .filter((f) => readFileSync(join(PLUGIN, 'hooks', f), 'utf8').includes('CLAUDE_PLUGIN_ROOT')).length;
    const mcp = ['.mcp.json', 'templates/mcp/.mcp.json']
      .filter((r) => existsSync(join(PLUGIN, r)) && readPlugin(r).includes('CLAUDE_PLUGIN_ROOT')).length;
    const total = cmds + hooks + mcp;
    const docs = ['docs/architecture/prompt-surface.md', 'docs/ARCHITECTURE.md'];
    const present = docs.filter((r) => readGenerated(r));
    if (!present.length) return noteSkipped(t, docs);
    for (const rel of present) {
      // Anchored on the sentence stating the breakdown, not on the first mention of the token —
      // an unrelated earlier mention would otherwise move the window off the claim entirely.
      const text = readRoot(rel).replace(/[*`]/g, '').replace(/\s+/g, ' ');
      const m = text.match(/(\d+)\s+files\s*\((\d+)\s+commands|(\d+)\s+commands,\s*\d+\s+hooks?,[^.]{0,40}?\((\d+)\s+files\)/);
      assert.ok(m, `${rel} states no \${CLAUDE_PLUGIN_ROOT} usage breakdown`);
      const [claimedTotal, claimedCmds] = m[1] ? [Number(m[1]), Number(m[2])] : [Number(m[4]), Number(m[3])];
      assert.equal(claimedCmds, cmds, `${rel}: claims ${claimedCmds} commands use it, actual ${cmds}`);
      assert.equal(claimedTotal, total, `${rel}: claims ${claimedTotal} files total, actual ${total}`);
    }
  });

  test('the prompt-surface directory headings count what is on disk', (t) => {
    const text = readGenerated('docs/architecture/prompt-surface.md');
    if (!text) return noteSkipped(t, ['docs/architecture/prompt-surface.md']);
    for (const [dir, label] of [['agents', 'Agents'], ['commands', 'Commands']]) {
      const actual = readdirSync(join(PLUGIN, dir)).filter((f) => f.endsWith('.md')).length;
      const m = text.match(new RegExp(`## ${label} \\([^)]*?(\\d+) files`));
      assert.ok(m, `prompt-surface.md has no "## ${label} (… N files)" heading`);
      assert.equal(Number(m[1]), actual,
        `${label} heading claims ${m[1]} files, ml-specs/${dir}/ holds ${actual}`);
    }
  });

  test('every surface that enumerates the knowledge-layer commands lists /repo-skills', (t) => {
    const skipped = [];
    // Both READMEs are COMMITTED and enumerate the commands, so this always has teeth.
    for (const rel of ['README.md', 'ml-specs/README.md', 'docs/architecture/prompt-surface.md']) {
      // Scoped to the unit that enumerates them: a file-global grep is satisfied by any mention,
      // including a dispatch-table row citing the command's own path.
      const text = rel.startsWith('docs/') ? readGenerated(rel) : readRoot(rel);
      if (!text) { skipped.push(rel); continue; }
      const unit = text.split(/\n\s*\n/)
        .filter((b) => /repo-doctor/.test(b) && /repo-init/.test(b))
        .join('\n') || text.split('\n').filter((l) => /repo-doctor/.test(l) && /repo-init/.test(l)).join('\n');
      assert.ok(unit, `${rel} is expected to enumerate the knowledge-layer commands together`);
      assert.match(unit, /repo-skills/,
        `${rel} enumerates the knowledge-layer commands but omits /repo-skills`);
    }
    noteSkipped(t, skipped);
  });

  // --- citations, which the CI gate can only range-check --------------------

  test('every doc citation into repo-skills.md lands on the line it claims', (t) => {
    // Citations into this file went stale four times while the spec was built, every time from an
    // edit that added lines above them. knowledge-check.mjs only verifies the file exists and the
    // line is in range — not that the line says what is claimed. ALL citations, not the first.
    const lines = command.split('\n');
    const expected = [
      ['docs/architecture/prompt-surface.md', /scanner/],
      ['docs/architecture/templates.md', /SKILLS\.template\.md/],
    ];
    const skipped = [];
    for (const [doc, want] of expected) {
      const text = readGenerated(doc);
      if (!text) { skipped.push(doc); continue; }
      const hits = [...text.matchAll(/ml-specs\/commands\/repo-skills\.md:(\d+)/g)];
      assert.ok(hits.length, `${doc} no longer cites repo-skills.md`);
      for (const h of hits) {
        const line = lines[Number(h[1]) - 1] ?? '';
        assert.match(line, want,
          `${doc} cites repo-skills.md:${h[1]}, which does not mention ${want}`);
      }
    }
    noteSkipped(t, skipped);
  });
});
