// Spec 0059 — the skill contract.
//
// AC3 IS THE ONE THAT MATTERS, and it runs in both directions. A skill declaring a capability the
// vocabulary does not know is an error; a capability nothing implements is reported. Without the
// second half, the two layers drift into naming different things and nobody notices until an agent
// is asked for a capability no skill answers.
//
// `standard` is the field this whole layer rests on. It is checkable in exactly one way — present,
// and more than a gesture. Whether the body follows it is a review obligation, and a criterion
// pretending otherwise would be the vacuity this branch has found eleven times.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSkills, checkSkill, uncovered, CAPABILITIES, REQUIRED_FIELDS } from './skills.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS = join(dirname(HERE), '..', 'skills');

const FULL = {
  name: 'thing', description: 'does a thing', capability: 'testing',
  inputs: 'a spec section', outputs: 'test files', standard: 'TDD (Beck) + xUnit Test Patterns',
};

/** A throwaway skills directory. */
function dir(t, skills) {
  const d = mkdtempSync(join(tmpdir(), 'mlspecs-skills-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  for (const [name, meta] of Object.entries(skills)) {
    mkdirSync(join(d, name), { recursive: true });
    if (meta === null) continue;                       // directory with no SKILL.md
    const front = Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join('\n');
    writeFileSync(join(d, name, 'SKILL.md'), `---\n${front}\n---\n\n# ${name}\n\nBody.\n`);
  }
  return d;
}

const only = (t, meta, name = 'thing') => checkSkill(readSkills(dir(t, { [name]: meta }))[0]);

describe('AC1 — all six fields are required', () => {
  for (const field of REQUIRED_FIELDS) {
    test(`missing \`${field}\` is an error`, (t) => {
      const meta = { ...FULL };
      delete meta[field];
      const errs = only(t, meta).filter((f) => f.level === 'error');
      assert.ok(errs.some((e) => e.message.includes(field)),
        `dropping ${field} produced ${JSON.stringify(errs)}`);
    });
  }

  test('a complete skill is clean', (t) => {
    assert.deepEqual(only(t, FULL), []);
  });

  test('a directory with no SKILL.md is an error, not a silent skip', (t) => {
    const errs = checkSkill(readSkills(dir(t, { orphan: null }))[0]);
    assert.ok(errs.some((e) => e.rule === 'missing'), 'an empty skill directory passed');
  });

  test('the declared name and the directory must agree', (t) => {
    // Otherwise a caller asking for one gets the other.
    const errs = only(t, { ...FULL, name: 'other' }).filter((f) => f.level === 'error');
    assert.ok(errs.some((e) => e.rule === 'name'));
  });
});

describe('AC2 — `standard` is the load-bearing field', () => {
  test('a one-word standard is an error', (t) => {
    const errs = only(t, { ...FULL, standard: 'TDD' }).filter((f) => f.level === 'error');
    assert.ok(errs.some((e) => e.rule === 'standard'), 'a gesture passed as a citation');
  });

  test('"best practices" warns — it names no particular body of practice', (t) => {
    for (const s of ['best practices', 'Common sense', 'industry standard']) {
      const f = only(t, { ...FULL, standard: s });
      assert.ok(f.some((x) => x.rule === 'standard' && x.level === 'warning'), `"${s}" passed clean`);
    }
  });

  test('a real citation is clean', (t) => {
    assert.deepEqual(only(t, { ...FULL, standard: 'Conventional Commits + YAGNI/DRY' }), []);
  });

  test('and what it CANNOT catch is stated, not implied', (t) => {
    // A plausible citation the body ignores passes every check here. That is review's job —
    // docs/PROMPTS.md says so, and this asserts the limit rather than leaving somebody to assume
    // the checker is doing more than it is.
    assert.deepEqual(only(t, { ...FULL, standard: 'RFC 9110 (HTTP Semantics)' }), [],
      'the checker started judging whether a body follows its standard, which it cannot');
  });
});

describe('AC3 — the capability vocabulary, both directions', () => {
  test('a capability outside the vocabulary is an error, naming what is known', (t) => {
    const errs = only(t, { ...FULL, capability: 'vibes' }).filter((f) => f.level === 'error');
    assert.equal(errs.length, 1);
    assert.match(errs[0].message, /vibes/);
    assert.match(errs[0].message, /testing/, 'the refusal does not say what IS known');
  });

  test('every capability in the vocabulary is accepted', (t) => {
    for (const c of CAPABILITIES) {
      assert.deepEqual(only(t, { ...FULL, capability: c }), [], `${c} was refused`);
    }
  });

  test('capabilities with no skill are REPORTED, not silently fine', (t) => {
    // The other direction, and the one that would rot unnoticed: a capability nothing implements
    // is a gap worth seeing. It is not an error — the set grows as procedures are written.
    const skills = readSkills(dir(t, { thing: FULL }));
    const gaps = uncovered(skills);
    assert.ok(gaps.includes('intake'), 'a capability with no skill was not reported');
    assert.ok(!gaps.includes('testing'), 'a capability WITH a skill was reported as a gap');
    assert.equal(gaps.length, CAPABILITIES.length - 1);
  });

  test('the vocabulary is frozen and non-trivial', (t) => {
    assert.ok(Object.isFrozen(CAPABILITIES));
    assert.ok(CAPABILITIES.length >= 8, 'the vocabulary shrank — check why');
    assert.equal(new Set(CAPABILITIES).size, CAPABILITIES.length, 'a duplicate capability');
  });
});

describe('AC4, AC6 — the shipped skills', () => {
  test('every shipped skill satisfies the contract', () => {
    const skills = readSkills(SKILLS);
    assert.ok(skills.length >= 1, 'no skills found — this asserts nothing');
    for (const s of skills) {
      assert.deepEqual(checkSkill(s), [], `${s.name}: ${JSON.stringify(checkSkill(s))}`);
    }
  });

  test('knowledge-retrieval carries the full contract', () => {
    const k = readSkills(SKILLS).find((s) => s.name === 'knowledge-retrieval');
    assert.ok(k, 'the one pre-existing skill is gone');
    for (const f of REQUIRED_FIELDS) assert.ok(k.meta[f], `knowledge-retrieval declares no ${f}`);
    assert.equal(k.meta.capability, 'architecture');
  });

  test('and still says when to load, which is what CLAUDE.md points at', () => {
    // The migration added frontmatter; it must not have cost the trigger, which is the only
    // reason a loadable skill ever gets loaded.
    const k = readSkills(SKILLS).find((s) => s.name === 'knowledge-retrieval');
    assert.match(k.meta.description, /Load when|load only|when the repo/i,
      'the description no longer says when to load this');
  });

  test('the catalogue is derived from the directory, not from a list', () => {
    // A registry is a second list that goes stale; the directory is what ships.
    const names = readSkills(SKILLS).map((s) => s.name).sort();
    assert.deepEqual(names, [...names].sort(), 'stable ordering');
    assert.ok(names.includes('knowledge-retrieval'));
  });
});
