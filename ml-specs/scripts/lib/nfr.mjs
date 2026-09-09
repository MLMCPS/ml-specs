// Non-functional requirements: reading them, and compiling them into the two
// things that actually enforce them.
//
// Pure Node, no dependencies. Read-only; the caller decides what to write.
//
// Why this exists: NFRs enter a project at the top — "the API shall be
// performant" — and then vanish. They do not decompose into user stories, so a
// story breakdown flattens them into prose that nothing checks. They decompose
// into exactly two things: a standing constraint read while authoring every
// spec, and a blocking pipeline gate. `compile` produces both or throws, so an
// NFR cannot be admitted and then quietly lost.

const TOOL_FOR = {
  performance: 'load',
  security: 'sast',
  availability: 'policy',
  compliance: 'policy',
};

export const NFR_KINDS = Object.keys(TOOL_FOR);
const OPERATORS = ['<', '<=', '>', '>=', '=='];

/**
 * An NFR without a machine-checkable threshold is a wish. Refusing it here is
 * the whole point: a wish gets flattened into a feature spec and lost, and
 * nobody notices until the load test that was never written would have caught it.
 */
export function compile(nfr) {
  const t = nfr.threshold;
  if (!t || !Number.isFinite(Number(t.value)) || !t.metric) {
    throw new Error(
      `${nfr.id} has no machine-checkable threshold, so it cannot become a pipeline gate. ` +
      `Give it metric/operator/value, or drop it — an NFR nothing can fail is not a requirement.`);
  }
  if (!OPERATORS.includes(t.operator)) {
    throw new Error(`${nfr.id} has operator "${t.operator}"; expected one of ${OPERATORS.join(' ')}`);
  }
  const tool = TOOL_FOR[nfr.kind];
  if (!tool) {
    throw new Error(`${nfr.id} has kind "${nfr.kind}"; expected one of ${NFR_KINDS.join(', ')}`);
  }

  const assertion = `${t.metric} ${t.operator} ${t.value}${t.unit ?? ''}`;
  return {
    constraint: { id: nfr.id, scope: nfr.appliesTo?.length ? nfr.appliesTo : ['*'],
                  text: `${nfr.statement} (${assertion})` },
    gate: { nfr: nfr.id, tool, metric: t.metric, operator: t.operator,
            value: Number(t.value), unit: t.unit ?? '', assertion, blocking: true },
  };
}

/**
 * The guard that keeps this honest: an NFR id must never appear inside an
 * acceptance criterion. That is the exact failure mode — the NFR flattened into
 * a feature spec, where it stops being enforced and starts being a sentence.
 */
export function findFlattened(specs) {
  const hits = [];
  for (const spec of specs) {
    for (const ac of spec.criteria ?? []) {
      for (const id of spec.nfrs ?? []) {
        if (ac.text.includes(id)) hits.push({ spec: spec.id, criterion: ac.id, nfr: id, text: ac.text });
      }
    }
  }
  return hits;
}

/** The gate block a pipeline consumes. */
export const toPipelineYaml = (gates) =>
  gates.length === 0
    ? '# no NFR gates compiled\n'
    : gates.map((g) =>
        `- gate: ${g.nfr}\n  tool: ${g.tool}\n  assert: ${g.assertion}\n  blocking: true`).join('\n');

// --- reading -----------------------------------------------------------------
// A markdown table, to match docs/ESTATE.md — this file is read by people during
// spec review far more often than by this code, and a format only a machine can
// read becomes a format nobody checks.

const ROW = /^\|(.+)\|\s*$/;
const SEP = /^\|[\s:|-]+\|\s*$/;
const clean = (v) => (v ?? '').replace(/[`*]/g, '').trim();
const PLACEHOLDER = /^(<.*>|_TBD_|—|-|)$/;

export function parseNfrMarkdown(text) {
  const out = [];
  let header = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (SEP.test(trimmed)) continue;
    const m = ROW.exec(trimmed);
    if (!m) { header = null; continue; }
    const cells = m[1].split('|').map(clean);

    if (!header) {
      const lower = cells.map((c) => c.toLowerCase());
      header = lower.includes('nfr') && lower.some((c) => c.includes('metric')) ? lower : null;
      continue;
    }

    const at = (name) => {
      const i = header.findIndex((h) => h.includes(name));
      return i === -1 ? '' : (cells[i] ?? '');
    };
    const id = at('nfr');
    if (!id || PLACEHOLDER.test(id)) continue;

    out.push({
      id,
      kind: (at('kind') || 'compliance').toLowerCase(),
      statement: at('statement'),
      threshold: { metric: at('metric'), operator: at('op') || '<',
                   value: Number(at('value')), unit: at('unit') },
      appliesTo: at('applies').split(',').map(clean).filter((v) => v && !PLACEHOLDER.test(v)),
    });
  }
  return out;
}
