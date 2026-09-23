#!/usr/bin/env node
// Read an open pull request's review feedback, and reply on the threads once the
// work is actually pushed.
//
//   node pr-address.mjs list 42 --repo api-neelias --json
//   node pr-address.mjs list 42 --repo api-neelias --dry-run
//   node pr-address.mjs reply 42 --repo api-neelias --from replies.json --head $(git rev-parse HEAD)
//   node pr-address.mjs reply 42 --repo api-neelias --from deferred.json --deferred
//
// Pure Node, no dependencies, no network calls beyond the host API. Credentials
// from the environment, never from a file in the repo.
//
// THIS SCRIPT RESOLVES NOTHING IT WAS NOT TOLD. The repository and the local HEAD
// both arrive as flags, because /ml-specs:pr-address owns that resolution and no
// script in this repo shells out to git. A missing --repo is therefore a usage
// error, not something to infer from a remote URL.
//
// The two paths take DIFFERENT objects, and that is the design:
//   list  → readOnlyScm(), which has no write method at all, so it physically
//           cannot post however the prose above it is misread.
//   reply → governedReply(), which fetches its own pull request and refuses to
//           claim anything about work that is not pushed.
//
// Exit codes follow spec-gate.mjs:21 — 0 success, 1 at least one failure (a
// refusal, an entry with no comment behind it, a partial batch), 2 could not run
// (no credentials, unreadable --from, missing --repo, neither or both of
// --head/--deferred). A run in which everything was deferred and nothing posted
// is a 0: deferral is a first-class outcome.
//
// NOTHING CALLS process.exit() ON A SUCCESS PATH. process.exit() abandons
// whatever console.log() has queued, and a write to a PIPE larger than the pipe
// buffer is queued rather than finished — measured, 70000 bytes in and 65536 out.
// Step 2 of /ml-specs:pr-address PIPES `list --json` to the agent, so a busy pull
// request yielded JSON cut mid-token. The exit code is set on process.exitCode
// and the process is allowed to end on its own, which flushes first.

import { readFileSync } from 'node:fs';
import { adoRepos, github, readOnlyScm, governedReply } from './lib/scm.mjs';
import { planReplies, parseFrom, missingCredentials, printable, printableJson, foldResults,
         FromFileError } from './lib/pr-address.mjs';
import { args, colours, transportFor, scmConfig, printTranscript } from './lib/cli.mjs';

const USAGE = 'usage: pr-address.mjs list <pr> --repo <repo> [--json] [--dry-run]\n'
  + '       pr-address.mjs reply <pr> --repo <repo> --from <file> (--head <sha> | --deferred) [--dry-run]';

const { positional, flag, has, json, dryRun } = args();
const [action, prId] = positional;
const C = colours(process.stdout.isTTY && !json);

if (!['list', 'reply'].includes(action) || !prId) { console.error(USAGE); process.exit(2); }

// A pull request id is a number on both hosts, and it is interpolated into a URL
// path. Anything else is a caller error, refused here rather than encoded and
// sent — a `..` or a `?` in that position reshapes the request.
if (!/^\d+$/.test(String(prId))) {
  console.error(`${USAGE}\n\n<pr> must be a pull request NUMBER, got "${prId}".`);
  process.exit(2);
}

const repo = flag('repo');
if (!repo) {
  console.error(`${USAGE}\n\n--repo is required: /ml-specs:pr-address resolves the repository and passes it in.`);
  process.exit(2);
}

const transport = transportFor(dryRun);
const { tool, config } = scmConfig(transport);

// --dry-run short-circuits the credential check on purpose: the transport is a
// recorder, so nothing leaves the machine, and requiring credentials to preview a
// request that is never sent would make the preview useless in CI.
if (!dryRun) {
  const missing = missingCredentials(tool, config);
  if (missing) { console.error(missing); process.exit(2); }
}

const base = tool === 'github' ? github(config) : adoRepos(config);

// A warning can quote the host's own response, so it is host-derived text on its
// way to a terminal exactly as a comment body is — printable() applies here for
// the same reason it applies to the list table.
const warn = (warnings) => { for (const w of warnings ?? []) console.error(C.yellow(`warning: ${printable(w)}`)); };

if (action === 'list') {
  // The read-only view. It has no replyToReviewComment to call.
  const scm = readOnlyScm(base);
  let comments;
  try {
    comments = await scm.listReviewComments(repo, prId);
  } catch (e) {
    // 1, not 2 — and the SAME failure exits 2 on the reply path below. The
    // asymmetry is deliberate: here the read IS the operation, so a host that
    // answered and failed is a run that ran and failed. On `reply` the read is
    // evidence gathered BEFORE anything is attempted, so without it no entry can
    // be evaluated at all — "could not run", per spec-gate.mjs:21.
    console.error(`could not read review comments for ${repo} pull request ${prId}: ${printable(e.message)}`);
    process.exit(1);
  }
  warn(comments.warnings);

  // Ordered oldest first, ids as strings, and the tool's OWN replies included —
  // the isOwnReply filter belongs to the command, so this stays a faithful view
  // of the host rather than a pre-judged one.
  const ordered = [...comments].sort((a, b) => String(a.updatedAt ?? '').localeCompare(String(b.updatedAt ?? '')));

  if (json) {
    // The JSON path is a terminal sink too. JSON.stringify escapes C0 — so \x1b
    // leaves as the six characters `\u001b` — but it passes C1 THROUGH VERBATIM,
    // and \x9b is a single-byte CSI a terminal acts on exactly as it would on
    // ESC-[. Stripping the serialized text (rather than each field) keeps one
    // rule for every string in the payload, including ones added later.
    //
    // printableJson, NOT printable: printable strips C0, and C0 includes `\n`.
    // Run over a serialized document it deleted the formatter's own newlines,
    // collapsed the whole payload onto one line and made `null, 2` dead — while
    // adding nothing, because the only C0 left after JSON.stringify is that
    // formatting. The narrower class is the whole of what this sink needs.
    console.log(printableJson(JSON.stringify(ordered, null, 2)));
  } else {
    for (const c of ordered) {
      // EVERY host-supplied column is stripped of control characters before it
      // reaches the terminal — body, author AND the path:line column. A commenter
      // must not own the operator's escape sequences in the very summary the
      // triage decision is made from, and `path` is as host-supplied as the rest:
      // an ADO threadContext.filePath is whatever the host returned. Whitespace is
      // collapsed first so words still separate.
      const where = printable(c.path ? `${c.path}${c.line == null ? '' : `:${c.line}`}` : '—');
      const first = printable(c.body.replace(/\s+/g, ' ')).trim().slice(0, 60);
      console.log(`${c.kind.padEnd(14)} ${where.padEnd(28)} ${printable(c.author).padEnd(18)} ${C.dim(first)}`);
    }
    if (!ordered.length) console.log(C.dim('no review comments on this pull request'));
    printTranscript(transport, C);
  }
  // No process.exit(0) here: a successful `list` is exactly the payload that gets
  // piped, and exiting would truncate it at the pipe buffer. Falling off the end
  // of the module exits 0 once stdout has drained.
}

// --- reply -------------------------------------------------------------------

if (action === 'reply') {
  const fromPath = flag('from');
  if (!fromPath) { console.error(`${USAGE}\n\nreply requires --from <file>.`); process.exit(2); }

  let entries;
  try {
    entries = parseFrom(readFileSync(fromPath, 'utf8'));
  } catch (e) {
    // Unreadable or malformed --from is a COULD NOT RUN, not a failed reply: no
    // thread was touched and none would have been.
    console.error(e instanceof FromFileError ? e.message : `could not read --from ${fromPath}: ${e.message}`);
    process.exit(2);
  }

  // A deferred comment — one refused as contract-changing — still gets a reply, on
  // a run that may have committed nothing. The head check does not apply to it;
  // nothing else about the gate is relaxed.
  //
  // EXACTLY ONE of --head / --deferred, read ONCE into these two constants and used
  // everywhere below. Neither flag is a usage error naming the one that is missing;
  // both together is refused rather than letting --deferred silently win over the
  // gate it bypasses — a gate-bypass switch must not be combinable with the gate it
  // bypasses. Reading each flag exactly once is also what makes the wiring
  // observable: rename either and this alternation stops behaving.
  const deferred = has('deferred');
  const head = flag('head');
  if (deferred && head) {
    console.error(`${USAGE}\n\n--deferred bypasses the head check, so it cannot be combined with --head.`);
    process.exit(2);
  }
  if (!deferred && !head) {
    console.error(`${USAGE}\n\nreply requires --head <sha> (the local HEAD this run pushed), `
      + 'or --deferred for comments refused as contract changes.');
    process.exit(2);
  }
  const gate = governedReply(base, { localHead: head });

  let listed;
  try {
    listed = await base.listReviewComments(repo, prId);
  } catch (e) {
    // 2, where the identical failure on `list` above exits 1. See the note there:
    // this read is the evidence every entry is planned against, and it happens
    // before a single reply is attempted, so the run could not be evaluated rather
    // than evaluated and found failing.
    console.error(`could not read review comments for ${repo} pull request ${prId}: ${printable(e.message)}`);
    process.exit(2);
  }
  warn(listed.warnings);

  const { posts, skipped } = planReplies(listed, entries);

  // One OUTCOME per entry, raw: the gate's own return value, or the error it threw.
  // Nothing is classified here. foldResults() decides what counts as delivered,
  // because this loop is where the accounting was wrong before — reporting a
  // refusal as `posted: true` exited 0 with the suite green, and every refused
  // reply reached the operator as a receipt. An entry with no comment behind it is
  // an outcome too, so the exit code has ONE source rather than two.
  const outcomes = skipped.map((s) => ({ commentId: s.commentId, kind: 'unmatched', error: s.reason }));
  for (const p of posts) {
    try {
      const result = await gate.replyFor(repo, prId, p.commentId, p.body, { deferred });
      outcomes.push({ commentId: p.commentId, kind: 'refused', result, error: null });
    } catch (e) {
      // One refusal must not hide the replies that did land — it is recorded, not
      // thrown, and it is recorded AS THE ERROR so the fold cannot read it as a
      // delivery.
      outcomes.push({ commentId: p.commentId, kind: 'refused', result: null, error: e });
    }
  }

  const folded = foldResults(outcomes);
  if (json) {
    // `head` and `deferred` are reported as the gate received them: they are the
    // only observable of what this run claimed, and what the two flags actually
    // wired up. The three buckets are the fold's, so what is printed and what the
    // process exits with cannot disagree.
    // printableJson() for the same reason as the list path: `failed[].reason`
    // quotes the host's own error, and lib/http.mjs:27 carries up to 500
    // characters of response body into it. JSON.stringify escapes C0 and NOT C1,
    // so the --json branch was the one reply output still handing a commenter the
    // operator's escape space — and the C1 class is all this sink may strip,
    // because the C0 left in a serialized document is the indentation itself.
    console.log(printableJson(JSON.stringify({ repo, pr: String(prId), head, deferred, ...folded }, null, 2)));
  } else {
    // EVERY reason printed here is host-derived: a refusal quotes the host's own
    // error, and lib/http.mjs:27 carries up to 500 characters of response body into
    // it with its control characters intact. The reply path is as much a terminal
    // sink as the list table, so it strips the same way.
    for (const f of folded.failed) {
      const label = f.kind === 'unmatched' ? C.red('skipped') : C.red('refused');
      console.log(`  ${label} ${f.commentId.padEnd(14)} ${C.dim(printable(f.reason))}`);
    }
    for (const s of folded.skipped) console.log(`  ${C.dim(`already  ${s.commentId.padEnd(14)} ${printable(s.reason)}`)}`);
    for (const r of folded.posted) {
      console.log(`  ${C.green('replied')} ${r.commentId.padEnd(14)}${deferred ? C.dim(' (deferred)') : ''}`);
    }
    printTranscript(transport, C);
  }

  // Set, never called: process.exit() here would drop a --json summary bigger
  // than the pipe buffer the same way it dropped the list payload above. The
  // fold is still the ONE source of the exit code.
  process.exitCode = folded.exit;
}
