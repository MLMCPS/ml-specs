// The decisions `/ml-specs:pr-address` makes, lifted out of the CLI so they are
// testable in-process.
//
// scripts/pr-address.mjs is deliberately thin: it parses argv, builds an adapter
// and prints. Everything that can be WRONG — which entries have no comment behind
// them, what a malformed --from file means, which environment variables the
// resolved host actually needs — lives here, where a test can reach it without an
// execFileSync child. A guard asserted only through a subprocess is asserted only
// by its exit code.
//
// Pure: no I/O, no transport, no process. The one import is lib/comment-text.mjs,
// which is import-free for exactly this reason — reaching into lib/scm.mjs for the
// same function would pull lib/http.mjs in behind it and cost this module its
// purity.
//
// The gate itself is NOT here. governedReply() in lib/scm.mjs owns it, because it
// has to fetch its own evidence, and evidence a caller supplies is not evidence.

import { stripMarkers } from './comment-text.mjs';

/**
 * The ids `list` emits, and nothing else.
 *
 * Both hosts' ids are COMPOSITE and the two composites differ in shape:
 *   ADO     "<threadId>.<commentId>"  — ADO numbers comments per thread
 *   GitHub  "<kind>.<hostId>"         — three endpoints, three id spaces
 * plus a bare host number, which is what an id looked like before either
 * composite existed and what an operator may still paste.
 *
 * The kind is enumerated rather than matched as \w+: this string reaches a URL
 * path and the text of a posted body, so the accepted set stays exactly the set
 * lib/scm.mjs can produce.
 */
export const COMMENT_ID_RE = /^(?:(?:inline|conversation|review-summary)\.\d+|\d+(?:\.\d+)?)$/;

/** Thrown by parseFrom, so the CLI can map "unreadable --from" to exit 2 (could
 *  not run) rather than guessing it was a failure to reply. */
export class FromFileError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FromFileError';
  }
}

/**
 * Strip control characters from host-supplied text before it reaches a terminal.
 *
 * A comment body is written by an untrusted third party — on a public repo, by
 * anyone — and the non-JSON `list` output is the summary the operator triages
 * from. Without this a commenter controls ANSI/CSI escape sequences on that
 * terminal: cursor moves that overwrite the line above, colour that disguises one
 * comment as another, in the very view used to decide what gets implemented.
 *
 * Applied AFTER whitespace is collapsed, so newlines and tabs still separate
 * words rather than being deleted between them.
 *
 * The class covers C0 (\x00-\x1f), DEL (\x7f) AND C1 (\x80-\x9f). C1 is not
 * decoration: \x9b is a single-byte CSI, so a terminal reading UTF-8 or Latin-1
 * can act on it exactly as it would on ESC-[. Stripping only C0 leaves half the
 * escape space in the commenter's hands.
 *
 * Every host-supplied column goes through this — body, author AND the
 * `path:line` column, which is host-supplied too (an ADO `threadContext.filePath`
 * is whatever the host returns).
 */
export const printable = (value) => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, '');

/**
 * The same guard for a --json payload, and NARROWER on purpose.
 *
 * `printable()` strips C0, which includes `\n` — so `printable(JSON.stringify(x,
 * null, 2))` collapsed the whole document onto one line and made the `null, 2`
 * argument dead. At this sink only the C1 block and DEL are needed, because
 * JSON.stringify already escapes every C0 character INSIDE a string (`\x1b`
 * leaves as the six characters `\u001b`) while passing C1 through verbatim —
 * and `\x9b` is a single-byte CSI a terminal acts on exactly as it does on
 * ESC-[. The only C0 left in the serialized text is the formatter's own
 * newlines and indentation, which is precisely what must survive.
 *
 * The human-readable `list` table still uses printable(): there the strings are
 * host-supplied and unescaped, so the full class applies.
 */
export const printableJson = (value) => String(value ?? '').replace(/[\x7f-\x9f]/g, '');

/**
 * The --from file: a JSON array of `{ commentId, body }`, and nothing else.
 *
 * `threadId`, `kind` and `updatedAt` are deliberately absent. `reply` re-fetches
 * the comment list, so those come from the fetch and CANNOT disagree with it — a
 * caller-supplied `updatedAt` would either double-post or write a marker that
 * never matches again.
 *
 * Every body has its MARKER DELIMITERS STRIPPED — stripMarkers() in
 * lib/comment-text.mjs, imported, not copied. A body that carries
 * `<!-- ml-specs:pr-address 99 T -->` would otherwise plant a marker naming a
 * DIFFERENT comment, and alreadyAnswered() would read comment 99 as answered
 * forever after. The only marker a reply may carry is the one governedReply()
 * appends for the comment it is actually answering.
 *
 * THE NARROWER STRIPPER, not quoted()'s (§4.2.3, AC63). quoted() handles host
 * text a renderer will parse and needs every opener that can swallow what
 * follows; this handles the tool's OWN body, where the only invariant is "no
 * foreign marker survives". Running the hardening set here corrupted the
 * operator's prose on its way to the reviewer — `List<?>` posted as `List>`,
 * `Map<?,?>` as `Map,?>`, an XML snippet with its opener gone. Both strippers
 * still run to a fixed point, and both live in the one module (AC60).
 */
export function parseFrom(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new FromFileError(`--from is not valid JSON: ${e.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new FromFileError(
      `--from must be a JSON array of { commentId, body }, got ${parsed === null ? 'null' : typeof parsed}`);
  }
  return parsed.map((entry, i) => {
    if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new FromFileError(`--from entry ${i} is not an object with commentId and body`);
    }
    const commentId = entry.commentId ?? entry.comment_id;
    if (commentId == null || String(commentId).trim() === '') {
      throw new FromFileError(`--from entry ${i} has no commentId`);
    }
    // A comment id is COMPOSITE on both hosts (§4.2.1), and the two composites
    // differ: "<threadId>.<commentId>" on ADO, because ADO numbers comments per
    // thread; "<kind>.<hostId>" on GitHub, because the three endpoints the
    // adapter flattens are three independent id spaces. Either form, and a bare
    // host number, is accepted; nothing else is.
    //
    // The charset is a security control as much as a validation: this value is
    // interpolated into a URL path and into the marker text of a posted body, so
    // it is refused here rather than encoded and sent — the same rule
    // scripts/pr-address.mjs applies to <pr>. The operator copies the id verbatim
    // out of `list` output and never parses it, so the accepted set is exactly
    // what `list` emits.
    if (!COMMENT_ID_RE.test(String(commentId).trim())) {
      throw new FromFileError(
        `--from entry ${i} has a commentId that is not a comment id: ${JSON.stringify(String(commentId))}`);
    }
    if (typeof entry.body !== 'string') {
      throw new FromFileError(`--from entry ${i} (comment ${commentId}) has no body`);
    }
    // .trim() here, not in the stripper: quoted() needs the untrimmed result.
    const body = stripMarkers(entry.body).trim();
    if (body === '') {
      throw new FromFileError(`--from entry ${i} (comment ${commentId}) has no body`);
    }
    return { commentId: String(commentId).trim(), body };
  });
}

/**
 * Pair each --from entry with the comment it claims to answer.
 *
 * An entry naming a comment that is not on the pull request is REPORTED and
 * skipped; the remaining entries still post. Refusing the whole batch would make
 * one stale id cost every reply, and posting silently would let a typo look like
 * a delivered answer.
 *
 * A REPEATED commentId is skipped the same way, and that is a correctness
 * requirement rather than tidiness (§4.3, AC64). governedReply now fetches its
 * evidence ONCE PER RUN — the alternative was re-paginating three endpoints for
 * every entry — so `alreadyAnswered` cannot see a reply land mid-run. Without
 * this refusal, two entries naming the same comment would BOTH post: the second
 * one reads the same cached list the first one did. A --from file naming one
 * comment twice is an operator error worth surfacing in its own right, so it is
 * reported rather than silently collapsed.
 */
export function planReplies(comments, entries) {
  const byId = new Map((comments ?? []).map((c) => [String(c.id), c]));
  const posts = [];
  const skipped = [];
  const seen = new Set();
  for (const entry of entries ?? []) {
    const id = String(entry.commentId);
    const comment = byId.get(id);
    if (!comment) {
      skipped.push({ ...entry, reason: `comment ${entry.commentId} is not on this pull request` });
      continue;
    }
    if (seen.has(id)) {
      skipped.push({ ...entry,
        reason: `comment ${entry.commentId} is named more than once in --from; only the first reply is posted` });
      continue;
    }
    seen.add(id);
    posts.push({ ...entry, comment });
  }
  return { posts, skipped };
}

/**
 * Fold the per-comment outcomes of a `reply` run into what the operator is told
 * and what the process exits with.
 *
 * EXTRACTED FROM THE CLI ON PURPOSE. Inline, the refusal branch had no coverage
 * at any level: rewriting the catch around governedReply() so that every refusal
 * was reported as `posted: true` left the suite green and exited 0 — every
 * refused reply announced to the operator as delivered, which is the silent false
 * receipt this command exists to prevent. Here a synthetic refusal is one
 * assertion.
 *
 * An outcome is `{ commentId, result, error, kind }`:
 *   - `error` set            -> failed. ALWAYS, and never posted: an outcome that
 *                               threw delivered nothing, whatever else it claims.
 *   - `result.skipped` set   -> skipped. Already answered at this revision — a
 *                               success, and NOT a reason to exit 1.
 *   - `result.posted === true` -> posted.
 *   - anything else          -> failed. A reply that cannot show it was delivered
 *                               is not a delivery; "neither" fails closed.
 *
 * `kind` only labels a failure for printing ('unmatched' for an entry with no
 * comment behind it, 'refused' for a gate refusal). It never decides the bucket.
 *
 * `exit` follows spec-gate.mjs:21 — 1 if anything failed, else 0. A run where
 * every comment was deferred or already answered is a 0.
 */
export function foldResults(outcomes) {
  const posted = [];
  const skipped = [];
  const failed = [];

  for (const o of outcomes ?? []) {
    const commentId = String(o?.commentId ?? '');
    if (o?.error != null) {
      failed.push({ commentId, kind: o?.kind ?? 'refused', reason: String(o.error?.message ?? o.error) });
      continue;
    }
    const result = o?.result ?? null;
    if (result?.skipped) { skipped.push({ commentId, reason: String(result.skipped) }); continue; }
    if (result?.posted === true) { posted.push({ commentId }); continue; }
    failed.push({ commentId, kind: o?.kind ?? 'undelivered',
      reason: 'no reply was delivered, and nothing said why' });
  }

  return { posted, skipped, failed, exit: failed.length ? 1 : 0 };
}

// Which variables each host needs, and the config key scmConfig() reads each into
// (lib/cli.mjs:32-37). Named per tool so a message can never advertise the other
// host's variables — being told to set ADO_PAT when GITHUB_TOKEN is what is
// missing costs more time than no message at all.
const CREDENTIALS = {
  github: { GITHUB_OWNER: 'owner', GITHUB_TOKEN: 'token' },
  'ado-repos': { ADO_ORG: 'org', ADO_PROJECT: 'project', ADO_PAT: 'pat' },
};

/**
 * A message naming what is missing, or null when the host can be reached.
 *
 * This is a NEW convention: no script checks credentials today — scmConfig()
 * hands empty strings to the adapter and the failure surfaces at the network, as
 * a 401 against a URL with an empty organisation in it. That is a "could not run"
 * condition wearing a failure's clothes, so it is answered before any request.
 *
 * The unknown-tool fallback is ADO, matching scmConfig()'s own silent else.
 */
export function missingCredentials(tool, config = {}) {
  const resolved = CREDENTIALS[tool] ? tool : 'ado-repos';
  const absent = Object.entries(CREDENTIALS[resolved])
    .filter(([, key]) => String(config?.[key] ?? '').trim() === '')
    .map(([variable]) => variable);
  if (!absent.length) return null;
  return `no credentials for ${resolved}: set ${absent.join(', ')}`;
}
