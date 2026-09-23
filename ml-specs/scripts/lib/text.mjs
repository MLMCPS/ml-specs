// Reading a Markdown artifact somebody else's editor wrote.
//
// WHY THIS EXISTS
//
// Every parser in this toolkit split on `'\n'`. On a Windows checkout, or with
// `core.autocrlf=true`, or from an editor configured for CRLF, a spec's lines end `\r\n` — so
// `split('\n')` leaves a trailing `\r` on every one of them. The symptoms are not "the file has
// odd line endings"; they are:
//
//   · a `Status` cell parses as `Approved\r`, matches no lifecycle value, and the gate refuses a
//     transition for a status it cannot name
//   · a §6 row naming `test/thing.test.mjs` resolves to `test/thing.test.mjs\r`, and the gate
//     reports a file that is sitting right there as missing
//   · a `Touches` path carries a `\r`, so the scope guard bounds writes to a path nothing matches
//
// Each of those reads as a broken toolkit rather than as a line-ending problem, which is what
// makes it expensive: the person hitting it has no reason to suspect the cause.
//
// ONE HELPER, NOT A FIX PER PARSER
//
// Eight call sites each handling `\r` their own way is eight chances to miss one, and the missed
// one is the one somebody hits. Spec 0062 AC3 asserts no Markdown parser splits on a bare `'\n'`
// any more, checked against the source — which is the only thing that keeps this true as parsers
// are added.
//
// Command output is NOT in scope. `git`, `sh` and HTTP responses are read with `split('\n')`
// elsewhere and that is correct: those are streams this toolkit asked for, not files a stranger's
// editor wrote.

/**
 * Split text into lines, whatever wrote it.
 *
 * Handles `\n`, `\r\n` and a lone trailing `\r`. A bare `\r` as a line separator — classic Mac,
 * pre-2001 — is deliberately not handled: no editor in use produces it, and treating it as a
 * separator would split a line that legitimately contains one.
 *
 * @param {string} text
 * @returns {string[]}
 */
export const lines = (text) => String(text ?? '').split(/\r?\n/).map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));

/**
 * The whole text with line endings normalised to `\n`, for when something needs the document
 * rather than its lines — a regex spanning lines, a digest, a comparison.
 *
 * @param {string} text
 * @returns {string}
 */
export const normalise = (text) => lines(text).join('\n');

/**
 * One line, trimmed of a trailing `\r` that survived a split somewhere else.
 *
 * Here because a caller that already has lines from another source should not have to reach for
 * `lines()` to clean one up, and `.trim()` is the wrong tool — it eats leading indentation that a
 * Markdown list item depends on.
 *
 * @param {string} line
 * @returns {string}
 */
export const unCr = (line) => (typeof line === 'string' && line.endsWith('\r') ? line.slice(0, -1) : line);
