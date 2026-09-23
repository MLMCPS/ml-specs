// Skills — procedures with a declared contract. Spec 0059.
//
// WHY A CONTRACT AND NOT JUST A FILE
//
// This toolkit had one skill, and its frontmatter had two keys: `name` and `description`. Nothing
// said what it takes, what it produces, which role runs it, or what body of practice it is drawn
// from — and nothing parsed it. Everything a skill would be was instead spread through the command
// and agent files, where it cannot be reused: `developer.md` carries how to write a test, how to
// size a change, and how to commit, fused into one role and invocable only by being that role.
//
// The split is: a capability is a role, an agent implements it, a skill is the PROCEDURE it runs.
//
// `standard` IS THE LOAD-BEARING FIELD
//
// It names the body of practice a skill applies — "TDD (Beck) + xUnit Test Patterns", not "best
// practices". That is what separates a procedure from one person's advice with a filename on it.
// It is checkable in exactly one way: present, and more than a word. Whether the body actually
// follows it is a review obligation, and pretending a checker could tell would be the vacuity this
// repo has found eleven times.
//
// A `lib/` module never consoles. It returns findings; the caller prints them.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { frontmatter } from './prompt-shape.mjs';

/**
 * The capability vocabulary — ten roles, frozen.
 *
 * Defined HERE rather than borrowed from spec 0043, which is four phases later in the build order.
 * A vocabulary defined in one spec and consumed in another is two lists that will disagree; 0043
 * attaches agents to these, and does not invent a parallel set.
 */
export const CAPABILITIES = Object.freeze([
  'intake',          // turning a vague request into a crisp need
  'analysis',        // a need into testable criteria
  'architecture',    // the shape of a change across modules
  'planning',        // decomposing approved work
  'implementation',  // writing the code
  'testing',         // proving it
  'security',        // the trust boundaries a criteria review cannot see
  'operability',     // running it, and what happens when it breaks
  'review',          // judging work against its contract
  'governance',      // whether the artifacts still describe reality
]);

/** Every field a skill declares. All six required — see docs/PROMPTS.md and spec 0059. */
export const REQUIRED_FIELDS = Object.freeze([
  'name', 'description', 'capability', 'inputs', 'outputs', 'standard',
]);

/** A `standard` shorter than this is a gesture, not a citation. */
const STANDARD_MIN = 8;

/**
 * Read every skill from a directory. Derived from the filesystem, never from a registry — a
 * registry is a second list that goes stale, and the directory is what actually ships.
 *
 * @param {string} dir  `ml-specs/skills`
 * @returns {Array<{name: string, path: string, meta: object, body: string}>}
 */
export function readSkills(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const path = join(dir, e.name, 'SKILL.md');
      if (!existsSync(path)) return { name: e.name, path, meta: {}, body: '', missing: true };
      const { meta, body } = frontmatter(readFileSync(path, 'utf8'));
      return { name: e.name, path, meta, body, missing: false };
    });
}

/**
 * Check one skill against the contract.
 *
 * @param {{name: string, meta: object, missing?: boolean}} skill
 * @returns {Array<{level: 'error'|'warning', rule: string, message: string}>}
 */
export function checkSkill(skill) {
  const out = [];
  const err = (rule, message) => out.push({ level: 'error', rule, message });
  const warn = (rule, message) => out.push({ level: 'warning', rule, message });

  if (skill.missing) {
    err('missing', 'directory with no SKILL.md — a skill is the file, not the folder');
    return out;
  }

  for (const key of REQUIRED_FIELDS) {
    if (!skill.meta[key] || !String(skill.meta[key]).trim()) {
      err('required-field', `missing required frontmatter \`${key}\``);
    }
  }

  // The directory name and the declared name must agree, or a caller asking for one gets the other.
  if (skill.meta.name && skill.meta.name !== skill.name) {
    err('name', `declares \`name: ${skill.meta.name}\` but lives in \`${skill.name}/\``);
  }

  if (skill.meta.capability && !CAPABILITIES.includes(skill.meta.capability)) {
    err('capability', `declares \`${skill.meta.capability}\`, which is not a capability — `
      + `known: ${CAPABILITIES.join(', ')}`);
  }

  if (skill.meta.standard) {
    const s = String(skill.meta.standard).trim();
    if (s.length < STANDARD_MIN) {
      err('standard', `\`standard: ${s}\` is a gesture, not a citation — name the body of practice`);
    } else if (/^(best practice|common sense|good practice|industry standard)s?\.?$/i.test(s)) {
      // Catchable and worth catching. What it cannot catch is a plausible-looking citation that
      // the body ignores; that is review's job, and docs/PROMPTS.md says so.
      warn('standard', `\`${s}\` names no particular body of practice — cite one`);
    }
  }

  return out;
}

/**
 * Capabilities with no skill. Not an error: the set grows as procedures are written, and a
 * capability nothing implements yet is a gap worth seeing, not a failure.
 */
export const uncovered = (skills) => {
  const declared = new Set(skills.map((s) => s.meta.capability).filter(Boolean));
  return CAPABILITIES.filter((c) => !declared.has(c));
};
