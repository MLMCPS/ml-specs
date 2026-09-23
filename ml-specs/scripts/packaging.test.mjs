// Spec 0028 AC14, AC16 — the published contract.
//
// These are packaging assertions, not install ones, which is why they are not in
// `install.test.mjs`. What they guard is the decision to put the bin on `@mlmcps/ml-specs` — the
// MARKETPLACE package, which people add with `claude plugin marketplace add` rather than
// `npm install`. Every generated shim tells an agent to run `npx @mlmcps/ml-specs <verb>`, so if
// that does not resolve, fifteen hosts receive a confident instruction pointing at nothing.
//
// AC16 therefore RUNS IT. An earlier draft asserted two static facts — the tarball contains the
// file, and `bin` points at it — and concluded that npx resolves. It does not follow: both hold
// for a file with no shebang and no exec bit. The mitigation for a contract decision cannot be a
// sentence that sounds like one.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, statSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE));                       // the repo root
const VALIDATOR = join(ROOT, 'scripts', 'validate-plugin.mjs');
const VALIDATOR_LIB = 'ml-specs/scripts/lib/file-identity.mjs';
const BIN_REL = 'ml-specs/scripts/ml-specs.mjs';

const rootPkg = () => JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

// ── AC14, through the validator's own fixture harness ───────────────────────────────────────

/**
 * The harness at `command-namespace.test.mjs:54-87`, plus the two manifests and the root
 * `package.json`. Those three are not optional: `validate-plugin.mjs:99` guards the whole
 * root-package block behind `plugin && existsSync(ROOT/package.json)`, so a fixture without them
 * exercises none of the checks AC14 is about — it fails for five unrelated reasons and
 * "validation failed" proves nothing.
 */
function runFixture(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ml-specs-pkg-'));
  try {
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    mkdirSync(join(dir, 'ml-specs', 'commands'), { recursive: true });
    mkdirSync(join(dir, 'ml-specs', '.claude-plugin'), { recursive: true });
    mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
    mkdirSync(join(dir, 'ml-specs', 'scripts', 'lib'), { recursive: true });

    copyFileSync(VALIDATOR, join(dir, 'scripts', 'validate-plugin.mjs'));
    // The validator's `lib/` closure, whole. It was one file; spec 0051 made it three
    // (`prompt-shape.mjs` → `text.mjs`), and a per-file list breaks every harness the next time it
    // grows. Copying the directory costs nothing and cannot rot.
    mkdirSync(dirname(join(dir, VALIDATOR_LIB)), { recursive: true });
    for (const f of readdirSync(join(ROOT, dirname(VALIDATOR_LIB)))) {
      if (f.endsWith('.mjs') && !f.endsWith('.test.mjs')) {
        copyFileSync(join(ROOT, dirname(VALIDATOR_LIB), f), join(dir, dirname(VALIDATOR_LIB), f));
      }
    }

    // Three more the validator checks unconditionally. Without them the clean fixture fails for
    // reasons that have nothing to do with AC14, and every negative case below would "pass" on
    // the same unrelated errors — which is the trap this file's header is about.
    const knowledge = '#!/usr/bin/env node\n// fixture copy\n';
    for (const rel of ['.github/scripts/knowledge-check.mjs', 'ml-specs/templates/ci/knowledge-check.mjs']) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), knowledge);
    }
    for (const name of ['spec-advance.mjs', 'fix-specs.mjs']) {
      writeFileSync(join(dir, 'ml-specs', 'scripts', name), '// fixture: the only status writers\n');
    }

    const commands = overrides.commands ?? ['spec', 'repo-hosts'];
    for (const name of commands) {
      writeFileSync(join(dir, 'ml-specs', 'commands', `${name}.md`),
        `---\ndescription: fixture\nargument-hint: <arg>\n---\n\nFixture body. Delegates to no agent on purpose; next: /ml-specs:${name}\n`);
    }
    const description = overrides.description
      ?? commands.map((c) => `/ml-specs:${c}`).join(', ') + '.';

    writeFileSync(join(dir, 'ml-specs', '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'ml-specs', version: '1.2.0', description }, null, 2));
    writeFileSync(join(dir, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({ name: 'ml-tools', owner: { name: 'x' },
        plugins: [{ name: 'ml-specs', source: './ml-specs', version: '1.2.0', description }] }, null, 2));

    const pkg = {
      name: '@mlmcps/ml-specs',
      version: '1.2.0',
      bin: overrides.bin ?? { 'ml-specs': BIN_REL },
      files: overrides.files ?? ['.claude-plugin/', 'ml-specs/'],
    };
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2));

    if (overrides.bin !== null) {
      const target = join(dir, Object.values(pkg.bin)[0]);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, '#!/usr/bin/env node\n', { mode: overrides.mode ?? 0o755 });
      if (overrides.missingTarget) rmSync(target);
    }

    try {
      const stdout = execFileSync('node', [join(dir, 'scripts', 'validate-plugin.mjs')],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { code: 0, stdout, stderr: '' };
    } catch (e) {
      return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Errors as bare lines, so an assertion names the message rather than the exit code. */
const errors = (r) => `${r.stdout}\n${r.stderr}`.split('\n')
  .filter((l) => /^\s*error\s/.test(l))
  .map((l) => l.replace(/^\s*error\s+/, '').trim());

describe('AC14 — the validator guards the published contract', () => {
  test('the fixture passes when everything is right — or the negatives prove nothing', () => {
    const r = runFixture();
    assert.equal(r.code, 0, `the clean fixture failed, so every assertion below is meaningless:\n${errors(r).join('\n')}`);
  });

  test('a bin pointing at a missing file is an error, by message', () => {
    const r = runFixture({ missingTarget: true });
    assert.notEqual(r.code, 0);
    assert.ok(errors(r).some((e) => e.includes('bin points at missing')),
      `wrong error — got:\n${errors(r).join('\n')}`);
  });

  test('a bin target without the exec bit is an error, by message', () => {
    const r = runFixture({ mode: 0o644 });
    assert.notEqual(r.code, 0);
    assert.ok(errors(r).some((e) => e.includes('not executable')),
      `wrong error — got:\n${errors(r).join('\n')}`);
  });

  test('files[] is pinned to equality, so a NARROWING fails too', () => {
    // The old check was an allowlist: it caught a widening and not a narrowing. Drop `ml-specs/`
    // and the tarball still validated while every `npx` the shims name stopped resolving.
    const narrowed = runFixture({ files: ['.claude-plugin/'] });
    assert.ok(errors(narrowed).some((e) => e.includes('files[] must be exactly')),
      `a narrowed files[] passed — got:\n${errors(narrowed).join('\n')}`);

    const widened = runFixture({ files: ['.claude-plugin/', 'ml-specs/', 'scripts/'] });
    assert.ok(errors(widened).some((e) => e.includes('files[] must be exactly')),
      'a widened files[] passed — it is a disclosure boundary');
  });

  test('a command missing from a manifest description is an error', () => {
    const r = runFixture({ description: '/ml-specs:spec.' });   // repo-hosts exists but is unlisted
    assert.notEqual(r.code, 0);
    assert.ok(errors(r).some((e) => e.includes('/repo-hosts')),
      `the unlisted command was not named — got:\n${errors(r).join('\n')}`);
  });
});

describe('AC14 — and the real repo satisfies it', () => {
  test('files[] is exactly the two entries, and the bin lives inside one of them', () => {
    const pkg = rootPkg();
    assert.deepEqual(pkg.files, ['.claude-plugin/', 'ml-specs/']);
    assert.equal(pkg.bin['ml-specs'], BIN_REL);
    assert.ok(BIN_REL.startsWith('ml-specs/'), 'the bin is outside files[] — it would not be published');
  });
});

// ── AC16, executed ───────────────────────────────────────────────────────────────────────────

describe('AC16 — npx resolves the bin', () => {
  test('the committed file is executable and carries a shebang', () => {
    // Kept SEPARATE from the install below on purpose: npm chmods the bin link when it installs,
    // so a green run does not prove the committed mode. Only this does.
    const abs = join(ROOT, BIN_REL);
    assert.ok(statSync(abs).mode & 0o111, `${BIN_REL} is not executable — npx will fail`);
    assert.equal(readFileSync(abs, 'utf8').split('\n')[0], '#!/usr/bin/env node',
      'no shebang — npm reads it to build the shim');
  });

  test('pack, install offline, and run it', { timeout: 300_000 }, (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'ml-specs-npx-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));

    // `--offline --no-audit --no-fund`: the tarball is local, and without the audit and funding
    // suppressions npm contacts the registry. §4.4 says no process here reaches the network.
    const packed = execFileSync('npm', ['pack', '--pack-destination', dir, '--silent'],
      { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').pop();
    const tarball = join(dir, packed);
    assert.ok(existsSync(tarball), `npm pack produced nothing at ${tarball}`);

    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'consumer', private: true }));
    execFileSync('npm', ['install', tarball, '--offline', '--no-audit', '--no-fund', '--silent'],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

    const shim = join(dir, 'node_modules', '.bin', 'ml-specs');
    assert.ok(existsSync(shim), 'npm installed the package but created no ml-specs bin link');

    const out = execFileSync(shim, ['hosts', '--json'], { cwd: dir, encoding: 'utf8' });
    const parsed = JSON.parse(out);
    assert.ok(Array.isArray(parsed.hosts) && parsed.hosts.length > 0,
      'the installed bin ran but produced no host list');
    assert.ok(parsed.hosts.some((h) => h.id === 'claude-code'));
  });
});
