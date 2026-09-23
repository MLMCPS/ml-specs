// Source control: branches and pull requests, for ADO Repos and GitHub.
//
// Deliberately separate from lib/tracker.mjs. A work item and a pull request are
// different objects owned by different systems, and they diverge under exactly
// the load this exists for: one spec fans out to N repositories but links to ONE
// work item, so the cardinality differs. GitHub-plus-Jira is also an ordinary
// combination that a merged interface could not express.
//
// GitHub ships alongside ADO because these customers migrate there for code
// while keeping Boards or Jira for work — the two boundaries move independently.
//
// Pure Node, no dependencies. Every call goes through an injected transport.

import { basicAuth, request } from './http.mjs';
import { branchName, prTitle, keyFrom, specId, testCaseId } from './trace.mjs';
import { stripComments } from './comment-text.mjs';

const EMPTY_SHA = '0'.repeat(40);

// --- review feedback: shared shape and the rules both adapters obey ----------
//
// The normalized comment is
//   { id, threadId, kind, path, line, body, author, authorKey, updatedAt,
//     resolved, isOwnReply }
// with `kind` one of 'inline' | 'review-summary' | 'conversation'. Ids are ALWAYS
// strings on both hosts, because every match downstream is string equality and a
// --from file writes them as JSON strings.
//
// `author` and `authorKey` are DIFFERENT FIELDS, and the difference is a security
// property. `author` is the display string the operator reads in `list` output.
// `authorKey` is the host's STABLE IDENTIFIER — GitHub `user.login`, ADO
// `author.id` — and it is the only thing the authorship check compares. On ADO a
// display name is not an identifier: on an MSA-backed organisation it is
// self-settable, so comparing display names would let a commenter defeat the
// whole check by renaming themselves to the operator.
//
// Two honest asymmetries are encoded here rather than papered over:
//   - `resolved` is null on GitHub, always. REST exposes no thread state, and
//     null means "not knowable on this host", never "not resolved".
//   - `threadId` on GitHub is SYNTHESIZED from the in_reply_to_id root; ADO has
//     native thread ids.

/** The idempotency marker. Pure, and the only thing that makes a reply recognisable. */
export const replyMarker = (commentId, updatedAt) =>
  `<!-- ml-specs:pr-address ${commentId} ${updatedAt} -->`;

/** Two identities are the same account: trimmed and case-folded, because GitHub
 *  logins are case-insensitive and ADO display names arrive padded.
 *
 *  Compared on `authorKey`, NEVER on the display name — see the note above.
 *
 *  An EMPTY identity never matches, in either position. A deleted or ghost host
 *  account arrives with an empty authorKey, and an unresolvable whoAmI() arrives
 *  empty too — comparing them as equal would hand a ghost-authored comment the
 *  tool's own trust. Unknown is not a value; it fails closed. */
const identity = (v) => String(v ?? '').trim().toLowerCase();
const sameAuthor = (a, b) => {
  const x = identity(a);
  return x !== '' && x === identity(b);
};

/**
 * Has this exact comment, at this exact revision, already been answered BY US?
 *
 * Keyed on (commentId, updatedAt) — the REVIEWER's timestamp, which this tool's
 * own commits do not move. Keying on the PR head sha re-answered every thread on
 * the next run, because the command's own push moves it.
 *
 * `selfAuthor` is not optional in spirit: BOTH inputs to the marker — a comment's
 * id and its updatedAt — are publicly readable from the host API, so without the
 * authorship check ANY commenter can post
 *   <!-- ml-specs:pr-address <someone else's id> <their updatedAt> -->
 * and that person's feedback is reported "already answered" on the next run. The
 * reviewer gets silence and the operator gets a false receipt. It also fires by
 * ACCIDENT: GitHub's "Quote reply" copies the raw HTML comment into the new body.
 * governedReply() resolves it from whoAmI() and always passes it.
 *
 * ARITY, not emptiness, selects the mode — the distinction matters:
 *   3 args  -> no authorship check was ASKED for (AC16's pure-helper form): the
 *              marker alone decides.
 *   4 args  -> an authorship check WAS asked for. If the identity is unresolvable
 *              it matches nothing, so an unknown identity trusts no marker rather
 *              than trusting every ghost-authored one.
 * Reading an empty selfAuthor as "no check" would collapse the second case into
 * the first and reopen the hole this parameter exists to close.
 */
export const alreadyAnswered = (comments, commentId, updatedAt, selfAuthor) => {
  const checkAuthor = selfAuthor !== undefined;
  return (comments ?? []).some((c) =>
    (!checkAuthor || sameAuthor(c.authorKey, selfAuthor))
    && String(c.body ?? '').includes(replyMarker(commentId, updatedAt)));
};

const MARKER_TAG = 'ml-specs:pr-address';
const hasMarker = (body) => String(body ?? '').includes(MARKER_TAG);
/** A WELL-FORMED marker — an HTML comment carrying the tag — not a bare mention
 *  of the tag in prose. The distinction is the difference between a control and
 *  a nuisance: only a well-formed marker is what alreadyAnswered() reads, while
 *  counting bare tags made a reviewer writing "mention ml-specs:pr-address in
 *  your reply" enough to refuse a legitimate answer. */
const MARKER_RE = /<!--\s*ml-specs:pr-address\b[\s\S]*?-->/g;
/** How many markers a body carries. Asserted at the transport boundary: the only
 *  marker a reply may leave with is the one the gate appended. */
const markerCount = (body) => (String(body ?? '').match(MARKER_RE) ?? []).length;

/**
 * THE INVARIANT AT THE SINK, asserted on the body actually handed to the
 * transport rather than on the fragment the gate appended.
 *
 * governedReply() composes `answer + marker`, but the GitHub conversation /
 * review-summary path then prepends the QUOTED source comment, so the payload the
 * host receives is not the string the gate checked. Checking only the fragment
 * left the one path where untrusted text joins the outgoing body unasserted.
 *
 * Two conditions, because an adapter cannot know which marker is legitimate:
 * quoting may add NO marker (`n !== markerCount(given)`), and a reply may leave
 * with at most one (`n > 1`). Together with governedReply's own "exactly one"
 * that pins the composed body to the gate's own marker and nothing else.
 */
const assertOneMarker = (outgoing, given, commentId) => {
  const n = markerCount(outgoing);
  if (n > 1 || n !== markerCount(given)) {
    throw new Error(
      `refusing to post a reply that carries a foreign ${MARKER_TAG} marker `
      + `(comment ${commentId}): a reply may carry only the marker this gate appends`);
  }
};

/** A marker is the tool's own reply only when the tool's own account wrote it —
 *  the same authorship rule alreadyAnswered() applies, compared on the stable
 *  `authorKey`, for the same reason. */
const ownReply = (body, authorKey, self) => hasMarker(body) && sameAuthor(authorKey, self);

/** Every interpolated PATH SEGMENT is encoded. repoBase() already did this at the
 *  branch/PR sites; the review-feedback sites did not, so a repo or id carrying
 *  `/`, `..`, `?` or `#` could reshape the URL it is pasted into — including
 *  flipping the query separator the paging loop appends. */
const seg = (v) => encodeURIComponent(String(v));

// A collection that is absent, or is not an array, is ZERO items — never a throw.
// --dry-run runs against recorder()'s DEFAULT_RESPONSE, whose shape belongs to
// the ref and work-item parsers, so every reader here has to survive it.
const listOf = (value) => (Array.isArray(value) ? value : []);

/**
 * ADO's normalized comment id: "<threadId>.<commentId>", because ADO's own is
 * NOT UNIQUE.
 *
 * ADO numbers comments PER THREAD, so two threads each carry a comment `id: 1`.
 * Flattened into one list those ids collide, and the two consumers disagree about
 * which duplicate wins: planReplies keys a Map on `id` and keeps the LAST, while
 * governedReply's `.find()` takes the FIRST — so a reply could be POSTed to the
 * wrong thread, answering a reviewer who asked nothing. The composite is globally
 * unique, keeps ONE matching rule (string equality) on both hosts, and leaves the
 * `{ commentId, body }` contract of --from untouched: the operator copies the id
 * verbatim out of `list` output and never parses it.
 *
 * Six review rounds missed the collision because every ADO fixture derived its
 * comment id as `thread.id * 10` — unique by construction, so no test could see it.
 */
const adoCommentId = (threadId, commentId) => `${threadId}.${commentId}`;

/** The HOST's comment id, back out of either composite above. ADO's reply body
 *  names a parentCommentId and GitHub's inline reply URL names a comment number;
 *  both fields are the host's own id, so the composite would address the wrong
 *  parent (ADO reads '101.1' as the float 101.1) or the wrong resource. */
const hostCommentId = (id) => {
  const s = String(id ?? '');
  const dot = s.lastIndexOf('.');
  return dot === -1 ? s : s.slice(dot + 1);
};

/** ADO's parentCommentId, as the host wants it: a number.
 *
 *  `Number(x) || 1` rewrote a parent id of 0 to 1 silently, which is a DIFFERENT
 *  comment rather than a fallback. Only a value that is not a non-negative
 *  integer at all falls back now, and the fallback is the thread's first comment,
 *  which is what ADO itself defaults to. */
const adoParentNumber = (id) => {
  const n = Number(hostCommentId(id));
  return Number.isInteger(n) && n >= 0 ? n : 1;
};

/**
 * GitHub's normalized comment id: "<kind>.<hostId>", because GitHub's own is NOT
 * UNIQUE ACROSS THE THREE ENDPOINTS this adapter flattens.
 *
 * /pulls/{n}/comments, /issues/{n}/comments and /pulls/{n}/reviews are three
 * different resources with three INDEPENDENT id sequences, and nothing makes them
 * mutually unique: an inline comment 42 and a review summary 42 both normalized
 * to '42'. The consequence is identical to ADO's (see adoCommentId above) —
 * planReplies keeps the LAST duplicate, governedReply's .find() takes the FIRST,
 * so the plan resolves one comment while the POST goes to the other, and the
 * marker is written with the wrong updatedAt: one comment is re-answered on every
 * run and the other is falsely recorded as answered. `list --json` also emitted a
 * duplicate id the operator could not address.
 *
 * Round 20 fixed exactly this on ADO and left it live here, which is how it
 * survived a seventh review round: a fix aimed at the host a report named is not
 * a fix of the class. The rule is now the same on both hosts — one composite, one
 * matching rule (string equality), and an id the operator copies verbatim out of
 * `list` and never parses.
 */
const ghCommentId = (kind, hostId) => `${kind}.${hostId}`;

// Only the first five lines are ever quoted, so the stripper never needs to see
// a whole 65k-character comment — and it MUST NOT, because `<!--[\s\S]*?-->`
// backtracks to the end of the string for every opener that has no closer: an
// opener-only body costs 0.68s at 65k characters and 45s at 524k, on the path a
// stranger's comment reaches. Truncating first bounds that at a few milliseconds.
// The cut is ~100 lines of prose, far more than the five that survive, so it
// changes nothing a reader would see; and cutting mid-delimiter is safe because
// `<!-` is itself a bogus-comment opener the stripper removes.
const QUOTE_SCAN_LIMIT = 8192;

/** Quote the comment being answered, so a non-threaded reply still has context.
 *  Comment delimiters are stripped first (lib/comment-text.mjs, the ONE
 *  implementation — parseFrom uses the same export): quoting one back would plant
 *  a marker that alreadyAnswered() could later read as an answer to a different
 *  comment, and a bare opener would hide this reply and its own marker behind it. */
const quoted = (body) => stripComments(String(body ?? '').slice(0, QUOTE_SCAN_LIMIT))
  .trim().split('\n').slice(0, 5).map((l) => `> ${l}`).join('\n');

/** A result is a bare Comment[] carrying a NON-ENUMERABLE `warnings` array.
 *  A library must not console on its own, and scm.mjs has no err()/warn()
 *  accumulator — that is a script pattern. This keeps one shape for every
 *  consumer (find/filter/deepEqual all ignore the property) while still letting
 *  the CLI print what was truncated. */
const withWarnings = (comments, warnings) => {
  Object.defineProperty(comments, 'warnings', { value: warnings, enumerable: false });
  return comments;
};

/**
 * Decide `isOwnReply` for a whole list, resolving the tool's identity AT MOST
 * ONCE and only when a marker is actually present.
 *
 * A marker carries no authority on its own: a third party can paste one, and
 * GitHub's "Quote reply" does it by accident. Identity therefore decides the
 * flag — and because the flag is what step 3 of /ml-specs:pr-address filters on,
 * trusting an unauthenticated marker would let a commenter remove their own
 * comment from triage.
 *
 * Lazy on purpose: a list with no marker in it needs no identity, so the common
 * case costs no extra request and ADO still makes exactly one call.
 */
const flagOwnReplies = async (comments, identityOf, warnings = []) => {
  if (!comments.some((c) => hasMarker(c.body))) return comments;
  // An identity that cannot be resolved must not take the whole listing down
  // with it. A commenter merely MENTIONING the marker tag is what triggers this
  // request, so a host that 401s or rate-limits here would otherwise kill `list`
  // and `reply` alike. Unresolvable is '', which matches nothing (sameAuthor
  // above): every marker is distrusted, and the operator is told why.
  let self = '';
  let threw = false;
  try {
    self = await identityOf();
  } catch (e) {
    threw = true;
    warnings.push(`could not resolve this tool's own identity (${e.message}); `
      + 'no reply marker is trusted, so an answered comment may be offered again');
  }
  // An identity that RESOLVES EMPTY is the same condition without the throw: a
  // host answering 200 with no `login` / no `authenticatedUser.id` — a GitHub
  // Actions GITHUB_TOKEN does exactly this — yields ''. It still fails closed,
  // which is why it was silent; but silent means the operator is never told why
  // every reply is re-posted on every run.
  if (!threw && String(self ?? '').trim() === '') {
    warnings.push("this tool's own identity resolved empty (the host returned no account id); "
      + 'no reply marker is trusted, so an answered comment may be offered again');
  }
  for (const c of comments) c.isOwnReply = ownReply(c.body, c.authorKey, self);
  return comments;
};

// No mechanism here may read a response header: request() discards the Response
// (lib/http.mjs:29-30), so Link and x-ms-continuationtoken are both unreachable.
// GitHub is therefore paged by SHORT PAGE, and the loop is bounded — a host that
// ignores `page`, or a recorder whose canned responses run out, would otherwise
// spin forever, the one failure mode here that hangs rather than failing safe.
const PER_PAGE = 100;
const MAX_PAGES = 100;

// --- Azure DevOps Repos ------------------------------------------------------

export function adoRepos({ org, project, pat, apiVersion = '7.1', transport = request }) {
  const repoBase = (repo) =>
    `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}`;
  const headers = { Authorization: basicAuth('', pat) };

  // The authenticated account, resolved AT MOST ONCE per adapter and then
  // memoized: it is what makes a marker trustworthy, and re-reading it per
  // comment would be a request per comment.
  let identity = null;
  const identityOf = () => (identity ??= (async () => {
    const raw = await transport(`https://dev.azure.com/${org}/_apis/connectionData?api-version=${apiVersion}`, { headers });
    // The ACCOUNT ID, never a display name. providerDisplayName is self-settable
    // on an MSA-backed organisation, so a commenter who renamed themselves to the
    // operator would defeat the authorship check outright.
    return String(raw?.authenticatedUser?.id ?? '');
  })());

  return {
    tool: 'ado-repos',

    /** Who this PAT is: the authenticated account's GUID, which is what a
     *  comment's `authorKey` carries. A display name is not an identifier. */
    async whoAmI() { return identityOf(); },

    async defaultBranchSha(repo, branch = 'main') {
      const res = await transport(`${repoBase(repo)}/refs?filter=heads/${branch}&api-version=${apiVersion}`, { headers });
      const refs = res.value ?? [];
      if (!refs.length) throw new Error(`ADO: ${repo} has no branch ${branch}`);
      return String(refs[0].objectId);
    },

    async createBranch(repo, name, fromSha) {
      // ADO has no "create branch" call — a branch is a ref updated from zeros.
      await transport(`${repoBase(repo)}/refs?api-version=${apiVersion}`, {
        method: 'POST', headers,
        body: [{ name: `refs/heads/${name}`, oldObjectId: EMPTY_SHA, newObjectId: fromSha }],
      });
      return { repo, name, sha: fromSha };
    },

    async openPullRequest(repo, { source, target, title, body }) {
      const raw = await transport(`${repoBase(repo)}/pullrequests?api-version=${apiVersion}`, {
        method: 'POST', headers,
        body: { sourceRefName: `refs/heads/${source}`, targetRefName: `refs/heads/${target}`,
                title, description: body },
      });
      const id = String(raw.pullRequestId ?? '');
      return { repo, id, title, source, target,
               url: `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequest/${id}` };
    },

    async findPullRequests(repo, key) {
      const res = await transport(
        `${repoBase(repo)}/pullrequests?searchCriteria.status=all&api-version=${apiVersion}`, { headers });
      return (res.value ?? [])
        .filter((pr) => keyFrom('prTitle', pr.title ?? '') === key)
        .map((pr) => ({ repo, id: String(pr.pullRequestId), title: pr.title,
          source: String(pr.sourceRefName ?? '').replace(/^refs\/heads\//, ''),
          target: String(pr.targetRefName ?? '').replace(/^refs\/heads\//, ''),
          url: `https://dev.azure.com/${org}/_git/${encodeURIComponent(repo)}/pullrequest/${pr.pullRequestId}` }));
    },

    async getPullRequest(repo, prId) {
      const raw = await transport(`${repoBase(repo)}/pullrequests/${seg(prId)}?api-version=${apiVersion}`, { headers });
      return {
        repo,
        id: String(raw?.pullRequestId ?? prId),
        // A string id, matching openPullRequest/findPullRequests. A new method
        // must not invent a second convention.
        headSha: raw?.head?.sha ?? raw?.lastMergeSourceCommit?.commitId ?? null,
        source: String(raw?.sourceRefName ?? '').replace(/^refs\/heads\//, ''),
        target: String(raw?.targetRefName ?? '').replace(/^refs\/heads\//, ''),
        url: `https://dev.azure.com/${org}/${seg(project)}/_git/${seg(repo)}/pullrequest/${seg(raw?.pullRequestId ?? prId)}`,
      };
    },

    async listReviewComments(repo, prId) {
      // ADO returns every thread in one response. That reading of the API is
      // UNVERIFIED (spec 0014 §8), so this does not assume it: a second request
      // goes out only if the BODY carries a continuation field. No header is
      // read, and being wrong costs an extra request rather than lost comments.
      const out = [];
      const warnings = [];
      let token = null;
      let page = 0;

      do {
        const url = `${repoBase(repo)}/pullRequests/${seg(prId)}/threads?api-version=${apiVersion}`
          + (token ? `&continuationToken=${encodeURIComponent(token)}` : '');
        const res = await transport(url, { headers });

        for (const thread of listOf(res?.value)) {
          const ctx = thread?.threadContext ?? null;
          const kind = ctx ? 'inline' : 'conversation';
          const status = String(thread?.status ?? '');
          // Thread status is meaningful for inline threads only, and `unknown`
          // is genuinely unknown — null, not false.
          const resolved = kind !== 'inline' || status === 'unknown' || status === ''
            ? null
            : !['active', 'pending'].includes(status);

          // A thread carrying no comments array is zero comments, not a throw:
          // under --dry-run the recorder hands back ref objects here.
          for (const c of listOf(thread?.comments)) {
            // System events ("refs updated", "X voted -10", reviewer added) and
            // deleted comments are not feedback and must never reach an agent.
            if (c?.commentType === 'system' || c?.isDeleted === true) continue;
            out.push({
              // "<threadId>.<commentId>": ADO's own id is per-thread and
              // therefore not unique once flattened — see adoCommentId.
              id: adoCommentId(String(thread?.id ?? ''), String(c?.id ?? '')),
              threadId: String(thread?.id ?? ''),
              kind,
              path: ctx?.filePath ?? null,
              // filePath with no rightFileStart is a FILE-level comment: a real
              // path, and no line.
              line: ctx?.rightFileStart?.line ?? null,
              body: String(c?.content ?? ''),
              // Display name for the operator to read; the account GUID for the
              // authorship check. Two fields, deliberately.
              author: c?.author?.displayName ?? '',
              authorKey: String(c?.author?.id ?? ''),
              updatedAt: c?.lastUpdatedDate ?? null,
              resolved,
              isOwnReply: false,   // decided below, once the identity is known
            });
          }
        }

        token = res?.continuationToken ?? null;
        page += 1;
      } while (token && page < MAX_PAGES);

      if (token) warnings.push(`ADO threads for pull request ${prId} truncated at the ${MAX_PAGES}-page bound`);
      await flagOwnReplies(out, identityOf, warnings);
      return withWarnings(out, warnings);
    },

    async replyToReviewComment(repo, prId, comment, body) {
      // The sink: what goes out is what is asserted. ADO posts the body
      // unchanged, so there is nothing between this line and the transport.
      assertOneMarker(body, body, comment.id);
      // The THREAD id, never the comment id: ADO addresses replies by thread.
      await transport(
        `${repoBase(repo)}/pullRequests/${seg(prId)}/threads/${seg(comment.threadId)}/comments?api-version=${apiVersion}`,
        { method: 'POST', headers,
          // The HOST's comment number, not the composite: `Number('101.1')` is
          // 101.1, which is not a parent any thread has.
          body: { content: body, commentType: 'text', parentCommentId: adoParentNumber(comment.id) } });
      return { repo, prId: String(prId), commentId: String(comment.id), threadId: String(comment.threadId) };
    },
  };
}

// --- GitHub ------------------------------------------------------------------

export function github({ owner, token, apiBase = 'https://api.github.com', transport = request }) {
  const headers = { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
  const url = (repo, path) => `${apiBase}/repos/${seg(owner)}/${seg(repo)}${path}`;

  // Resolved at most once per adapter, then memoized — see adoRepos above.
  let identity = null;
  const identityOf = () => (identity ??= (async () => {
    const raw = await transport(`${apiBase}/user`, { headers });
    return String(raw?.login ?? '');
  })());

  return {
    tool: 'github',

    /** Who this token is. A GitHub `login` is a unique handle rather than a
     *  display name, so on this host it is both `author` and `authorKey`. */
    async whoAmI() { return identityOf(); },

    async defaultBranchSha(repo, branch = 'main') {
      const raw = await transport(url(repo, `/git/ref/heads/${branch}`), { headers });
      return String(raw.object.sha);
    },

    async createBranch(repo, name, fromSha) {
      await transport(url(repo, '/git/refs'), {
        method: 'POST', headers, body: { ref: `refs/heads/${name}`, sha: fromSha } });
      return { repo, name, sha: fromSha };
    },

    async openPullRequest(repo, { source, target, title, body }) {
      // The shape difference from ADO: bare head/base, and it is called `body`.
      const raw = await transport(url(repo, '/pulls'), {
        method: 'POST', headers, body: { title, head: source, base: target, body } });
      return { repo, id: String(raw.number ?? ''), title, source, target,
               url: String(raw.html_url ?? `https://github.com/${owner}/${repo}/pulls`) };
    },

    async findPullRequests(repo, key) {
      const raw = await transport(url(repo, '/pulls?state=all&per_page=100'), { headers });
      return (raw ?? [])
        .filter((pr) => keyFrom('prTitle', pr.title ?? '') === key)
        .map((pr) => ({ repo, id: String(pr.number), title: pr.title,
          source: pr.head?.ref ?? '', target: pr.base?.ref ?? '', url: pr.html_url ?? '' }));
    },

    async getPullRequest(repo, prId) {
      const raw = await transport(url(repo, `/pulls/${seg(prId)}`), { headers });
      return {
        repo,
        id: String(raw?.number ?? prId),
        headSha: raw?.head?.sha ?? raw?.lastMergeSourceCommit?.commitId ?? null,
        source: raw?.head?.ref ?? '',
        target: raw?.base?.ref ?? '',
        url: String(raw?.html_url ?? `https://github.com/${seg(owner)}/${seg(repo)}/pull/${seg(prId)}`),
      };
    },

    async listReviewComments(repo, prId) {
      const warnings = [];

      /** Short-page paging: ask for 100, keep going while a page comes back FULL,
       *  stop on a short OR EMPTY one. Header-free by construction, and bounded —
       *  without the bound, a total that is an exact multiple of 100 loops. */
      const pages = async (path) => {
        const items = [];
        for (let page = 1; page <= MAX_PAGES; page += 1) {
          const sep = path.includes('?') ? '&' : '?';
          const res = await transport(url(repo, `${path}${sep}per_page=${PER_PAGE}&page=${page}`), { headers });
          const batch = listOf(res);
          items.push(...batch);
          if (batch.length < PER_PAGE) return items;
        }
        warnings.push(`GitHub ${path} for pull request ${prId} truncated at the ${MAX_PAGES}-page bound`);
        return items;
      };

      // All THREE endpoints, each paginated INDEPENDENTLY to exhaustion. Paging
      // only the inline endpoint and truncating the other two at GitHub's
      // default 30 is the silent-loss bug this shape exists to prevent.
      const inline = await pages(`/pulls/${seg(prId)}/comments`);
      const conversation = await pages(`/issues/${seg(prId)}/comments`);
      const reviews = await pages(`/pulls/${seg(prId)}/reviews`);

      const out = [];
      for (const c of inline) {
        out.push({
          // "<kind>.<hostId>": the three endpoints are three independent id
          // spaces — see ghCommentId.
          id: ghCommentId('inline', String(c?.id ?? '')),
          // Synthesized: a comment with no in_reply_to_id IS its own root. The
          // HOST's id, not the composite: a thread root is a host comment number.
          threadId: String(c?.in_reply_to_id ?? c?.id ?? ''),
          kind: 'inline',
          path: c?.path ?? null,
          line: c?.line ?? c?.original_line ?? null,
          body: String(c?.body ?? ''),
          // A GitHub login is already a unique handle, so the display string and
          // the authorship key are the same value here — unlike ADO.
          author: c?.user?.login ?? '',
          authorKey: c?.user?.login ?? '',
          updatedAt: c?.updated_at ?? null,
          resolved: null,   // REST exposes no thread state; isResolved is GraphQL-only.
          isOwnReply: false,   // decided below, once the identity is known
        });
      }
      for (const c of conversation) {
        out.push({
          id: ghCommentId('conversation', String(c?.id ?? '')), threadId: String(c?.id ?? ''), kind: 'conversation',
          path: null, line: null, body: String(c?.body ?? ''),
          author: c?.user?.login ?? '', authorKey: c?.user?.login ?? '',
          updatedAt: c?.updated_at ?? null, resolved: null, isOwnReply: false,
        });
      }
      for (const r of reviews) {
        // A review with no body is a vote, not feedback.
        if (!String(r?.body ?? '').trim()) continue;
        out.push({
          id: ghCommentId('review-summary', String(r?.id ?? '')), threadId: String(r?.id ?? ''), kind: 'review-summary',
          path: null, line: null, body: String(r?.body ?? ''),
          author: r?.user?.login ?? '', authorKey: r?.user?.login ?? '',
          // Review objects carry no updated_at. A submitted body is immutable,
          // so submitted_at is a stable idempotency key.
          updatedAt: r?.submitted_at ?? null, resolved: null, isOwnReply: false,
        });
      }
      await flagOwnReplies(out, identityOf, warnings);
      return withWarnings(out, warnings);
    },

    async replyToReviewComment(repo, prId, comment, body) {
      if (comment.kind === 'inline') {
        assertOneMarker(body, body, comment.id);
        // The PULL NUMBER is required in this path: /pulls/comments/{id} is a
        // different resource with no /replies sub-resource. And the HOST's own
        // comment number, back out of the composite: 'inline.42' is not a comment
        // this endpoint has.
        await transport(url(repo, `/pulls/${seg(prId)}/comments/${seg(hostCommentId(comment.id))}/replies`),
          { method: 'POST', headers, body: { body } });
        return { repo, prId: String(prId), commentId: String(comment.id), threaded: true };
      }
      // REST offers no threaded reply for an issue comment or a review body, so
      // these become new top-level comments that quote their source. Stated
      // rather than implied; idempotency rests on the marker, not on threading.
      //
      // THIS is the path the sink assertion exists for: untrusted host text joins
      // the outgoing body HERE, after the gate composed its fragment, so the
      // composed payload is what gets asserted.
      const composed = `${quoted(comment.body)}\n\n${body}`;
      assertOneMarker(composed, body, comment.id);
      await transport(url(repo, `/issues/${seg(prId)}/comments`),
        { method: 'POST', headers, body: { body: composed } });
      return { repo, prId: String(prId), commentId: String(comment.id), threaded: false };
    },
  };
}

// --- the governed path -------------------------------------------------------

/** Reads only. Frozen, so the write methods are absent and stay absent.
 *  `replyToReviewComment` is deliberately NOT here: /ml-specs:pr-address's `list`
 *  path takes this object, so that path physically cannot post. */
export const readOnlyScm = (scm) => Object.freeze({
  tool: scm.tool,
  // No whoAmI here. The identity is resolved by the ADAPTER's own memoized
  // identityOf() inside listReviewComments, so a facade method would be dead
  // weight that later reads as a supported capability.
  defaultBranchSha: (repo, branch) => scm.defaultBranchSha(repo, branch),
  findPullRequests: (repo, key) => scm.findPullRequests(repo, key),
  listReviewComments: (repo, prId) => scm.listReviewComments(repo, prId),
  getPullRequest: (repo, prId) => scm.getPullRequest(repo, prId),
});

/**
 * The only path that posts a reply to review feedback.
 *
 * Mirrors governedScm(), INCLUDING that it fetches its own evidence. It takes a
 * prId and a commentId rather than caller-supplied objects, and that is the whole
 * point: a caller passing `{ headSha: localHead }` would make the head check a
 * no-op, and a caller passing a comment with a stale `updatedAt` would either
 * double-post or write a marker that never matches again. Both sides of both
 * comparisons originate INSIDE the gate.
 *
 * Why the head check is the gate: a reply saying "addressed in <sha>" naming a
 * commit the reviewer cannot fetch is worse than no reply. Requiring the PR head
 * to equal local HEAD means the work is pushed BEFORE anything is claimed about
 * it — checked in code, not asked for in prose.
 *
 * What this gate is NOT: an anti-spoofing boundary. `localHead` arrives from the
 * caller, and any caller can read the PR head and echo it back. It is a
 * MISTAKE-PREVENTER — it stops the tool claiming "addressed in <sha>" for work
 * that was never pushed.
 *
 * THE EVIDENCE IS FETCHED ONCE PER RUN, not once per entry. It used to re-fetch
 * the pull request AND the fully paginated comment list on every replyFor — three
 * paginated endpoints per call on GitHub, so a twelve-entry batch cost 100+ round
 * trips and risked a secondary rate limit mid-batch. The "fetches its own
 * evidence" property is untouched: the evidence still originates inside the gate
 * and no caller can supply it. The one hazard caching opens — a second entry
 * naming the same comment cannot see the first reply land — is closed upstream by
 * planReplies, which refuses a repeated commentId (lib/pr-address.mjs, AC64).
 */
export function governedReply(scm, { localHead = null } = {}) {
  // The tool's own identity, resolved ONCE PER RUN and memoized. It is what makes
  // the idempotency marker trustworthy: both of the marker's inputs are publicly
  // readable, so a marker nobody's account can be matched to proves nothing.
  let identity = null;
  const selfAuthor = () => (identity ??= Promise.resolve(scm.whoAmI()).then((v) => v ?? ''));

  // The gate's own evidence, resolved at most once per (repo, pull request) and
  // memoized as a PROMISE — so N concurrent entries share one in-flight fetch
  // rather than racing N of them. Keyed rather than stored flat because one gate
  // is allowed to serve more than one pull request; caching across them would
  // answer entries about PR 8 with PR 7's head sha, which is the exact mistake
  // this gate exists to prevent.
  const evidence = new Map();
  const evidenceFor = (repo, prId) => {
    // JSON, not a delimiter character: a separator has to be one no repo name or
    // pull request id can contain, and the NUL that satisfied that made this file
    // BINARY TO GREP — `grep -c governedReply lib/scm.mjs` printed nothing at all,
    // which silently breaks the file:line citation this repo's knowledge layer and
    // house style rest on. JSON.stringify of the pair is unambiguous and stays
    // printable (AC70).
    const key = JSON.stringify([String(repo), String(prId)]);
    if (!evidence.has(key)) {
      evidence.set(key, (async () => ({
        pr: await scm.getPullRequest(repo, prId),
        comments: await scm.listReviewComments(repo, prId),
      }))());
    }
    return evidence.get(key);
  };

  return {
    tool: scm.tool,
    async replyFor(repo, prId, commentId, body, { deferred = false } = {}) {
      const { pr, comments } = await evidenceFor(repo, prId);
      const comment = comments.find((c) => c.id === String(commentId));

      if (comment == null) {
        throw new Error(`comment ${commentId} is not on ${repo} pull request ${prId}`);
      }
      // A comment REFUSED as contract-changing produces a reply on a run that may
      // have committed nothing, so the head check does not apply to it. Nothing
      // else is relaxed: the marker, the skip and the on-this-PR check all hold,
      // so a deferral cannot double-post either.
      if (!deferred && (pr.headSha == null || pr.headSha !== localHead)) {
        throw new Error(
          `refusing to reply about work that is not pushed: pull request ${prId} head is `
          + `${pr.headSha ?? 'unknown'}, local HEAD is ${localHead ?? 'unknown'}`);
      }
      if (alreadyAnswered(comments, comment.id, comment.updatedAt, await selfAuthor())) {
        return { skipped: `comment ${comment.id} already answered at ${comment.updatedAt}`,
                 comment: comment.id, posted: false };
      }

      const marker = replyMarker(comment.id, comment.updatedAt);
      const marked = `${body}\n\n${marker}`;

      // THE INVARIANT, half of it: the only WELL-FORMED marker in the fragment
      // this gate composed is the one it just appended. Both sources strip HTML
      // comments to a fixed point, but a stripper is a source-side control and
      // this is the single place every reply passes through. A laundered marker
      // naming someone else's comment would be posted by the tool's OWN account —
      // which is precisely the authorship the idempotency check trusts — and
      // would suppress that comment permanently.
      //
      // Counted as MARKERS, not as bare tags: a reviewer who writes "mention
      // ml-specs:pr-address in your reply" must not be able to make a legitimate
      // answer refuse. The other half of the invariant is at the transport
      // boundary (assertOneMarker in both adapters), because the quote-back path
      // composes its payload after this line.
      if (markerCount(marked) !== 1) {
        throw new Error(
          `refusing to post a reply that carries a foreign ${MARKER_TAG} marker `
          + `(comment ${comment.id}): a reply may carry only the marker this gate appends`);
      }
      const result = await scm.replyToReviewComment(repo, prId, comment, marked);
      return { skipped: null, comment: comment.id, posted: true, result };
    },
  };
}

/**
 * The only way a branch or pull request gets created. A pull request that cannot
 * be traced back to an approved contract is exactly what this exists to prevent,
 * so it is refused here rather than reported later.
 */
export function governedScm(scm, { target = 'main' } = {}) {
  return {
    tool: scm.tool,
    async openFor(spec, repo, body) {
      if (!spec.status || spec.status === 'Draft') {
        throw new Error(`spec ${spec.id} is ${spec.status ?? 'unknown'}; no branch is cut before the approval gate`);
      }
      const name = spec.branch ?? branchName(spec.id, spec.title);
      const title = prTitle(spec.id, spec.title);
      // Both are derived, so these can only fail if a derivation changed without
      // its parser changing with it.
      if (keyFrom('branch', name) !== spec.id) throw new Error(`branch "${name}" does not carry spec ${spec.id}`);
      if (keyFrom('prTitle', title) !== spec.id) throw new Error(`title "${title}" does not carry spec ${spec.id}`);

      const sha = await scm.defaultBranchSha(repo, target);
      const branch = await scm.createBranch(repo, name, sha);
      const pr = await scm.openPullRequest(repo, { source: name, target, title, body });
      return { branch, pr };
    },
  };
}

/**
 * The pull request body. It carries the whole chain so a reviewer never has to
 * hunt, and the criteria arrive as a checklist — their job is to confirm each
 * one, not to infer what the change was for.
 */
export function pullRequestBody(spec, reason, { constraints = [] } = {}) {
  const branch = spec.branch ?? branchName(spec.id, spec.title);
  const lines = [
    `## ${specId(spec.id)} — ${spec.title}`, '',
    `**Why this repo:** ${reason}`,
    `**Spec:** \`${spec.file}\` (status: ${spec.status})`,
  ];
  if (spec.ticket) lines.push(`**Ticket:** ${spec.ticket}`);
  if (spec.repos?.length) lines.push(`**Fan-out:** ${spec.repos.join(', ')}`);
  if (spec.nfrs?.length) lines.push(`**NFRs in force:** ${spec.nfrs.join(', ')}`);

  lines.push('', '## Acceptance criteria', '');
  lines.push(...((spec.criteria ?? []).length
    ? spec.criteria.map((ac) => `- [${ac.checked ? 'x' : ' '}] ${ac.id} (${testCaseId(spec.id, ac.ordinal)}) — ${ac.text}`)
    : ['_none — this spec should not have been approved._']));

  if (constraints.length) {
    lines.push('', '## Constraints in force', '', ...constraints.map((c) => `- **${c.id}** — ${c.text}`));
  }

  lines.push('', '---',
    `Every branch in this fan-out is \`${branch}\`. Same key, so these pull requests are one change.`);
  return lines.join('\n');
}

/** Which repos this change reaches: those named on the spec, plus those the
 *  estate index says consume what it touches. */
export function fanOutTargets(spec, impact = null) {
  const targets = new Map();
  for (const repo of spec.repos ?? []) targets.set(repo, 'named on the spec');
  for (const d of impact?.directlyAffected ?? []) {
    if (!targets.has(d.repo)) targets.set(d.repo, `consumes ${d.via.join(', ')}`);
  }
  for (const t of impact?.transitivelyAffected ?? []) {
    if (!targets.has(t.repo)) targets.set(t.repo, `one hop: consumes ${t.via.join(', ')}`);
  }
  return [...targets].map(([repo, reason]) => ({
    repo, reason,
    branch: spec.branch ?? branchName(spec.id, spec.title),
    title: prTitle(spec.id, spec.title),
  }));
}
