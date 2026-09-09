// The ID spine: one key, derived into every downstream artifact name.
//
// Imported by scripts/spec-trace.mjs and scripts/spec-brief.mjs so there is one
// implementation of "what is this change called everywhere".
//
// Pure Node, no dependencies. No I/O, no network — every function here is a
// string transform, which is what makes the chain checkable offline in CI.
//
// Why it matters: without a key carried end to end, "which requirement is
// covered by which test, and did it ship?" has no answer that survives an audit.
// Every id below is PRODUCED by a function and RECOVERED by its matching parser,
// so a link that lost the key is a parse failure rather than a silent divergence.

/** `Payment hold on partial capture` -> `payment-hold-on-partial-capture` */
export function slugify(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
}

export const specId = (id) => `SPEC-${id}`;
export const branchName = (id, title) => `feat/${id}-${slugify(title)}`;
export const prTitle = (id, title) => `[${specId(id)}] ${title}`;
export const testCaseId = (id, ordinal) => `TC-${id}.${ordinal}`;

// A spec id is digits plus an OPTIONAL letter, matching lib/specs.mjs:
// 0165 and 0165b are different specs, not a clash.
const KEY = '(\\d{3,4}[a-z]?)';

const PARSERS = {
  specId: new RegExp(`^SPEC-${KEY}$`),
  branch: new RegExp(`^(?:feat|fix|chore)/${KEY}-`),
  prTitle: new RegExp(`^\\[SPEC-${KEY}\\]`),
  testCase: new RegExp(`^TC-${KEY}\\.\\d+$`),
  specFile: new RegExp(`^(?:specs/(?:archive/)?)?${KEY}-.+\\.md$`),
};

/** Recover the key from a downstream artifact name, or null if it carries none. */
export function keyFrom(kind, value) {
  const re = PARSERS[kind];
  if (!re) throw new Error(`unknown artifact kind: ${kind}`);
  const m = re.exec(String(value ?? ''));
  return m ? m[1] : null;
}

export const ARTIFACT_KINDS = Object.keys(PARSERS);

/**
 * Build the chain for a spec. Links are `derived` (a function above produced the
 * name, so the key cannot be missing) or `declared` (a human or an external
 * system supplied it). Only declared links can break — which is exactly why they
 * are reported separately rather than assumed sound.
 */
export function buildChain(spec, { testCases = true } = {}) {
  const links = [
    { kind: 'ticket', ref: spec.ticket ?? '(none)', origin: 'declared' },
    { kind: 'spec', ref: specId(spec.id), origin: 'derived', parseAs: 'specId' },
    { kind: 'specFile', ref: spec.file, origin: 'derived', parseAs: 'specFile' },
    { kind: 'branch', ref: spec.branch ?? branchName(spec.id, spec.title), origin: spec.branch ? 'declared' : 'derived', parseAs: 'branch' },
    { kind: 'pullRequest', ref: prTitle(spec.id, spec.title), origin: 'derived', parseAs: 'prTitle' },
  ];

  if (testCases && spec.status !== 'Draft') {
    for (const ac of spec.criteria ?? []) {
      links.push({ kind: 'testCase', ref: testCaseId(spec.id, ac.ordinal), origin: 'derived', parseAs: 'testCase', from: ac.id });
    }
  }
  return { key: spec.id, links };
}

/** Does every parseable link carry the chain's key? */
export function verifyChain(chain) {
  const broken = [];
  const unverifiable = [];

  for (const link of chain.links) {
    if (!link.parseAs) { unverifiable.push(link); continue; }
    const found = keyFrom(link.parseAs, link.ref);
    if (found === null) broken.push({ link, reason: 'missing-key', found: null });
    else if (found !== chain.key) broken.push({ link, reason: 'wrong-key', found });
  }

  return { ok: broken.length === 0, broken, unverifiable };
}

export const renderChain = (chain) =>
  chain.links.map((l) => (l.parseAs ? l.ref : `${l.ref} (unverified)`)).join('  ->  ');
