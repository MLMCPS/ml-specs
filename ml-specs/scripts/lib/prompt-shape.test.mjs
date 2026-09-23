// Spec 0051 — the shape checker, and the property the whole standard rests on.
//
// AC3 IS THE ONE THAT MATTERS. Every rule here is a frontmatter key, a tool grant or a reference.
// Not one reads a sentence for meaning, and that is not an accident of the current rule set — it
// is the constraint the standard exists under. `mlskills-flag-wiring.test.mjs:10-13` records why:
// pinning wording "pressures people to write worse prose to appease the test".
//
// Without a test of the RULE SET, that boundary erodes one convenient check at a time. Somebody
// adds "and it must say it is read-only", it passes review because it is obviously true, and six
// months later the standard is a style guide nobody can edit prose against.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { check, frontmatter, RULES, REQUIRED, SOFT, IMPLEMENTERS } from './prompt-shape.mjs';

const agent = (front, body = 'Does a thing.\n\nHands back a report.\n') => `---\n${front}\n---\n\n${body}`;
const AGENTS = ['developer', 'coder', 'reviewer', 'scanner', 'spec-author'];

describe('AC3 — no rule reads prose', () => {
  test('every rule inspects a key, a grant, a reference or a structure', () => {
    const ALLOWED = new Set(['frontmatter', 'grant', 'reference', 'structure']);
    for (const r of RULES) {
      assert.ok(ALLOWED.has(r.inspects),
        `rule "${r.rule}" inspects "${r.inspects}" — if a rule needs to read a sentence it belongs `
        + 'in a review checklist, not in a checker. See docs/PROMPTS.md.');
    }
  });

  test('and the rule list covers every rule the checker can raise', () => {
    // Otherwise a rule added without a RULES entry escapes the assertion above entirely, which is
    // exactly how the boundary would erode without anybody noticing.
    const declared = new Set(RULES.map((r) => r.rule));
    const raised = new Set();
    const cases = [
      ['agent', 'reviewer', 'no frontmatter at all'],
      ['agent', 'reviewer', agent('name: reviewer\ndescription: d\nmodel: inherit')],
      ['agent', 'reviewer', agent('name: reviewer\ndescription: d\ntools: Read, Write\nmodel: inherit')],
      ['agent', 'developer', agent('name: developer\ndescription: d\ntools: Read\nmodel: inherit')],
      ['command', 'thing', `---\ndescription: d\nargument-hint: h\n---\n\nbody with no command\n`],
      ['command', 'thing', `---\nargument-hint: h\n---\n\nsee the reviewer agent, then /ml-specs:pr\n`],
    ];
    for (const [kind, name, text] of cases) {
      for (const f of check(kind, name, text, AGENTS)) raised.add(f.rule);
    }
    for (const r of raised) {
      assert.ok(declared.has(r), `the checker raised "${r}", which RULES does not declare`);
    }
    assert.ok(raised.size >= 5, `only ${raised.size} rules exercised — the cases above assert little`);
  });
});

describe('frontmatter', () => {
  test('parses simple key: value and ignores the body', () => {
    const { meta, body } = frontmatter('---\nname: x\ntools: Read, Grep\n---\n\nbody\n');
    assert.equal(meta.name, 'x');
    assert.equal(meta.tools, 'Read, Grep');
    assert.match(body, /body/);
  });

  test('a file with no frontmatter, or an unterminated block, is reported as having none', () => {
    assert.equal(frontmatter('# just a heading\n').hasFrontmatter, false);
    assert.equal(frontmatter('---\nname: x\nno closing fence\n').hasFrontmatter, false);
  });

  test('CRLF frontmatter parses — the 0062 failure, one layer up', () => {
    const { meta } = frontmatter('---\r\nname: x\r\ntools: Read\r\n---\r\n\r\nbody\r\n');
    assert.equal(meta.name, 'x', 'a CRLF agent file parsed its name as "x\\r"');
    assert.equal(meta.tools, 'Read');
  });
});

describe('required keys are errors, soft keys are warnings', () => {
  test('a missing required key errors', () => {
    const out = check('agent', 'reviewer', agent('name: reviewer\ndescription: d\nmodel: inherit'), AGENTS);
    const e = out.filter((f) => f.level === 'error');
    assert.equal(e.length, 1);
    assert.match(e[0].message, /tools/);
  });

  test('a missing soft key warns and does not error', () => {
    const out = check('command', 'thing', `---\ndescription: d\nargument-hint: h\n---\n\nthe reviewer agent; next /ml-specs:pr\n`, AGENTS);
    assert.deepEqual(out.filter((f) => f.level === 'error'), []);
    assert.ok(out.some((f) => f.level === 'warning' && f.rule === 'soft-key'));
  });

  test('no frontmatter errors once, not once per missing key', () => {
    // Four "missing key" errors on a file with no frontmatter is noise that buries the real cause.
    const out = check('agent', 'reviewer', '# no frontmatter\n', AGENTS);
    assert.equal(out.length, 1);
    assert.equal(out[0].rule, 'frontmatter');
  });
});

describe('AC4 — the tool grant is a privilege boundary', () => {
  test('a non-implementer declaring Write errors', () => {
    const out = check('agent', 'reviewer', agent('name: reviewer\ndescription: d\ntools: Read, Write\nmodel: inherit'), AGENTS);
    assert.ok(out.some((f) => f.level === 'error' && f.rule === 'tool-grant'),
      'a read-only agent was allowed to grant itself Write');
  });

  test('and Edit is the same', () => {
    const out = check('agent', 'scanner', agent('name: scanner\ndescription: d\ntools: Read, Edit\nmodel: inherit'), AGENTS);
    assert.ok(out.some((f) => f.level === 'error' && f.rule === 'tool-grant'));
  });

  test('an implementer declaring Write does not', () => {
    for (const name of Object.keys(IMPLEMENTERS)) {
      const out = check('agent', name, agent(`name: ${name}\ndescription: d\ntools: Read, Write, Edit\nmodel: inherit`), AGENTS);
      assert.deepEqual(out.filter((f) => f.level === 'error'), [], `${name} was refused its grant`);
    }
  });

  test('an implementer with no write grant warns — the list and the file disagree', () => {
    const out = check('agent', 'developer', agent('name: developer\ndescription: d\ntools: Read\nmodel: inherit'), AGENTS);
    assert.ok(out.some((f) => f.level === 'warning' && f.rule === 'tool-grant'));
  });

  test('the implementer list is small and stated', () => {
    // Three. If this grows, it grew in a diff somebody reviewed, which is the point.
    assert.equal(Object.keys(IMPLEMENTERS).length, 3);
    for (const why of Object.values(IMPLEMENTERS)) assert.ok(why.length > 15, 'a reason, not a word');
  });
});

describe('commands — the next command, and delegation', () => {
  const cmd = (body) => `---\ndescription: d\nargument-hint: h\nmodel: haiku\n---\n\n${body}`;

  test('naming no command at all errors', () => {
    const out = check('command', 'thing', cmd('Use the reviewer agent. The end.\n'), AGENTS);
    assert.ok(out.some((f) => f.level === 'error' && f.rule === 'next-command'),
      'a command leaving the user at a dead end passed');
  });

  test('naming one only far from the end warns', () => {
    const body = `Run /ml-specs:pr first.\nUse the reviewer agent.\n${'filler line\n'.repeat(20)}`;
    const out = check('command', 'thing', cmd(body), AGENTS);
    assert.deepEqual(out.filter((f) => f.level === 'error'), []);
    assert.ok(out.some((f) => f.rule === 'next-command' && f.level === 'warning'));
  });

  test('delegation is a warning, because self-contained is a third valid answer', () => {
    // `fix.md` and `repo-impact.md` hand the main agent a procedure directly. Erroring here would
    // fail the build over two deliberate designs.
    const out = check('command', 'thing', cmd('Do it yourself, then /ml-specs:pr\n'), AGENTS);
    assert.deepEqual(out.filter((f) => f.level === 'error'), []);
    assert.ok(out.some((f) => f.rule === 'delegation' && f.level === 'warning'));
  });

  test('naming an agent by prose name counts as delegating', () => {
    // Dispatch is by prose name (docs/ARCHITECTURE.md:43-44). `repo-init.md` says "spawn
    // **scanner**" and never writes the word "agent" — looking for that word produced a false
    // error on a command that delegates three times in one message.
    const out = check('command', 'thing', cmd('Spawn **scanner** three times, then /ml-specs:pr\n'), AGENTS);
    assert.ok(!out.some((f) => f.rule === 'delegation'), 'prose-name dispatch was not recognised');
  });
});

describe('the rule sets themselves', () => {
  test('required and soft do not overlap', () => {
    for (const kind of ['agent', 'command']) {
      const overlap = REQUIRED[kind].filter((k) => SOFT[kind].includes(k));
      assert.deepEqual(overlap, [], `${kind}: ${overlap.join(', ')} is both required and soft`);
    }
  });

  test('required is short — a long list is one people route around', () => {
    assert.ok(REQUIRED.agent.length <= 5 && REQUIRED.command.length <= 5);
  });
});
