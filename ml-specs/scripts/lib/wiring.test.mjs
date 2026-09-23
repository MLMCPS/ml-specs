// Spec 0037 AC5, AC6 — the pure half.
//
// `wiring-report.test.mjs` drives the CLI. These are the functions underneath, and they are worth
// testing separately because both criteria are properties of the DATA rather than of the output:
// whether the surface list covers the template set, and whether every row can say what it checked.
// A property asserted only through a rendered report is one that survives a rendering change.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SURFACES, survey, uncovered, emitTarget, fixes } from './wiring.mjs';

const TEMPLATES = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'templates');

/** A throwaway template tree with the given directories. */
function templates(t, dirs) {
  const d = mkdtempSync(join(tmpdir(), 'mlspecs-tpl-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  for (const x of dirs) mkdirSync(join(d, x), { recursive: true });
  return d;
}

function repo(t, files = []) {
  const d = mkdtempSync(join(tmpdir(), 'mlspecs-wl-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  for (const rel of files) {
    mkdirSync(join(d, dirname(rel)), { recursive: true });
    writeFileSync(join(d, rel), 'x\n');
  }
  return d;
}

describe('AC5 — the surface list is derived from the template set', () => {
  test('the shipped set is fully covered', () => {
    const gaps = uncovered(TEMPLATES);
    assert.deepEqual(gaps, [],
      `template director(ies) no surface reports on: ${gaps.join(', ')}`);
  });

  test('a new template directory is detected', (t) => {
    const covered = [...new Set(SURFACES.map((s) => s.templateDir).filter(Boolean))];
    assert.deepEqual(uncovered(templates(t, covered)), []);
    assert.deepEqual(uncovered(templates(t, [...covered, 'brand-new'])), ['brand-new']);
  });

  test('a surface whose templateDir stops matching leaves a gap', (t) => {
    // The mutation this criterion exists for, as data: the surface list and the template set
    // drifting apart without the report getting any smaller-looking.
    const covered = [...new Set(SURFACES.map((s) => s.templateDir).filter(Boolean))];
    const gaps = uncovered(templates(t, [...covered, 'handoff-renamed']));
    assert.deepEqual(gaps, ['handoff-renamed']);
  });

  test('a missing template root is empty, not an error', (t) => {
    assert.deepEqual(uncovered(join(repo(t), 'nope')), []);
  });
});

describe('AC6 — every row can say what it checked', () => {
  test('every surface declares `checks`, and it is a value a reader can act on', () => {
    // The field exists so a row can say `function` when something genuinely verifies one. Today
    // every row is `presence`, and that is the claim being made — not an oversight.
    for (const s of SURFACES) {
      assert.ok(['presence', 'function'].includes(s.checks),
        `${s.id} declares checks: ${JSON.stringify(s.checks)}`);
    }
  });

  test('and the surveyed rows carry it through', (t) => {
    for (const row of survey(repo(t, ['CLAUDE.md']))) {
      assert.ok(row.checks, `${row.id} lost its checks field between SURFACES and survey()`);
    }
  });

  test('a present row names what it found, not just that it found something', (t) => {
    const row = survey(repo(t, ['.mcp.json'])).find((r) => r.id === 'mcp');
    assert.equal(row.present, true);
    assert.deepEqual(row.found, ['.mcp.json']);
  });

  test('an absent row keeps the full list of where it looked', (t) => {
    const row = survey(repo(t)).find((r) => r.id === 'ci-gate');
    assert.equal(row.present, false);
    assert.deepEqual(row.found, []);
    assert.ok(row.look.length >= 2, 'an absent row does not say everywhere it looked');
  });
});

describe('the surface table itself', () => {
  test('ids are unique', () => {
    const ids = SURFACES.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, 'two surfaces share an id');
  });

  test('every surface names somewhere to look and something to do', () => {
    for (const s of SURFACES) {
      assert.ok(s.look.length, `${s.id} looks nowhere`);
      assert.ok(s.fix && s.fix.length > 10, `${s.id} names no usable fix`);
      assert.ok(s.what, `${s.id} does not say what it is`);
    }
  });

  test('emitTarget resolves a provider, falls back to `any`, and returns null otherwise', () => {
    assert.equal(emitTarget('ci-gate', 'azure'), 'ci/azure-pipelines-spec-gate.yml');
    assert.equal(emitTarget('ci-gate', 'github'), 'ci/spec-gate.yml');
    assert.equal(emitTarget('mcp', 'github'), 'mcp/.mcp.json', 'the `any` fallback did not apply');
    assert.equal(emitTarget('knowledge-layer', 'github'), null, 'a surface with nothing to emit returned something');
    assert.equal(emitTarget('nonsense'), null);
  });

  test('at least one surface is optional, and at least one is not', () => {
    // Otherwise the exit code either never fails or always does, and both make it meaningless.
    assert.ok(SURFACES.some((s) => s.optional), 'nothing is optional — every absence would fail a run');
    assert.ok(SURFACES.some((s) => !s.optional), 'everything is optional — the exit code can never be 1');
  });

  test('fixes() exposes every surface, for the remedy-exists check', () => {
    assert.equal(fixes().length, SURFACES.length);
  });
});
