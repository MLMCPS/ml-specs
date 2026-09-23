// The comment-delimiter strippers. Spec 0014 §4.2 row 5d, §4.2.3, AC60/AC61/AC63.
//
// TWO exported functions, because the two call sites need DIFFERENT INVARIANTS —
// one implementation each, and neither call site keeps a copy of either:
//   stripComments  host text a renderer will parse (quoted() in lib/scm.mjs).
//                  Every opener that can swallow what follows has to go, because
//                  a bogus opener in a quoted reviewer comment hides the tool's
//                  own reply and its marker behind it.
//   stripMarkers   the tool's OWN reply body (parseFrom in lib/pr-address.mjs).
//                  The only invariant needed there is "no foreign marker
//                  survives", and the hardening set is actively WRONG on it:
//                  `List<?>` became `List>`, `Map<?,?>` became `Map,?>` and
//                  `<?xml version="1.0"?>` lost its opener — the operator's own
//                  prose, corrupted and then posted to the reviewer under the
//                  tool's account. AC61 extended the set for the host path and
//                  applied it to both; that was the regression, and AC63 is the
//                  split that fixes it.
//
// This module exists because the algorithm was DUPLICATED — lib/scm.mjs's
// quoted() had one copy and lib/pr-address.mjs's parseFrom had another, near
// identical and drifting apart. Neither was exported, so the AC55 corpus
// property could only reach the pr-address copy: reverting ONLY the scm.mjs copy
// to a single pass left 360/360 green while re-opening a live bare-opener splice
// on the GitHub quote-back path — the attacker-facing one. The class was closed
// on the module that does not face the attacker and left open on the one that
// does. One implementation, one property, both call sites covered BY
// CONSTRUCTION rather than by coincidence.
//
// Pure, and with NO IMPORTS: lib/pr-address.mjs states "Pure: no I/O, no
// transport, no process" and imports nothing, so it cannot reach into lib/scm.mjs
// (which would pull in lib/http.mjs). This module has to be importable from both
// sides of that line, which means it may import neither.

/** Complete `<!-- ... -->` pairs, non-greedy. */
const PAIR = /<!--[\s\S]*?-->/g;

/**
 * Every opener a tokenizer recognises, plus both closers.
 *
 * NOT just the `--` family. HTML enters BOGUS COMMENT STATE on `<!` followed by
 * anything that is not `--`, on `<?`, and on `</` before a non-letter — so `<!x`,
 * `<![CDATA[` and `<?php` each open a comment-like region that swallows what
 * follows, doing exactly the damage a bare `<!--` does: the tool's own reply and
 * its marker go invisible while the raw body still carries the marker, so the
 * operator is told "replied" and the next run skips that comment forever.
 *
 * The sixth security review verified `"> <!x nothing to see here\n\nfixed it\n\n<marker>"`
 * reaching the wire through the real adapter and returned INCONCLUSIVE — not
 * clean — because whether a given host's sanitiser happens to drop the rest is
 * not knowable from this repo. Stripping the forms makes the question moot
 * instead of leaving it unanswered by a renderer nobody here can test.
 *
 * `</` before a LETTER is an ordinary end tag and is left alone; the alternation
 * is ordered so `<!--` is consumed as a delimiter rather than as `<!` + `--`.
 */
const RESIDUAL = /<!--|--!?>|<[!?]|<\/(?![A-Za-z])/g;

/**
 * Remove every comment delimiter from host-supplied text, TO A FIXED POINT.
 *
 * Two loops, and both are load-bearing. Five review rounds found five variants of
 * ONE bug, because each fix was written against the previous round's literal
 * payload:
 *   r2  `<<!--X-->!-- ml-specs:pr-address 99 T <!--Y-->-->` — one non-greedy pass
 *       removes the two inner comments and RECONSTRUCTS the outer one, yielding
 *       exactly replyMarker('99','T'). Reachable with no prompt injection and no
 *       agent: GitHub's conversation / review-summary reply path quotes the source
 *       body back verbatim, so the reconstructed marker is posted by the TOOL'S OWN
 *       account and the authorship check then endorses it.
 *   r4  a dangling `<!--` survives the pair loop BY CONSTRUCTION — the loop removes
 *       PAIRS, and an unterminated opener has no pair — and hides everything after
 *       it in the renderer.
 *   r5  the single-pass neutralisation SPLICED ITS NEIGHBOURS into a fresh
 *       delimiter: `<-->!--` loses the `-->` at index 1 and becomes `<` + `!--` ==
 *       `<!--`; `<-->!-- ml-specs:pr-address 99 T ---->>` becomes a complete FOREIGN
 *       MARKER, resurrecting r2 through its own fix.
 *   r6  the fix lived in two places and only one was under test (above).
 *
 * Looping both replaces to a JOINT fixed point closes the class: it terminates
 * because both replaces only delete, so every iteration strictly shortens the
 * string. The property "no delimiter survives" is asserted over an exhaustive
 * generated corpus in comment-text.test.mjs, against THIS export — not against a
 * payload, and not against a local copy of these regexes.
 *
 * governedReply() still asserts the result at the sink (lib/scm.mjs), because an
 * invariant this load-bearing should not live at the sources alone.
 */
export const stripComments = (text) => {
  let out = String(text ?? '');
  for (;;) {
    const next = out.replace(PAIR, '');
    if (next === out) break;
    out = next;
  }
  for (;;) {
    const next = out.replace(PAIR, '').replace(RESIDUAL, '');
    if (next === out) return next;
    out = next;
  }
};

/**
 * The marker delimiters, and NOTHING ELSE: the pair openers and closers a
 * well-formed `<!-- ml-specs:pr-address … -->` marker is spelled with.
 *
 * `<!`, `<?` and `</` are deliberately absent. They belong to the rendering
 * hazard on HOST text, not to the marker class, and applying them to the tool's
 * own reply body rewrites ordinary prose the operator wrote.
 */
const MARKER_DELIM = /<!--|-->/g;

/**
 * Remove every MARKER delimiter from the tool's own reply body, to a fixed point.
 *
 * The invariant here is narrower than stripComments' and it is the only one this
 * call site needs: NO FOREIGN MARKER SURVIVES. A marker is an HTML comment
 * carrying the tag (MARKER_RE in lib/scm.mjs), so a body from which every `<!--`
 * and every `-->` has been removed cannot carry one — whatever else it contains.
 *
 * Why not the full hardening set, when AC61 applied it here too: this is the
 * OPERATOR'S text, not a stranger's. Stripping `<?` and `<!` from it turned
 * `List<?>` into `List>`, `Map<?,?>` into `Map,?>` and `<?xml version="1.0"?>`
 * into `xml version="1.0"?>`, and posted the mangled result to the reviewer as
 * the tool's answer. Corrupting an answer is not a security control; it is a
 * different way of lying about what was written.
 *
 * Still a FIXED POINT, for the r5 reason and not for symmetry: a single pass
 * splices its own neighbours into a fresh delimiter — `<-->!--` loses the `-->`
 * at index 1 and becomes `<!--`. The loop terminates because both replaces only
 * delete, so every iteration strictly shortens the string.
 */
export const stripMarkers = (text) => {
  let out = String(text ?? '');
  for (;;) {
    const next = out.replace(PAIR, '');
    if (next === out) break;
    out = next;
  }
  for (;;) {
    const next = out.replace(PAIR, '').replace(MARKER_DELIM, '');
    if (next === out) return next;
    out = next;
  }
};

/**
 * The delimiter set, exported so a test can assert "none survives" without
 * retyping the regexes it is checking.
 *
 * A test that spells out its own copy of the production pattern proves a claim
 * about a MODEL of the code rather than about the code — the trap the AC55
 * non-vacuity guard fell into. `lastIndex` makes a shared /g regex stateful
 * across .test() calls, so this is a factory, not a constant.
 */
export const anyDelimiter = () => new RegExp(RESIDUAL.source, 'g');

/**
 * One pass of the same algorithm, exported ONLY so the non-vacuity guard can show
 * that the corpus still contains inputs a single pass fails to clean.
 *
 * Derived from the same PAIR and RESIDUAL constants the real stripper uses, so
 * "this input defeats a single pass" stays a statement about production code. It
 * is not a production entry point: nothing but the test imports it.
 */
export const onePass = (text) => String(text ?? '').replace(PAIR, '').replace(RESIDUAL, '');
