// Every command this plugin ships is invocable ONLY as `/ml-specs:<name>`. A doc that writes
// `/spec-advance` therefore teaches a command that does not exist — and the templates propagate it
// into every adopting repo. Check 12 of `scripts/validate-plugin.mjs` is the gate that stops it
// coming back; these tests pin the gate.
//
// Two harnesses, both proven in `plugin-wiring.test.mjs`: the real validator over the real tree
// (the only thing that can prove the 573-edit rewrite landed), and a copy of the validator dropped
// into a tmp fixture for everything that needs a different ROOT — the script pins ROOT to its own
// location on disk, with no --root and no cwd. The copy must carry the validator's one local
// import (`ml-specs/scripts/lib/file-identity.mjs`) at the same relative path, or the fixture
// process dies on ERR_MODULE_NOT_FOUND before any check runs.
//
// The fixture harness ships NO manifests, deliberately: supplying them half-built hard-errors in
// checks 1-5 before control reaches the check under test. The consequence is that checks 1-5 ALWAYS
// push errors there, so exit 1 proves nothing about check 12 — every fixture assertion is on the
// pinned stderr string instead. For the same reason the fixture's `commands/*.md` stubs carry no
// slash-command references of their own: check 12 walks the whole fixture tree, stubs included.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)));  // ml-specs/
const ROOT = dirname(PLUGIN);                                     // repo root
const VALIDATOR = join(ROOT, 'scripts', 'validate-plugin.mjs');
const VALIDATOR_LIB = join('ml-specs', 'scripts', 'lib', 'file-identity.mjs');

const readRoot = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** Run the real validator over the real tree; return both streams and the exit code. */
function runValidator() {
  try {
    const stdout = execFileSync('node', [VALIDATOR], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    // A non-zero exit makes execFileSync throw; the streams hang off the error.
    return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/** Every command name the fixtures below reference. Stubs are bodies with no references. */
const FIXTURE_COMMANDS = ['spec', 'spec-review', 'spec-build', 'spec-verify', 'spec-advance',
  'code', 'pr'];

/**
 * Build a throwaway tree containing a copy of the validator, `ml-specs/commands/` stubs (check 12
 * derives its command list from them), plus `files`, and run it. Two files are enough to copy: the
 * validator, and its only non-stdlib import is `ml-specs/scripts/lib/file-identity.mjs`, which comes
 * along at the same relative path.
 */
function runFixture(files, commands = FIXTURE_COMMANDS) {
  const dir = mkdtempSync(join(tmpdir(), 'ml-specs-ns-'));
  try {
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    mkdirSync(join(dir, 'ml-specs', 'commands'), { recursive: true });
    copyFileSync(VALIDATOR, join(dir, 'scripts', 'validate-plugin.mjs'));
    mkdirSync(dirname(join(dir, VALIDATOR_LIB)), { recursive: true });
    copyFileSync(join(ROOT, VALIDATOR_LIB), join(dir, VALIDATOR_LIB));
    for (const name of commands) {
      writeFileSync(join(dir, 'ml-specs', 'commands', `${name}.md`),
        '---\ndescription: fixture\n---\n\nFixture body; names no command.\n');
    }
    for (const [rel, body] of Object.entries(files)) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    }

    let stdout = '';
    let stderr = '';
    let code = 0;
    try {
      stdout = execFileSync('node', [join(dir, 'scripts', 'validate-plugin.mjs')],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      code = e.status ?? 1;
      stdout = e.stdout ?? '';
      stderr = e.stderr ?? '';
    }
    return { code, stdout, stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Check 12's errors for one file, in order, normalised of the `  error    ` prefix. */
const bareErrors = (stderr, rel) => stderr.split('\n')
  .map((l) => l.replace(/^\s*error\s+/, '').trim())
  .filter((l) => l.startsWith(`${rel}: line `) && l.includes('bare `'));

describe('check 12 — slash-command references are namespaced', () => {
  test('no bare command references remain in the repo', () => {
    // AC1. The proof that the repo-wide rewrite actually landed: the real check, over the real
    // tree, reporting nothing. Asserted on the message rather than only on exit 0, so a future
    // unrelated error cannot mask a regression here.
    const r = runValidator();
    const offending = `${r.stdout}${r.stderr}`.split('\n').filter((l) => l.includes('bare `'));
    assert.deepEqual(offending, [], `bare command references found:\n${offending.join('\n')}`);
    assert.equal(r.code, 0, `validator failed:\n${r.stderr}`);
  });

  test('a bare reference in prose fails with the pinned message', () => {
    // AC2. The message format is a contract — the rest of these tests grep for it. Exit 1 is
    // asserted because AC2 names it, but it proves nothing on its own: the manifest-less fixture
    // exits 1 regardless. The stderr string is what carries the weight.
    const r = runFixture({ 'docs/thing.md': '# Thing\n\nRun `/spec-advance` when ready.\n' });
    assert.equal(r.code, 1);
    assert.ok(
      r.stderr.includes('docs/thing.md: line 3: bare `/spec-advance` — use `/ml-specs:spec-advance`'),
      `pinned message missing; stderr was:\n${r.stderr}`,
    );
  });

  test('leaves non-ml-specs commands and path-like strings alone', () => {
    // AC3. Two independent guards, both exercised here: `code-review` and `security-review` are not
    // command basenames AND the trailing (?![\w-]) stops `/code` reaching into `/code-review`;
    // the leading lookbehind is what keeps roughly a hundred path citations out of the report.
    const body = [
      '# Safe',
      '',
      'Built-ins: /code-review and /security-review. Another plugin: /ml-skills:skill.',
      'Already correct: /ml-specs:spec-build.',
      'Citations: `ml-specs/commands/code.md`, ./spec.md and ${ROOT}/pr.',
      '',
    ].join('\n');
    const r = runFixture({ 'docs/safe.md': body });
    assert.deepEqual(bareErrors(r.stderr, 'docs/safe.md'), []);
  });

  test('the allow-bare-commands marker exempts the file', () => {
    // AC4. File-scoped on purpose: a document either IS about the bare form (this spec, a
    // "wrong vs right" example) or it is not.
    const r = runFixture({
      'specs/0006-x.md': '<!-- allow-bare-commands -->\n# Spec\n\nTyping `/spec-build` fails.\n',
    });
    assert.deepEqual(bareErrors(r.stderr, 'specs/0006-x.md'), []);
  });

  test('fences are free except a line that starts with a command', () => {
    // AC5. A fenced block is exempt, because it is usually terminal transcript or sample output.
    // The exception is the line a reader actually copy-pastes: the one that STARTS with the
    // command. Prose inside the same fence stays exempt.
    const body = [
      '# Fenced',
      '',
      '```',
      'it prints /spec-build twice',
      '/spec-verify specs/0001-x.md',
      '```',
      '',
    ].join('\n');
    const r = runFixture({ 'docs/fenced.md': body });
    assert.deepEqual(bareErrors(r.stderr, 'docs/fenced.md'),
      ['docs/fenced.md: line 5: bare `/spec-verify` — use `/ml-specs:spec-verify`']);
  });

  test('reports every occurrence on a fenced command line', () => {
    // AC6. Per-occurrence reporting holds inside a fence too: once the line is in scope, every
    // reference on it is, because every one of them is broken for the reader who pastes it.
    const body = [
      '# Loop',
      '',
      '```',
      '/spec → /spec-review → /spec-advance',
      '```',
      '',
    ].join('\n');
    const r = runFixture({ 'docs/loop.md': body });
    assert.deepEqual(bareErrors(r.stderr, 'docs/loop.md'), [
      'docs/loop.md: line 4: bare `/spec` — use `/ml-specs:spec`',
      'docs/loop.md: line 4: bare `/spec-review` — use `/ml-specs:spec-review`',
      'docs/loop.md: line 4: bare `/spec-advance` — use `/ml-specs:spec-advance`',
    ]);
  });

  test('/spec does not swallow /spec-build', () => {
    // AC6b. Reported per occurrence and by FULL name, so the fix each message suggests is the
    // right one. This pins that BEHAVIOUR only — it does not guard the longest-first sort, which
    // mutation testing showed to be unobservable: alternation backtracks, so the trailing
    // (?![\w-]) alone already rejects `/spec` inside `/spec-build`.
    const r = runFixture({ 'docs/two.md': '# Two\n\nuse `/spec` then `/spec-build`\n' });
    assert.deepEqual(bareErrors(r.stderr, 'docs/two.md'), [
      'docs/two.md: line 3: bare `/spec` — use `/ml-specs:spec`',
      'docs/two.md: line 3: bare `/spec-build` — use `/ml-specs:spec-build`',
    ]);
  });

  test('scans .github and .claude', () => {
    // AC7. Dot-directories are the files a hardcoded top-level list misses — and missing them is
    // the exact defect specs/0001-knowledge-check-dotfile-paths.md exists about.
    const r = runFixture({
      '.github/x.md': '# X\n\nSee `/spec-review`.\n',
      '.claude/y.md': '# Y\n\nSee `/pr`.\n',
    });
    assert.ok(r.stderr.includes('.github/x.md: line 3: bare `/spec-review` — use `/ml-specs:spec-review`'),
      `.github not scanned; stderr was:\n${r.stderr}`);
    assert.ok(r.stderr.includes('.claude/y.md: line 3: bare `/pr` — use `/ml-specs:pr`'),
      `.claude not scanned; stderr was:\n${r.stderr}`);
  });

  test('passes on a tree with no generated knowledge layer', () => {
    // AC8. CLAUDE.md and docs/ are this repo's GENERATED layer and are deliberately uncommitted,
    // so a clean clone has neither. The walker must discover what is there rather than read a
    // fixed list — an ENOENT here would make the gate red on every fresh checkout.
    //
    // The two ENOENTs this fixture always produces are checks 1-2 reporting the manifests the
    // harness deliberately omits; they are scoped out rather than asserted away, because the thing
    // under test is whether the WALKER coped, not whether the fixture was complete.
    const r = runFixture({ 'README.md': '# Clean clone\n\nNothing to see.\n' });
    assert.deepEqual(bareErrors(r.stderr, 'README.md'), []);
    assert.deepEqual(r.stderr.split('\n').filter((l) => l.includes('bare `')), []);
    const walkerEnoent = r.stderr.split('\n')
      .filter((l) => /ENOENT|no such file/.test(l) && /CLAUDE\.md|docs\//.test(l));
    assert.deepEqual(walkerEnoent, [], `walker errored on an absent knowledge layer:\n${r.stderr}`);
  });
});

describe('the rewrite landed everywhere it had to', () => {
  test('specs/ and templates/specs/ stay byte-identical', () => {
    // AC9. These three files exist twice — the repo's own copies and the ones the plugin ships —
    // and NO other gate asserts the pairs stay in sync, so a rewrite that touched one and not the
    // other would be invisible. 27 references live in both places at once.
    for (const name of ['README.md', 'TEMPLATE.md', 'AGENTS.md']) {
      assert.deepEqual(
        readRoot(`specs/${name}`),
        readRoot(`ml-specs/templates/specs/${name}`),
        `specs/${name} and ml-specs/templates/specs/${name} have drifted apart`,
      );
    }
  });

  test('check 3 accepts namespaced descriptions', () => {
    // AC10. Check 3 enforces that both descriptions name every command — the list users see in
    // the marketplace and in /plugin. Namespacing them would have failed it outright, so the
    // regex was widened to accept either form. Asserted on the real validator, plus the shape of
    // the descriptions themselves so a silent revert to the bare form is caught too.
    const commandNames = readdirSync(join(PLUGIN, 'commands'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''));

    for (const rel of ['ml-specs/.claude-plugin/plugin.json', '.claude-plugin/marketplace.json']) {
      const desc = JSON.parse(readRoot(rel));
      const text = rel.endsWith('marketplace.json')
        ? desc.plugins.find((p) => p.name === 'ml-specs').description
        : desc.description;
      for (const name of commandNames) {
        assert.match(text, new RegExp(`/ml-specs:${name}(?![\\w-])`),
          `${rel} must name /ml-specs:${name} — the description is the command list users see`);
      }
    }

    const r = runValidator();
    const offending = `${r.stdout}${r.stderr}`.split('\n').filter((l) => l.includes('description does not list'));
    assert.deepEqual(offending, [], `check 3 rejected the namespaced descriptions:\n${offending.join('\n')}`);
  });
});
