// What is wired here, and what a host would need. Spec 0037.
//
// `0028` built a host registry and an installer, and `ml-specs hosts` reports which hosts are
// present. That answers half a question. The other half — what would it take to wire this repo
// properly — is spread across templates a person has to find and copy.
// `docs/architecture/templates.md` records that no command copies two of the CI ones at all:
// "manual, referenced generically by `ml-specs/commands/repo-doctor.md:36`".
//
// TWO RULES, AND THE SECOND IS THE ONE THAT MATTERS
//
// A REMEDY NAMES SOMETHING THAT EXISTS. A row saying "run /ml-specs:repo-wire" when no such
// command exists is the `--all`-flag defect specs 0025 and 0026 both record: output describing a
// capability that is not there. Every fix is checked.
//
// PRESENCE IS NOT FUNCTION. A CI file sitting in the tree that nobody enabled reads identically to
// one that runs on every pull request. This checks presence, and every row says so — overstating
// that is the `unavailable ≠ pass` failure this toolkit has already written down twice.
//
// A `lib/` module never consoles. It returns rows; the caller prints them.

import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The surfaces a repository can be wired for.
 *
 * DERIVED FROM THE SHIPPED TEMPLATE SET, not written out here. `templateDir` names a directory
 * under `ml-specs/templates/`; a template directory added to the toolkit and not covered by a
 * surface fails `uncovered()` rather than quietly narrowing a report that still reads complete.
 *
 * `checks` is always `'presence'` today. The field exists so a row can say `'function'` when
 * something genuinely verifies one, rather than a reader assuming it already does.
 */
export const SURFACES = Object.freeze([
  {
    id: 'ci-gate',
    templateDir: 'ci',
    what: 'the spec gate in CI',
    look: ['.github/workflows/spec-gate.yml', 'azure-pipelines.yml', '.github/workflows/validate.yml'],
    emit: { github: 'ci/spec-gate.yml', azure: 'ci/azure-pipelines-spec-gate.yml' },
    fix: 'node ml-specs/scripts/spec-wiring.mjs --emit ci --provider github --write <path>',
    checks: 'presence',
  },
  {
    id: 'knowledge-gate',
    templateDir: 'ci',
    what: 'the doc file:line gate',
    look: ['.github/scripts/knowledge-check.mjs', '.github/workflows/knowledge-layer.yml'],
    emit: { github: 'ci/knowledge-layer.yml' },
    fix: 'node ml-specs/scripts/spec-wiring.mjs --emit knowledge --write <path>',
    checks: 'presence',
  },
  {
    id: 'hooks',
    templateDir: 'hooks',
    what: 'the scope guard and secret scan',
    look: ['.claude/settings.json', '.claude/settings.local.json'],
    emit: { any: 'hooks/settings.hooks.example.json' },
    fix: 'node ml-specs/scripts/spec-wiring.mjs --emit hooks --write .claude/settings.json',
    checks: 'presence',
  },
  {
    id: 'mcp',
    templateDir: 'mcp',
    what: 'the MCP server',
    look: ['.mcp.json'],
    emit: { any: 'mcp/.mcp.json' },
    fix: 'node ml-specs/scripts/spec-wiring.mjs --emit mcp --write .mcp.json',
    checks: 'presence',
  },
  {
    id: 'knowledge-layer',
    templateDir: 'docs',
    what: 'the learned knowledge layer',
    look: ['CLAUDE.md', 'docs/PATTERNS.md', 'docs/ARCHITECTURE.md'],
    emit: {},
    fix: '/ml-specs:repo-init',
    checks: 'presence',
  },
  {
    id: 'specs',
    templateDir: 'specs',
    what: 'the spec directory',
    look: ['specs/README.md', 'specs/TEMPLATE.md'],
    emit: {},
    fix: '/ml-specs:repo-init',
    checks: 'presence',
  },
  {
    id: 'line-endings',
    templateDir: null,
    what: 'line-ending normalisation',
    look: ['.gitattributes'],
    emit: { any: 'gitattributes' },
    fix: 'node ml-specs/scripts/spec-wiring.mjs --emit gitattributes --write .gitattributes',
    checks: 'presence',
  },
  {
    id: 'standards',
    templateDir: 'standards',
    what: 'architecture standards',
    look: ['.mlskills.json'],
    emit: { any: 'standards/.mlskills.json' },
    fix: 'set "mlSkills" in .ml-specs.json, or leave it off — absence is a valid state',
    checks: 'presence',
    optional: true,
  },
  {
    id: 'hosts',
    templateDir: null,
    what: 'shims for other agent hosts',
    look: ['.ml-specs.json'],
    emit: {},
    fix: 'npx @mlmcps/ml-specs@1 install --host all',
    checks: 'presence',
    optional: true,
  },
  {
    id: 'handoff',
    templateDir: 'handoff',
    what: 'session handoff notes',
    look: ['.claude/handoff'],
    emit: {},
    fix: '/ml-specs:handoff',
    checks: 'presence',
    optional: true,
  },
]);

/**
 * Template directories no surface covers.
 *
 * AC5: a template directory added to the toolkit and not wired into a surface would leave the
 * report quietly narrower while still reading complete — the drift `validate-plugin.mjs:146-162`
 * already fails the build over for command lists.
 */
export function uncovered(templatesRoot) {
  if (!existsSync(templatesRoot)) return [];
  const dirs = readdirSync(templatesRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const covered = new Set(SURFACES.map((s) => s.templateDir).filter(Boolean));
  return dirs.filter((d) => !covered.has(d));
}

/**
 * One row per surface.
 *
 * @param {string} root
 * @returns {Array<{id, what, present, found, look, fix, checks, optional}>}
 */
export function survey(root = process.cwd()) {
  return SURFACES.map((s) => {
    const found = s.look.filter((p) => existsSync(join(root, p)));
    return {
      id: s.id,
      what: s.what,
      present: found.length > 0,
      found,
      look: s.look,
      fix: s.fix,
      // Every row carries it, so "present" can never be read as "running".
      checks: s.checks,
      optional: Boolean(s.optional),
    };
  });
}

/** Which emitted template a surface and provider resolve to, or null. */
export function emitTarget(id, provider = 'github') {
  const s = SURFACES.find((x) => x.id === id);
  if (!s) return null;
  return s.emit[provider] ?? s.emit.any ?? null;
}

/** Every command or path a row might name as its fix, for the "a remedy exists" check. */
export const fixes = () => SURFACES.map((s) => ({ id: s.id, fix: s.fix }));
