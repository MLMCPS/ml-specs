// The shape an agent or command file conforms to. Spec 0051; the standard is docs/PROMPTS.md.
//
// EVERY RULE IS STRUCTURAL, AND THAT IS THE DESIGN
//
// Not one rule below reads a sentence for meaning. Each is a frontmatter key, a tool grant, or a
// reference that resolves. That boundary is the whole reason this can exist at all:
// `mlskills-flag-wiring.test.mjs:10-13` records that pinning wording "pressures people to write
// worse prose to appease the test", and whether a file's instructions are honoured is a review
// obligation. A rule that needed to read a sentence would belong in a checklist, not here.
//
// `prompt-shape.test.mjs` asserts that property against the rule set itself, because it is the
// thing that erodes one convenient check at a time.
//
// REQUIRED IS AN ERROR, SOFT IS A WARNING
//
// `scripts/validate-plugin.mjs:251-257` already takes that posture for a comparable token class.
// A standard that errors on a convention is one people route around, after which nothing is
// checked. Required rules are deliberately few, and every one of them holds on all 34 files today
// — so the first run is actionable rather than a wall.
//
// A `lib/` module never consoles. It returns findings; the validator prints them.

import { lines } from './text.mjs';

/** Agents that may hold `Write`/`Edit`, each for a stated reason. See docs/PROMPTS.md. */
export const IMPLEMENTERS = Object.freeze({
  developer: 'implements one approved spec',
  coder: 'implements a change with no spec behind it',
  'spec-author': 'writes the spec file itself',
});

export const REQUIRED = Object.freeze({
  agent: ['name', 'description', 'tools', 'model'],
  command: ['description', 'argument-hint'],
});

export const SOFT = Object.freeze({
  agent: [],
  command: ['model'],
});

/** Split `---\nfrontmatter\n---\nbody`. Returns `{meta, body}`; `meta` empty when there is none. */
export function frontmatter(text) {
  const rows = lines(text);
  if (rows[0]?.trim() !== '---') return { meta: {}, body: text, hasFrontmatter: false };
  const end = rows.indexOf('---', 1);
  if (end === -1) return { meta: {}, body: text, hasFrontmatter: false };
  const meta = {};
  for (const line of rows.slice(1, end)) {
    const kv = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: rows.slice(end + 1).join('\n'), hasFrontmatter: true };
}

/** Does the file name at least one `/ml-specs:` command anywhere? */
const namesACommand = (text) => /\/ml-specs:[\w-]+/.test(text);

/** …and in its closing region, which is where a reader looks. Soft. */
const namesOneAtTheEnd = (text) => {
  const tail = lines(text).filter((l) => l.trim()).slice(-12).join('\n');
  return /\/ml-specs:[\w-]+/.test(tail);
};

/**
 * Check one prompt file.
 *
 * @param {'agent'|'command'} kind
 * @param {string} name  the file's basename without `.md`
 * @param {string} text
 * @param {string[]} [agentNames]  the roster, for the delegation rule — passed in rather than read,
 *   so this module stays pure and the rule tracks a rename the way `docs/ARCHITECTURE.md:43-44`
 *   says dispatch does
 * @returns {Array<{level: 'error'|'warning', rule: string, message: string}>}
 */
export function check(kind, name, text, agentNames = []) {
  const out = [];
  const err = (rule, message) => out.push({ level: 'error', rule, message });
  const warn = (rule, message) => out.push({ level: 'warning', rule, message });

  const { meta, hasFrontmatter } = frontmatter(text);
  if (!hasFrontmatter) {
    err('frontmatter', 'no frontmatter — the file will not appear in the menu');
    return out;                      // every other key check would just repeat this
  }

  for (const key of REQUIRED[kind]) {
    if (!meta[key] || !meta[key].trim()) err('required-key', `missing required frontmatter \`${key}\``);
  }
  for (const key of SOFT[kind]) {
    if (!meta[key]) warn('soft-key', `no \`${key}\` — the default applies, which is usually fine`);
  }

  if (kind === 'agent') {
    // The privilege boundary. `CLAUDE.md`: only implementers get Write, Edit.
    const grants = (meta.tools ?? '').split(',').map((t) => t.trim());
    const writes = grants.filter((t) => t === 'Write' || t === 'Edit');
    if (writes.length && !Object.hasOwn(IMPLEMENTERS, name)) {
      err('tool-grant', `declares ${writes.join(' and ')} and is not an implementer — `
        + `least privilege is a rule, not a preference (docs/PROMPTS.md)`);
    }
    if (!writes.length && Object.hasOwn(IMPLEMENTERS, name)) {
      warn('tool-grant', `is listed as an implementer (${IMPLEMENTERS[name]}) but grants no Write/Edit`);
    }
  }

  if (kind === 'command') {
    // Delegation or a script. A command that names neither is doing something nobody declared.
    //
    // Dispatch is by PROSE NAME — `repo-init.md:22` says "spawn **scanner** three times" and never
    // writes the word "agent". Looking for that word found three false errors, one of which
    // delegates three times in a single message. The roster is the right thing to match against,
    // and reading it from the directory means the rule tracks a rename.
    const namesAnAgent = agentNames.some((a) => new RegExp(`\\b${a}\\b`, 'i').test(text));
    const delegates = namesAnAgent
      || /\bagent\b/i.test(text)
      || /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\//.test(text);
    if (!delegates) {
      // A WARNING, not an error, and the survey is why. `fix.md` and `repo-impact.md` delegate to
      // nothing and run nothing: they hand the main agent a procedure directly. That is a real
      // third category, not a defect — `CLAUDE.md`'s "commands delegate rather than reimplementing
      // an agent's job" is about not duplicating an agent, and neither of these duplicates one.
      // Making it an error would fail the build over two deliberate designs, and a standard that
      // does that is one people route around.
      warn('delegation', 'delegates to no agent and runs no script — self-contained, which is a '
        + 'choice worth seeing in review rather than a defect');
    }
    if (!namesACommand(text)) {
      err('next-command', 'names no /ml-specs: command — a user reaching the end has nowhere to go');
    } else if (!namesOneAtTheEnd(text)) {
      warn('next-command', 'names a next command, but not in the closing region where a reader looks');
    }
  }

  return out;
}

/**
 * Every rule this module can raise, with what it inspects. `prompt-shape.test.mjs` walks this to
 * assert no rule reads prose — the property the whole standard rests on, and the one that would
 * erode silently.
 */
export const RULES = Object.freeze([
  { rule: 'frontmatter', inspects: 'structure' },
  { rule: 'required-key', inspects: 'frontmatter' },
  { rule: 'soft-key', inspects: 'frontmatter' },
  { rule: 'tool-grant', inspects: 'grant' },
  { rule: 'delegation', inspects: 'reference' },
  { rule: 'next-command', inspects: 'reference' },
]);
