// Wiring of the security-reviewer agent — the prompt files, the knowledge-layer
// rosters, and the repo validator that guards both.
//
// These are structural tests over Markdown. That is unusual, but the prompt files
// ARE the product here: an agent whose tools line grows `Write` is a real privilege
// escalation, and a dispatch sentence that grows an "if the change touches auth"
// qualifier silently rebuilds the conditional behaviour this agent replaced. Neither
// shows up in any other check.
//
// It is also the first coverage `scripts/validate-plugin.mjs` has ever had. That
// script pins its own ROOT to its location on disk (no --root, no cwd), so the one
// test that needs a different tree copies the real script into a fixture beside it —
// at test time, from the real file, so the copy cannot drift from what it tests.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)));  // ml-specs/
const ROOT = dirname(PLUGIN);                                     // repo root
const AGENTS_DIR = join(PLUGIN, 'agents');
const VALIDATOR = join(ROOT, 'scripts', 'validate-plugin.mjs');

const readDoc = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// CLAUDE.md and docs/ are this repo's GENERATED knowledge layer and are deliberately not
// committed — they are a maintainer's local artifact, not part of the published plugin. This
// test has therefore been red on every clean clone since it was written. Skipping when they are
// absent keeps the check exactly as strong where the docs exist (a maintainer's working tree,
// which is the only place they ever do) and stops it failing where they never can.
const hasKnowledgeLayer = ['CLAUDE.md', 'docs/ARCHITECTURE.md', 'docs/PATTERNS.md',
  'docs/architecture/prompt-surface.md'].every((r) => existsSync(join(ROOT, r)));
const agent = readFileSync(join(AGENTS_DIR, 'security-reviewer.md'), 'utf8');
const specVerify = readFileSync(join(PLUGIN, 'commands', 'spec-verify.md'), 'utf8');

/** Every agent on disk, by filename stem — the source of truth the docs must match. */
const agentStems = readdirSync(AGENTS_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''))
  .sort();

/** Run the real validator; return both streams and the exit code rather than throwing. */
function runValidator() {
  try {
    const stdout = execFileSync('node', [VALIDATOR], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    // A non-zero exit makes execFileSync throw; the streams hang off the error.
    return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('security-reviewer agent contract', () => {
  test('security-reviewer is read-only and correctly declared', () => {
    // AC1. Least privilege is a stated rule, not an observation: only implementers
    // get Write/Edit. This agent reads a diff and reports; it must never be able to
    // "fix" what it found.
    const fm = agent.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(fm, 'security-reviewer.md has no frontmatter block');
    const fields = Object.fromEntries(
      fm[1].split('\n').map((l) => l.match(/^([a-z-]+):\s*(.*)$/i)).filter(Boolean).map((m) => [m[1], m[2].trim()]),
    );

    assert.equal(fields.name, 'security-reviewer');
    assert.ok(fields.description && fields.description.length > 0, 'description is empty');
    assert.equal(fields.model, 'inherit');
    assert.equal(fields.tools, 'Read, Grep, Glob, Bash');
    assert.doesNotMatch(fields.tools, /\bWrite\b/);
    assert.doesNotMatch(fields.tools, /\bEdit\b/);
  });

  test('the agent defines severities, verdicts and precedence', () => {
    // AC3. A verdict vocabulary the prompt does not spell out is one the model
    // invents per run, and /spec-verify's gate reads the word literally.
    for (const severity of ['critical', 'high', 'medium', 'low']) {
      assert.match(agent, new RegExp('`' + severity + '`'), `severity ${severity} is not defined`);
    }
    for (const verdict of ['clear', 'blocked', 'inconclusive']) {
      assert.match(agent, new RegExp('`' + verdict + '`'), `verdict ${verdict} is not defined`);
    }
    assert.match(agent, /`blocked`\s*>\s*`inconclusive`\s*>\s*`clear`/);
    assert.match(agent, /`inconclusive`\s+is\s+not\s+`clear`/i);
  });

  test('the agent must not echo secret values', () => {
    // AC9. This agent has Bash and its output is relayed verbatim into a PR body.
    // Pasting the credential it found widens the exposure it was called to catch.
    const ruleAt = agent.indexOf('Secret handling');
    assert.notStrictEqual(ruleAt, -1, 'no secret-handling section');
    const rule = agent.slice(ruleAt);
    assert.match(rule, /`file:line`/);
    assert.match(rule, /pattern/i);
    assert.match(rule, /never\s+reproduce\s+the\s+value/i);
  });

  test('the agent specifies its report shape', () => {
    // AC10. All four parts of the output contract, in the prompt rather than left
    // to the implementer of each run.
    const contractAt = agent.indexOf('## Output contract');
    assert.notStrictEqual(contractAt, -1, 'no output-contract section');
    const contract = agent.slice(contractAt);
    assert.match(contract, /Findings/i);
    assert.match(contract, /`file:line`/);
    assert.match(contract, /Not assessed/i);
    assert.match(contract, /Pre-existing/i);
    assert.match(contract, /single word on its own line/i);
  });
});

describe('/spec-verify dispatches the security review', () => {
  // The validator matches dispatch by regex, not by literal string: an imperative
  // verb followed by the **bolded** name. A backticked mention deliberately does
  // not count, which is how two agents once looked reachable while nothing ran them.
  const INVOKE = (name) =>
    new RegExp(`\\b(use|spawn|run|delegate to|hand off to)\\s+(the\\s+)?\\*\\*${name}\\*\\*`, 'i');

  test('spec-verify dispatches both reviewers per the INVOKE regex', () => {
    // AC2.
    assert.match(specVerify, INVOKE('security-reviewer'));
    assert.match(specVerify, INVOKE('reviewer'));
  });

  test('the security dispatch is unconditional and concurrent', () => {
    // AC2b. The human's decision is always-on. "If the change touches auth, use the
    // **security-reviewer** agent" would pass AC2, AC5 and AC8 while rebuilding the
    // conditional /security-review habit this exists to replace — so assert the
    // dispatch sentence itself carries no qualifier.
    const paragraph = specVerify
      .split(/\n\s*\n/)
      .find((p) => INVOKE('security-reviewer').test(p));
    assert.ok(paragraph, 'no paragraph dispatches security-reviewer');

    const sentence = paragraph
      .split(/(?<=\.)\s+/)
      .find((s) => /\*\*security-reviewer\*\*/.test(s));
    assert.ok(sentence, 'no sentence names the bolded agent');
    assert.doesNotMatch(sentence, /\b(if|when|unless|whenever|should|where relevant|only)\b/i,
      `the dispatch is conditional: ${sentence.replace(/\s+/g, ' ')}`);

    assert.match(specVerify, /dispatch(?:ing)? both agents \*\*in a single message\*\*/i);
  });

  test('blocked and inconclusive both stop Verified', () => {
    // AC4. The gate is the "clean" definition in the Next step clause — if the
    // security verdict is not named there, the agent runs and changes nothing.
    const nextStepAt = specVerify.indexOf('Next step:');
    assert.notStrictEqual(nextStepAt, -1, 'no Next step clause');
    const nextStep = specVerify.slice(nextStepAt);
    assert.match(nextStep, /security verdict/i);
    assert.match(nextStep, /`clear`/);
    assert.match(nextStep, /`blocked`[\s\S]*`inconclusive`[\s\S]*stop the `Verified` transition/);
  });
});

describe('the repo validator knows the new agent', () => {
  test('the real validator accepts the new agent', () => {
    // AC5. Exit 0, and no error anywhere naming security-reviewer — i.e. a command
    // really dispatches it and the typo-guard alternation really covers it.
    const r = runValidator();
    assert.equal(r.code, 0, `validator failed:\n${r.stderr}`);
    const offending = `${r.stdout}${r.stderr}`
      .split('\n')
      .filter((l) => l.includes('error') && l.includes('security-reviewer'));
    assert.deepEqual(offending, []);
  });

  test('no new validator warning', () => {
    // AC8. Warnings go to stdout. Exactly one is expected and standing: spec-author,
    // which declares its entry point with an <!-- invoked-by: --> comment. A second
    // one means this change made the gate noisier, and a noisy gate gets ignored.
    const r = runValidator();
    const warningLines = r.stdout.split('\n').filter((l) => /^\s*warning\s/.test(l));
    assert.equal(warningLines.length, 1, `unexpected warnings:\n${warningLines.join('\n')}`);
    assert.match(warningLines[0], /spec-author/);
  });

  test('the typo guard fires for security-reviewer (fixture)', () => {
    // AC6. Proves the alternation is LIVE for the new name, not merely that the
    // string is present in the source. The guard catches a correctly spelled agent
    // name whose file was renamed or deleted — so the fixture dispatches the agent
    // and omits its file.
    //
    // The validator pins ROOT to its own location on disk, so the only way to point
    // it at another tree is to copy it there. Two files: the validator, and its only
    // non-stdlib import, `ml-specs/scripts/lib/file-identity.mjs`, which must land at
    // the same relative path or the fixture process dies on ERR_MODULE_NOT_FOUND.
    //
    // Deliberately NO manifests. Supplying them half-built is the trap — a
    // description that does not enumerate every command in the fixture hard-errors
    // before control reaches the typo guard. With none, sections 1-5 push errors and
    // continue, the guard still runs, and the process exits 1 — so the warning lands
    // on stdout of a throwing execFileSync.
    const dir = mkdtempSync(join(tmpdir(), 'sdd-wiring-'));
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      mkdirSync(join(dir, 'ml-specs', 'agents'), { recursive: true });
      mkdirSync(join(dir, 'ml-specs', 'commands'), { recursive: true });
      copyFileSync(VALIDATOR, join(dir, 'scripts', 'validate-plugin.mjs'));
      mkdirSync(join(dir, 'ml-specs', 'scripts', 'lib'), { recursive: true });
      copyFileSync(join(ROOT, 'ml-specs', 'scripts', 'lib', 'file-identity.mjs'),
        join(dir, 'ml-specs', 'scripts', 'lib', 'file-identity.mjs'));
      writeFileSync(
        join(dir, 'ml-specs', 'commands', 'spec-verify.md'),
        '---\ndescription: fixture\nargument-hint: <spec>\n---\n\nUse the **security-reviewer** agent.\n',
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
        /references "security-reviewer", which is neither an agent nor a command/,
        `typo guard did not fire; stdout was:\n${stdout}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('knowledge layer', () => {
  test('agent rosters and counts match disk', (t) => {
    if (!hasKnowledgeLayer) {
      t.diagnostic('knowledge layer absent (CLAUDE.md / docs/ are not committed) — roster check skipped');
      return;
    }
    // AC7. Asserted against readdirSync, not against the absence of the digit 7:
    // the two READMEs carry no count at all (only rosters), and a \b7\b scan would
    // false-positive forever after on any future foo.mjs:7 citation. The knowledge
    // gate cannot catch this — it only checks that a cited path exists and the line
    // is in range, which is exactly how prompt-surface.md's stale :44 survived.
    const n = agentStems.length;
    assert.ok(agentStems.includes('security-reviewer'), 'the agent file is missing from disk');

    // (a) every documented count equals N.
    const counts = [
      ['CLAUDE.md', readDoc('CLAUDE.md'), /\((\d+) agents,/],
      ['docs/ARCHITECTURE.md', readDoc('docs/ARCHITECTURE.md'), /\((\d+) agents,/],
      ['docs/PATTERNS.md', readDoc('docs/PATTERNS.md'), /consistent across all\s+(\d+)\b/],
      ['docs/architecture/prompt-surface.md', readDoc('docs/architecture/prompt-surface.md'), /layer: (\d+) agents/],
      ['docs/architecture/prompt-surface.md', readDoc('docs/architecture/prompt-surface.md'), /`ml-specs\/agents\/`, (\d+) files/],
    ];
    for (const [label, body, re] of counts) {
      const m = body.match(re);
      assert.ok(m, `${label}: no agent count matching ${re}`);
      assert.equal(Number(m[1]), n, `${label} says ${m[1]} agents, disk has ${n}`);
    }

    // (b) each of the three rosters names every agent on disk.
    const promptSurface = readDoc('docs/architecture/prompt-surface.md');
    const enumeration = promptSurface.slice(
      promptSurface.indexOf('One file per role'),
      promptSurface.indexOf('Dispatch is **textual**'),
    );
    const rootReadme = readDoc('README.md');
    const tree = rootReadme.slice(rootReadme.indexOf('├── agents/'), rootReadme.indexOf('├── commands/'));
    const pluginReadme = readDoc('ml-specs/README.md');
    const roster = pluginReadme.slice(
      pluginReadme.indexOf('**Agents** (`agents/`)'),
      pluginReadme.indexOf('**Commands** (`commands/`)'),
    );

    assert.ok(enumeration.length > 0 && tree.length > 0 && roster.length > 0, 'a roster section could not be located');
    for (const stem of agentStems) {
      assert.ok(enumeration.includes(`\`${stem}.md\``), `prompt-surface.md's enumeration omits ${stem}.md`);
      assert.match(tree, new RegExp(`(^|[^\\w-])${stem}(?![\\w-])`), `README.md's tree comment omits ${stem}`);
      assert.match(roster, new RegExp(`^- \`${stem}\` —`, 'm'), `ml-specs/README.md's roster omits ${stem}`);
    }

    // (c) the dispatch table gained a row and lost its stale citation.
    const dispatchTable = promptSurface.slice(
      promptSurface.indexOf('| Command | Agent |'),
      promptSurface.indexOf('## Commands'),
    );
    assert.match(dispatchTable, /\| `security-reviewer` \|/);
    assert.doesNotMatch(promptSurface, /spec-verify\.md:44/);
  });
});

// Check 13 — the byte-identity guard.
//
// This repo is a consumer of the toolkit it ships: `.github/scripts/knowledge-check.mjs` IS the
// template seeded into adopting repos, and the two must never diverge. The invariant used to be
// prose in a doc enforced by nobody. Check 13 enforces it — but the real tree always has the two
// copies matching, so `npm test` and the §6.1 validator run only ever exercise the happy path.
// Deleting the entire guard leaves both green. These tests are the reason it cannot be removed
// or broken silently.
//
// Same fixture contract as the harnesses above: no manifests, so checks 1-5 always push errors
// and exit 1 proves nothing — every assertion pins the stderr/stdout string instead.
describe('check 13 — byte-identical copies', () => {
  const TEMPLATE = join('ml-specs', 'templates', 'ci', 'knowledge-check.mjs');
  const CI_COPY = join('.github', 'scripts', 'knowledge-check.mjs');

  // NOTE, and it cost a debugging round: the validator sends WARNINGS to stdout but ERRORS to
  // stderr. The harnesses above assert on stdout because they pin a warning; check 13 raises an
  // error, so these read stderr. Returning both concatenated keeps the assertions honest either
  // way and stops the next person rediscovering it.
  /** Build a fixture whose two copies hold `template` and `ciCopy`, and run the validator. */
  function runWithCopies({ template, ciCopy }) {
    const dir = mkdtempSync(join(tmpdir(), 'sdd-identity-'));
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      copyFileSync(VALIDATOR, join(dir, 'scripts', 'validate-plugin.mjs'));
      mkdirSync(join(dir, 'ml-specs', 'scripts', 'lib'), { recursive: true });
      copyFileSync(join(ROOT, 'ml-specs', 'scripts', 'lib', 'file-identity.mjs'),
        join(dir, 'ml-specs', 'scripts', 'lib', 'file-identity.mjs'));
      for (const [rel, body] of [[TEMPLATE, template], [CI_COPY, ciCopy]]) {
        if (body === null) continue;             // null means "this side is missing"
        mkdirSync(dirname(join(dir, rel)), { recursive: true });
        writeFileSync(join(dir, rel), body);
      }
      try {
        return execFileSync('node', [join(dir, 'scripts', 'validate-plugin.mjs')],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        return `${e.stdout ?? ''}${e.stderr ?? ''}`;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test('identical copies raise no drift error', () => {
    const out = runWithCopies({ template: 'same\n', ciCopy: 'same\n' });
    assert.doesNotMatch(out, /has drifted from/, `unexpected drift error; output was:\n${out}`);
    assert.doesNotMatch(out, /one of the two is missing/);
  });

  test('one byte of difference is reported as drift', () => {
    const out = runWithCopies({ template: 'same\n', ciCopy: 'same \n' });
    assert.match(out, /has drifted from/, `drift guard did not fire; output was:\n${out}`);
    assert.match(out, /must be byte-identical/);
  });

  test('a missing side is reported, not silently skipped', () => {
    const out = runWithCopies({ template: 'same\n', ciCopy: null });
    assert.match(out, /one of the two is missing/, `missing-side branch did not fire; output was:\n${out}`);
  });
});
