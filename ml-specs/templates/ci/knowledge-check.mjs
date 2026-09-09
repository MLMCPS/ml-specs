#!/usr/bin/env node
// Knowledge-layer checks — seeded into a repo by /repo-init (ml-specs).
// Pure Node, no dependencies.
//
//   CLI:    node .github/scripts/knowledge-check.mjs [--base <ref>] [--warn-only] [--root <dir>]
//   Module: import { runChecks } from './knowledge-check.mjs'   (used by the MCP server)
//
// This is the MECHANICAL half of /repo-doctor: the checks that need no judgment and so can
// run in CI on every PR. It does not read code for meaning — it verifies that what the docs
// claim about the repo is still literally true.
//
//   /repo-doctor  = judgment, run by a human on demand ("is this pattern still how we work?")
//   this script  = facts, run by CI on every PR   ("does docs/PATTERNS.md:42 still exist?")
//
// Exit 1 on errors (a doc asserts something false). Warnings never fail the build.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

// The knowledge layer, in load order. Missing files are fine — not every repo shards.
const DOC_FILES = ['CLAUDE.md', 'docs/PATTERNS.md', 'docs/ARCHITECTURE.md', 'docs/ESTATE.md'];
const DOC_DIRS = ['docs/architecture', 'docs/patterns'];

// A `file:line` reference is only a reference if the path looks like a real repo path.
// Without this, "example.com:443" and "spring-boot:2.0" become false positives.
const SOURCE_EXT = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'java', 'kt', 'scala', 'py', 'go', 'rb', 'rs',
  'cs', 'php', 'swift', 'sql', 'yml', 'yaml', 'json', 'xml', 'sh', 'md', 'tf', 'gradle',
  'properties', 'toml', 'vue', 'svelte',
]);

const REF = /(?<![\w:/])([A-Za-z0-9_][\w./-]*\.[A-Za-z0-9]+):(\d+)(?:-(\d+))?\b/g;

/**
 * Run the knowledge-layer checks. Pure: returns findings, never logs or exits.
 * @param {{root?: string, base?: string|null}} opts
 */
export function runChecks({ root = process.cwd(), base = null } = {}) {
  const errors = [];
  const warnings = [];
  const err = (where, msg) => errors.push({ where, msg });
  const warn = (where, msg) => warnings.push({ where, msg });

  const abs = (p) => join(root, p);
  const has = (p) => existsSync(abs(p));
  const git = (...a) => {
    try {
      return execFileSync('git', ['-C', root, ...a], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return '';
    }
  };

  const docs = DOC_FILES.filter(has);
  for (const dir of DOC_DIRS) {
    if (!has(dir)) continue;
    for (const f of readdirSync(abs(dir))) {
      if (f.endsWith('.md')) docs.push(`${dir}/${f}`);
    }
  }

  if (docs.length === 0) {
    return { docs: [], refsChecked: 0, errors, warnings, empty: true };
  }

  const lineCount = (p) => readFileSync(abs(p), 'utf8').split('\n').length;
  let refsChecked = 0;

  for (const doc of docs) {
    const text = readFileSync(abs(doc), 'utf8');

    // 1. file:line references still resolve.
    for (const m of text.matchAll(REF)) {
      const [, path, startStr, endStr] = m;
      const ext = path.split('.').pop().toLowerCase();
      if (!path.includes('/') && !SOURCE_EXT.has(ext)) continue;
      if (path.startsWith('http')) continue;

      refsChecked++;
      if (!has(path)) {
        err(doc, `references ${path}:${startStr}, but ${path} does not exist`);
        continue;
      }
      const total = lineCount(path);
      const line = Number(endStr || startStr);
      if (line > total) {
        err(doc, `references ${path}:${startStr}${endStr ? '-' + endStr : ''}, but that file is only ${total} lines`);
      }
    }

    // 2. Relative markdown links resolve (router → shard is the one that breaks silently).
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const href = m[1];
      if (/^(https?:|mailto:|#)/.test(href)) continue;
      if (!existsSync(join(dirname(abs(doc)), href.split('#')[0]))) {
        err(doc, `broken link: ${href}`);
      }
    }

    // 3. Budget. These load into context on every task; bloat is a real cost, not a style nit.
    const lines = text.split('\n').length;
    const budget = doc === 'CLAUDE.md' ? 200 : 250;
    if (lines > budget) {
      warn(doc, `${lines} lines, over the ~${budget}-line budget — trim it (/repo-refresh prunes)`);
    }
  }

  // 4. Every shard is reachable from the router, and vice versa.
  if (has('docs/ARCHITECTURE.md') && has('docs/architecture')) {
    const router = readFileSync(abs('docs/ARCHITECTURE.md'), 'utf8');
    for (const f of readdirSync(abs('docs/architecture'))) {
      if (!f.endsWith('.md') || f.startsWith('_')) continue;
      if (!router.includes(f)) {
        warn('docs/ARCHITECTURE.md', `no router row links to docs/architecture/${f} — it will never be loaded`);
      }
    }
  }

  // 5. Advisory: source moved, docs didn't. Not an error — plenty of changes need no doc update.
  if (base) {
    const changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
    if (changed.length) {
      const docSet = new Set(docs);
      const touchedDocs = changed.filter((f) => docSet.has(f));
      const touchedSource = changed.filter(
        (f) => !docSet.has(f) && !f.endsWith('.md') && !f.startsWith('docs/'),
      );
      if (touchedSource.length > 0 && touchedDocs.length === 0) {
        warn(
          'knowledge layer',
          `${touchedSource.length} source file(s) changed and no knowledge doc did — ` +
          'if this PR moved an endpoint, listener, external client, or data-access flavor, run /repo-refresh',
        );
      }
    }
  }

  return { docs, refsChecked, errors, warnings, empty: false };
}

// CLI ------------------------------------------------------------------------
// Only runs when invoked directly, so importing this module stays silent — an MCP server
// speaks JSON-RPC on stdout and a stray console.log corrupts the stream.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? null : args[i + 1];
  };
  const result = runChecks({ root: flag('--root') || process.cwd(), base: flag('--base') });

  if (result.empty) {
    console.log('knowledge-check: no knowledge layer found (CLAUDE.md / docs/) — nothing to check.');
    console.log('Run /repo-init to create one, or delete this check.');
    process.exit(0);
  }

  for (const w of result.warnings) console.log(`  warning  ${w.where}: ${w.msg}`);
  for (const e of result.errors) console.error(`  error    ${e.where}: ${e.msg}`);

  const summary = `${result.refsChecked} file:line reference(s) across ${result.docs.length} doc(s)`;
  if (result.errors.length) {
    console.error(`\n✗ knowledge layer is stale: ${result.errors.length} error(s), ${result.warnings.length} warning(s) — ${summary}`);
    console.error('  These are facts the docs assert that are no longer true. Run /repo-refresh to fix,');
    console.error('  or correct the references by hand. A doc that points at deleted code is worse than none.');
    if (!args.includes('--warn-only')) process.exit(1);
    console.error('  (--warn-only: not failing the build)');
  } else {
    console.log(`✓ knowledge layer checks out — ${summary}, ${result.warnings.length} warning(s)`);
  }
}
