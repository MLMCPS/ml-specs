import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compile, findFlattened, toPipelineYaml, parseNfrMarkdown, NFR_KINDS } from './nfr.mjs';

const PERF = { id: 'NFR-03', kind: 'performance', statement: 'stays responsive',
               threshold: { metric: 'p95_latency', operator: '<', value: 400, unit: 'ms' },
               appliesTo: ['api-neelias'] };

describe('compiling an NFR', () => {
  test('produces both halves — a constraint and a gate', () => {
    const { constraint, gate } = compile(PERF);
    assert.match(constraint.text, /p95_latency < 400ms/);
    assert.deepEqual(constraint.scope, ['api-neelias']);
    assert.equal(gate.tool, 'load');
    assert.equal(gate.blocking, true);
  });

  test('each kind maps to the tool that can actually enforce it', () => {
    assert.equal(compile({ ...PERF, kind: 'security', threshold: { metric: 'x', operator: '==', value: 0 } }).gate.tool, 'sast');
    assert.equal(compile({ ...PERF, kind: 'availability', threshold: { metric: 'x', operator: '>=', value: 99 } }).gate.tool, 'policy');
    assert.deepEqual(NFR_KINDS.sort(), ['availability', 'compliance', 'performance', 'security']);
  });

  test('no threshold is refused, not silently accepted', () => {
    // A wish gets flattened into a feature spec and lost.
    assert.throws(() => compile({ ...PERF, threshold: null }), /no machine-checkable threshold/);
    assert.throws(() => compile({ ...PERF, threshold: { metric: 'x', operator: '<', value: 'soon' } }), /threshold/);
  });

  test('a nonsense operator or kind is refused with what was expected', () => {
    assert.throws(() => compile({ ...PERF, threshold: { ...PERF.threshold, operator: '~' } }), /expected one of/);
    assert.throws(() => compile({ ...PERF, kind: 'vibes' }), /expected one of/);
  });

  test('an NFR with no scope applies everywhere rather than nowhere', () => {
    assert.deepEqual(compile({ ...PERF, appliesTo: [] }).constraint.scope, ['*']);
  });
});

describe('the flattening guard', () => {
  test('an NFR id inside an acceptance criterion is caught', () => {
    // The exact failure mode: the NFR stops being enforced and becomes a sentence.
    const hits = findFlattened([{ id: '0031', nfrs: ['NFR-03'],
      criteria: [{ id: 'AC-1', text: 'The system satisfies NFR-03 under load.' }] }]);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].nfr, 'NFR-03');
  });

  test('an ordinary criterion is not a false positive', () => {
    assert.equal(findFlattened([{ id: '0031', nfrs: ['NFR-03'],
      criteria: [{ id: 'AC-1', text: 'A partial capture holds the remainder.' }] }]).length, 0);
  });
});

describe('reading the NFR table', () => {
  const MD = `| NFR | Kind | Statement | Metric | Op | Value | Unit | Applies to |
|-----|------|-----------|--------|----|-------|------|------------|
| NFR-03 | performance | stays responsive | p95_latency | < | 400 | ms | api-neelias |
| NFR-07 | security | no high findings | sast_high | == | 0 |  | * |
| <NFR-id> | performance | <statement> | x | < | 1 |  | _TBD_ |`;

  test('rows parse into compilable NFRs', () => {
    const nfrs = parseNfrMarkdown(MD);
    assert.deepEqual(nfrs.map((n) => n.id), ['NFR-03', 'NFR-07']);
    assert.equal(nfrs[0].threshold.value, 400);
    assert.deepEqual(nfrs[0].appliesTo, ['api-neelias']);
    assert.doesNotThrow(() => compile(nfrs[0]));
  });

  test('unfilled template rows are skipped', () => {
    assert.ok(!parseNfrMarkdown(MD).some((n) => n.id.startsWith('<')));
  });

  test('the separator row does not end the table', () => {
    assert.equal(parseNfrMarkdown(MD).length, 2);
  });
});

describe('pipeline output', () => {
  test('gates render as blocking yaml', () => {
    const yaml = toPipelineYaml([compile(PERF).gate]);
    assert.match(yaml, /- gate: NFR-03/);
    assert.match(yaml, /blocking: true/);
  });

  test('no gates says so rather than emitting an empty block', () => {
    assert.match(toPipelineYaml([]), /no NFR gates compiled/);
  });
});
