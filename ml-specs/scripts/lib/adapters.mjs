// Turning one host-neutral document into the shapes agent hosts actually read — and refusing to
// write anything that lies to them.
//
// TWO INVARIANTS, AND THEY GUARD DIFFERENT THINGS
//
// An earlier draft of spec 0028 had one invariant doing both jobs, borrowed from a toolkit that
// renders full skill bodies into every host. That demanded every paragraph of the canonical
// document appear in every rendering — which is sixteen full copies, the opposite of the thin shim
// this design is built on. The invariant came with the model it was written for. So:
//
//   1. The CANONICAL DOCUMENT must survive template → written file intact. Every paragraph.
//      `buildCanonical` + AC3.
//   2. Each SHIM must carry a resolving pointer and the bin command. Nothing more — it is three
//      dozen lines whose whole job is to send the agent to the document. `render` + AC11.
//
// WHY THE SCAN EXISTS
//
// The dominant risk here is not a bug. It is writing a file that looks right and tells an agent to
// use a mechanism its host does not have: `${CLAUDE_PLUGIN_ROOT}`, a `/ml-specs:` slash command, a
// subagent, a hook. That is silent at install time and surfaces as an agent quietly doing the
// wrong thing. `forbidden()` is the sensor, and `install` refuses rather than writing.
//
// WHAT THE SCAN DOES NOT COVER, SAID OUT LOUD
//
// It is a token scan with a proximity rule, not a semantic analyser. "ask the subagent to build
// it", with no agent name in it, is not caught. That is the accepted cost of not banning six
// ordinary English words — `developer`, `reviewer`, `coder`, `analyst`, `scanner`, `explainer` are
// all agent names AND normal prose, and pinning wording pressures people into writing worse prose
// to appease a test (`mlskills-flag-wiring.test.mjs:10-13`, `command-closing-actions.test.mjs:9-14`,
// and `validate-plugin.mjs:251-257` which uses `warn` over this same token class for the reason).
// Spec 0028 §7 carries the hole as a risk and §8 carries closing it as follow-up.

/** The shim contract version. Bumping it re-writes every installed shim; the package version does not. */
export const SHIM_VERSION = 1;

/** The verbs the bin parses. Exported so the scan can check a shim only names real ones (AC10). */
export const VERBS = ['gate', 'evidence', 'why', 'hosts', 'install', 'new', 'check', 'changelog'];

/**
 * How a shim names the tool. Not a bare `ml-specs` — see spec 0028 §4.1 on reachability.
 *
 * PINNED TO A MAJOR. Unpinned, every first use in a fresh environment fetches and executes
 * whatever is currently published, and the only trust anchor is ownership of the `@mlmcps` scope.
 * A major pin still takes fixes and cannot silently take a breaking change. `packaging.test.mjs`
 * asserts this major matches the root package's, so the two cannot drift.
 *
 * It BOUNDS the blast radius; it does not make the fetch trusted. Any compromised 1.x publish
 * still executes on first use — `npx` carries no lockfile and no integrity hash in this
 * position. That is the standing trade for a shim that must keep taking patches.
 */
export const PINNED_MAJOR = 1;
export const INVOCATION = `npx @mlmcps/ml-specs@${PINNED_MAJOR}`;

export const banner = () =>
  `<!-- ml-specs install v${SHIM_VERSION} — do not edit; edit ML-SPECS.md -->`;

/**
 * The one line that joins a shim to the document. Pinned to the byte, like the banner: an earlier
 * draft said "the path every shim points at exists on disk" and defined no syntax, so an extractor
 * that found no pointers made `every` vacuously true.
 */
export function pointerLine(path) {
  // The pointer is the ONE value that reaches a generated file from outside this package — under
  // `--scope user` it is an absolute path built from `HOME`. Interpolated raw, a home directory
  // containing a newline injects a second, syntactically valid pointer line that `forbidden()`
  // passes (it holds none of the five tokens) and that falsifies "exactly one pointer" on real
  // input. Refuse the shape rather than sanitising it: a path with a newline or a backtick in it
  // is not a path anyone meant.
  if (/[\n\r`]/.test(path)) {
    const e = new Error(`refusing to build a pointer from a path containing a newline or backtick: ${JSON.stringify(path)}`);
    e.code = 'EBADPOINTER';
    throw e;
  }
  return `ml-specs: read \`${path}\` and follow it.`;
}

/** Recover the path from a pointer line. Returns every match, so AC11 can require exactly one. */
export function pointers(text) {
  return [...text.matchAll(/^ml-specs: read `([^`]+)` and follow it\.$/gm)].map((m) => m[1]);
}

/** Split `---\nfrontmatter\n---\nbody` without a YAML parser. */
export function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text.trim() };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: m[2].trim() };
}

/**
 * The canonical document, from its template. This is the step `render` does not do — `render`
 * takes the finished text.
 *
 * Today it is a passthrough of the body with frontmatter stripped. It is a named function anyway,
 * because H3 says the document is BUILT from a template and a passthrough that is never called a
 * build is where a substitution step gets added later without anyone re-reading AC3.
 *
 * @param {string} templateText
 * @returns {string}
 */
export function buildCanonical(templateText) {
  const { body } = splitFrontmatter(templateText);
  // The banner goes on the document too, not just the shims. It is a generated file like any
  // other, and without it `classify()` cannot tell this tool's own output from a document
  // somebody wrote by hand — which meant the overwrite guard read every re-install as foreign.
  return `${banner()}\n\n${body.trim()}\n`;
}

/** Paragraphs, for AC3's every-paragraph-survives check. Blank-line separated, whitespace-normalised. */
export const paragraphs = (text) =>
  text.split(/\n\s*\n/).map((p) => p.trim().replace(/\s+/g, ' ')).filter((p) => p.length > 0);

const HEADER = (pointer) => [
  banner(),
  '',
  '# ml-specs — spec-driven development',
  '',
  pointerLine(pointer),
  '',
  'That document is the loop. The gates are a command, not a suggestion: run them and read the',
  'exit code. Do not report that a gate passed without running it — the exit code is the evidence,',
  'not your recollection.',
  '',
  '| Command | Answers |',
  '|---|---|',
  `| \`${INVOCATION} gate <spec> [--to <Status>]\` | may this spec advance? 0 ok · 1 a finding · 2 could not run |`,
  `| \`${INVOCATION} evidence\` | do the gates that already passed still describe this tree? |`,
  `| \`${INVOCATION} why <spec>\` | why can this one not advance? |`,
  `| \`${INVOCATION} hosts\` | which agent hosts are set up here |`,
  '',
  'Not installed? `npm i -g @mlmcps/ml-specs`, or let `npx` fetch it on first use.',
].join('\n');

/**
 * Render the shim for one host. PURE — a function of (doc, host) and nothing else, so the same
 * inputs give the same bytes on every machine.
 *
 * @param {{pointer: string}} doc  where the canonical document sits, as this host should see it
 * @param {import('./hosts.mjs').Host & {id: string}} host
 * @returns {Array<{path: string, contents: string}>} paths relative to the install target;
 *   `''` means the target file itself
 */
export function render(doc, host) {
  const body = `${HEADER(doc.pointer)}\n`;

  switch (host.format) {
    case 'skill-dir':
      return [{
        path: 'ml-specs/SKILL.md',
        contents: `---\nname: ml-specs\ndescription: Spec-driven development — the gates are a command, not a prompt\n---\n\n${body}`,
      }];

    case 'rules-dir':
      // Cursor reads MDC frontmatter; the other rules-dir hosts ignore keys they do not know, so
      // one shape serves all five rather than a per-host special case.
      return [{
        path: `ml-specs${host.ext || '.md'}`,
        contents: `---\ndescription: Spec-driven development — the gates are a command, not a prompt\nalwaysApply: false\n---\n\n${body}`,
      }];

    case 'single-file':
      return [{ path: '', contents: body }];

    default: {
      const e = new Error(`unknown host format '${host.format}' for '${host.id}'`);
      e.code = 'ENOFORMAT';
      throw e;
    }
  }
}

// ── the scan ────────────────────────────────────────────────────────────────────────────────

const WORD = /[A-Za-z][\w-]*/g;
const DISPATCH = new Set(['agent', 'agents', 'subagent', 'subagents']);

/**
 * An agent name within 3 words of `agent`/`subagent` — dispatch-shaped, rather than the bare word.
 * "ask the developer subagent to build it" is caught; "the developer implements it" is not.
 */
function dispatchShaped(text, agentNames) {
  const names = new Set(agentNames.map((n) => n.toLowerCase()));
  const tokens = [...text.matchAll(WORD)].map((m) => m[0].toLowerCase());
  for (let i = 0; i < tokens.length; i++) {
    if (!names.has(tokens[i])) continue;
    const lo = Math.max(0, i - 3);
    const hi = Math.min(tokens.length - 1, i + 3);
    for (let j = lo; j <= hi; j++) {
      if (j !== i && DISPATCH.has(tokens[j])) return tokens[i];
    }
  }
  return null;
}

/**
 * Everything a generated file may not say. One rule for every file — there is no per-host
 * exception, because `claude-code` is served by the plugin and gets no shim, so nothing we write
 * has any mechanism to rely on.
 *
 * @param {string} text
 * @param {string[]} agentNames  read from `ml-specs/agents/` by the caller, so this stays pure
 * @returns {Array<{rule: string, found: string, line: number}>} empty means clean
 */
export function forbidden(text, agentNames = []) {
  const out = [];
  const lines = text.split('\n');
  const at = (needle) => lines.findIndex((l) => l.includes(needle)) + 1;

  if (text.includes('${CLAUDE_PLUGIN_ROOT}')) {
    out.push({ rule: 'plugin-root', found: '${CLAUDE_PLUGIN_ROOT}', line: at('${CLAUDE_PLUGIN_ROOT}') });
  }
  if (text.includes('$ARGUMENTS')) {
    out.push({ rule: 'arguments', found: '$ARGUMENTS', line: at('$ARGUMENTS') });
  }
  const slash = text.match(/\/ml-specs:[\w-]+/);
  if (slash) out.push({ rule: 'slash-command', found: slash[0], line: at(slash[0]) });

  const hook = text.match(/SessionStart|PreToolUse|PostToolUse|hooks\.json/);
  if (hook) out.push({ rule: 'hook', found: hook[0], line: at(hook[0]) });

  const agent = dispatchShaped(text, agentNames);
  if (agent) out.push({ rule: 'subagent-dispatch', found: agent, line: at(agent) });

  // Structural, not a token: a file telling an agent to read two different documents is a file
  // one of whose instructions nobody wrote. `pointerLine` refuses to BUILD one; this catches a
  // second arriving any other way.
  const found = pointers(text);
  if (found.length > 1) {
    out.push({ rule: 'extra-pointer', found: found[1], line: at(found[1]) });
  }

  // AC10, the other direction: a command shape that is not the one invocation. `ml-specs` on its
  // own is the trap — it reads correctly and resolves for nobody who has not installed globally.
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const cmd = m[1].trim();
    if (cmd.startsWith(INVOCATION)) {
      const verb = cmd.slice(INVOCATION.length).trim().split(/\s+/)[0];
      if (verb && !VERBS.includes(verb)) {
        out.push({ rule: 'unknown-verb', found: cmd, line: at(m[1]) });
      }
      continue;
    }
    if (/^ml-specs\s+\w/.test(cmd)) out.push({ rule: 'bare-invocation', found: cmd, line: at(m[1]) });
    else if (/^node\s+\S/.test(cmd)) out.push({ rule: 'node-path', found: cmd, line: at(m[1]) });
  }

  return out;
}
