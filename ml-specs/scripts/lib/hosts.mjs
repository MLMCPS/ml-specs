// The host registry — the only file in this toolkit that knows a vendor name.
//
// Hosts differ in two ways, and conflating them is what makes a "multi-host" toolkit work
// properly only in the host its author uses:
//
//   1. WHERE they look      — a path. Trivial.
//   2. WHAT SHAPE they read — a skill directory, a rules directory, or one instructions file.
//                             The same content has to be framed three ways. `adapters.mjs` does it.
//
// `verified` is an honesty flag and it is `false` on fifteen of sixteen rows on purpose. `true`
// means the install was ACTUALLY EXERCISED in that host and the files were observed to load;
// `false` means the path and format are believed correct from vendor documentation and nobody has
// run it. A registry claiming all sixteen were verified would be worth less than one that admits
// which. `verifiedBy` records HOW, because a boolean nobody can audit is the kind of claim this
// toolkit spends its design refusing — which is why `verified: true` without one is a test failure
// (spec 0028 AC2) rather than a convention.
//
// `mechanisms` is REPORT DATA, not a permission table. An earlier draft used it to gate the
// forbidden-token scan per host, which was wrong twice over: it modelled what a HOST can do when
// what matters is what an INSTALLED FILE can rely on. `${CLAUDE_PLUGIN_ROOT}` is bound by the
// Claude Code runtime for plugin-shipped files only (`docs/ARCHITECTURE.md:35`), so a skill file
// this installer writes into `.claude/skills/` would never expand it — `pluginRoot: true` would
// have had the scan bless a token that is dead in the one verified host. Since `claude-code` is
// `servedBy: 'plugin'` and gets no shim at all, every file we generate is host-neutral with no
// exceptions, and the scan is one rule. What `mechanisms` is still good for is telling a reader
// "this host has no subagents" instead of handing them files it will never load.

import { homedir } from 'node:os';
import { join } from 'node:path';

export const FORMATS = {
  SKILL_DIR: 'skill-dir',     // one directory per skill, SKILL.md inside — the richest form
  RULES_DIR: 'rules-dir',     // one flat file per skill in a rules folder
  SINGLE_FILE: 'single-file', // one instructions document
};

/** Nothing an installed file can rely on. Fifteen of the sixteen rows are this. */
const NONE = Object.freeze({ subagents: false, slashCommands: false, hooks: false, pluginRoot: false });

/**
 * @typedef {object} Host
 * @property {string} name
 * @property {string} vendor
 * @property {string} format          one of FORMATS
 * @property {string} project         install target, relative to the repo root
 * @property {(env?: object) => string|null} user  where a user-scope install lands, or null
 * @property {string} [ext]           file extension for RULES_DIR hosts
 * @property {{bin: string|null, dirs: string[]}} detect
 * @property {typeof NONE} mechanisms
 * @property {'plugin'} [servedBy]    present => the installer writes nothing for this host
 * @property {boolean} verified
 * @property {string} [verifiedBy]    required exactly when verified is true
 * @property {string} [notes]
 */

/**
 * `user` takes an env so tests can inject a home. Reading `process.env` at call time rather than
 * closing over `homedir()` at module load is the whole reason a test suite can exercise user scope
 * without writing into a developer's actual home directory — see spec 0028 AC15.
 */
const home = (env) => (env && env.HOME) || homedir();

/** @type {Record<string, Host>} */
export const HOSTS = {
  'claude-code': {
    name: 'Claude Code',
    vendor: 'Anthropic',
    format: FORMATS.SKILL_DIR,
    project: '.claude/skills',
    user: (env) => join(home(env), '.claude', 'skills'),
    detect: { bin: 'claude', dirs: ['.claude'] },
    // The one row where these are true — and it is also the row the installer skips, which is not
    // a contradiction: the mechanisms exist because the MARKETPLACE PLUGIN supplies them, not
    // because a file we wrote could use them.
    mechanisms: { subagents: true, slashCommands: true, hooks: true, pluginRoot: true },
    // A Claude Code user adds the marketplace and gets 24 commands, 10 agents and the hooks. A
    // shim would be a worse copy of what they already have, and writing one would force every
    // generated file to carry a per-host exception. Skipping it is what makes the rest of this
    // registry simple.
    servedBy: 'plugin',
    verified: true,
    verifiedBy:
      'the plugin is installed from the ml-tools marketplace in this repository and its commands, '
      + 'agents and hooks are exercised by the suite on every run',
  },
  codex: {
    name: 'Codex CLI',
    vendor: 'OpenAI',
    format: FORMATS.SKILL_DIR,
    project: '.agents/skills',
    user: (env) => join(home(env), '.agents', 'skills'),
    detect: { bin: 'codex', dirs: ['.codex', '.agents'] },
    mechanisms: NONE,
    verified: false,
    notes: 'path and format from Codex docs; not exercised here',
  },
  cursor: {
    name: 'Cursor',
    vendor: 'Anysphere',
    format: FORMATS.RULES_DIR,
    project: '.cursor/rules',
    user: (env) => join(home(env), '.cursor', 'rules'),
    ext: '.mdc',
    detect: { bin: 'cursor-agent', dirs: ['.cursor'] },
    mechanisms: NONE,
    verified: false,
    notes: 'MDC frontmatter (description + alwaysApply); path and format from Cursor docs',
  },
  copilot: {
    name: 'GitHub Copilot',
    vendor: 'GitHub',
    format: FORMATS.SINGLE_FILE,
    project: '.github/copilot-instructions.md',
    user: () => null,
    detect: { bin: 'copilot', dirs: ['.github'] },
    mechanisms: NONE,
    verified: false,
    notes: 'path from GitHub docs; not exercised here',
  },
  antigravity: {
    name: 'Antigravity',
    vendor: 'Google',
    format: FORMATS.SINGLE_FILE,
    project: 'AGENTS.md',
    user: () => null,
    detect: { bin: 'agy', dirs: [] },
    mechanisms: NONE,
    verified: false,
  },
  windsurf: {
    name: 'Windsurf',
    vendor: 'Codeium',
    format: FORMATS.RULES_DIR,
    project: '.windsurf/rules',
    user: (env) => join(home(env), '.codeium', 'windsurf', 'memories'),
    detect: { bin: 'windsurf', dirs: ['.windsurf'] },
    mechanisms: NONE,
    verified: false,
  },
  cline: {
    name: 'Cline',
    vendor: 'Cline',
    format: FORMATS.RULES_DIR,
    project: '.clinerules',
    user: (env) => join(home(env), 'Documents', 'Cline', 'Rules'),
    detect: { bin: null, dirs: ['.clinerules'] },
    mechanisms: NONE,
    verified: false,
  },
  roo: {
    name: 'Roo Code',
    vendor: 'Roo',
    format: FORMATS.RULES_DIR,
    project: '.roo/rules',
    user: (env) => join(home(env), '.roo', 'rules'),
    detect: { bin: null, dirs: ['.roo'] },
    mechanisms: NONE,
    verified: false,
  },
  kilo: {
    name: 'Kilo Code',
    vendor: 'Kilo',
    format: FORMATS.RULES_DIR,
    project: '.kilocode/rules',
    user: (env) => join(home(env), '.kilocode', 'rules'),
    detect: { bin: null, dirs: ['.kilocode'] },
    mechanisms: NONE,
    verified: false,
  },
  'gemini-cli': {
    name: 'Gemini CLI',
    vendor: 'Google',
    format: FORMATS.SINGLE_FILE,
    project: 'GEMINI.md',
    user: (env) => join(home(env), '.gemini'),
    detect: { bin: 'gemini', dirs: ['.gemini'] },
    mechanisms: NONE,
    verified: false,
  },
  continue: {
    name: 'Continue',
    vendor: 'Continue',
    format: FORMATS.RULES_DIR,
    project: '.continue/rules',
    user: (env) => join(home(env), '.continue', 'rules'),
    detect: { bin: 'cn', dirs: ['.continue'] },
    mechanisms: NONE,
    verified: false,
  },
  zed: {
    name: 'Zed',
    vendor: 'Zed Industries',
    format: FORMATS.SINGLE_FILE,
    project: 'AGENTS.md',
    user: () => null,
    detect: { bin: 'zed', dirs: ['.zed'] },
    mechanisms: NONE,
    verified: false,
  },
  amp: {
    name: 'Amp',
    vendor: 'Sourcegraph',
    format: FORMATS.SINGLE_FILE,
    project: 'AGENTS.md',
    user: () => null,
    detect: { bin: 'amp', dirs: [] },
    mechanisms: NONE,
    verified: false,
  },
  opencode: {
    name: 'OpenCode',
    vendor: 'OpenCode',
    format: FORMATS.SINGLE_FILE,
    project: 'AGENTS.md',
    user: () => null,
    detect: { bin: 'opencode', dirs: ['.opencode'] },
    mechanisms: NONE,
    verified: false,
  },
  aider: {
    name: 'Aider',
    vendor: 'Aider',
    format: FORMATS.SINGLE_FILE,
    project: 'CONVENTIONS.md',
    user: () => null,
    detect: { bin: 'aider', dirs: [] },
    mechanisms: NONE,
    verified: false,
  },
  generic: {
    name: 'Generic Markdown-first agent',
    vendor: '—',
    format: FORMATS.SINGLE_FILE,
    project: 'AGENTS.md',
    user: () => null,
    detect: { bin: null, dirs: [] },
    mechanisms: NONE,
    verified: false,
    notes: 'the fallback every host understands',
  },
};

export const hostIds = () => Object.keys(HOSTS);

/**
 * Does installing this host warrant a warning?
 *
 * A one-line predicate with a name, because inline in the CLI it had no sensor that could fail:
 * every host the installer writes for is unverified today (the one verified row is served by the
 * plugin and never installed), so making the warning unconditional changed no observable output.
 * As a function, both directions are testable against a fixture row.
 */
export const needsVerificationWarning = (host) => !host.verified;

/** Hosts the installer actually writes for — everything without a `servedBy`. */
export const installableIds = () => hostIds().filter((id) => !HOSTS[id].servedBy);

/**
 * @param {string} id
 * @returns {Host & {id: string}}
 * @throws {Error & {code: 'ENOHOST'}} a typo is a usage problem; the CALLER turns this into exit 2
 *   with a sentence. A `lib/` module never consoles and never calls `process.exit` — see
 *   `docs/PATTERNS.md`.
 */
export function resolveHost(id) {
  // `Object.hasOwn`, not truthiness: `HOSTS['constructor']` and `HOSTS['__proto__']` are truthy
  // through the prototype chain, so the guard passed and `join()` was handed a function — a raw
  // ERR_INVALID_ARG_TYPE stack on exit 1, where the convention says an unusable argument is 2.
  const host = Object.hasOwn(HOSTS, id) ? HOSTS[id] : undefined;
  if (!host) {
    const e = new Error(`unknown host '${id}' — known: ${hostIds().join(', ')}`);
    e.code = 'ENOHOST';
    throw e;
  }
  return { id, ...host };
}

/**
 * Where an install lands. Returns null when the host has no such scope — the caller decides
 * whether that is a refusal or a skip.
 *
 * @param {string} id
 * @param {'project'|'user'} scope
 * @param {string} root
 * @param {object} [env] injected environment, so a test never resolves the real HOME
 */
export function installTarget(id, scope, root, env) {
  const host = resolveHost(id);
  if (scope === 'user') return host.user(env) ?? null;
  return join(root, host.project);
}

/**
 * Hosts whose project target is the same file — five of them resolve to `AGENTS.md`. The installer
 * writes it once and SAYS which hosts share it, rather than letting the last id in the list
 * silently win. The caller derives its count from this map; nothing hardcodes "five".
 *
 * @returns {Map<string, string[]>} resolved path → the ids that want it
 */
export function sharedTargets(ids, root, scope = 'project', env) {
  const byTarget = new Map();
  for (const id of ids) {
    const target = installTarget(id, scope, root, env);
    if (!target) continue;
    if (!byTarget.has(target)) byTarget.set(target, []);
    byTarget.get(target).push(id);
  }
  return byTarget;
}
