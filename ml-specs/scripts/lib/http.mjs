// The seam between an adapter and the network.
//
// `request` is the real transport. Injecting `recorder()` instead is what makes
// the tracker and SCM clients testable without credentials — the documents they
// build are the part most likely to be wrong (a JSON-patch path, a field written
// directly that Jira only moves through a transition), and all of that is
// assertable offline.
//
// It also backs --dry-run, so an operator can read the exact request that would
// hit their organisation before anyone grants an access token.
//
// Pure Node, no dependencies. Node 18+ for global fetch.

export const basicAuth = (user, password) =>
  'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');

/** The real transport. Throws with the response body, which is where the useful
 *  part of an ADO or Jira error lives. */
export async function request(url, { method = 'GET', headers = {}, body, contentType = 'application/json', timeout = 30000 } = {}) {
  const init = { method, headers: { Accept: 'application/json', ...headers } };
  if (body !== undefined) {
    init.headers['Content-Type'] = contentType;
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) {
    throw new Error(`${method} ${new URL(url).pathname} -> ${res.status} ${(await res.text()).slice(0, 500)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/**
 * A transport that records instead of sending. Returns canned responses in
 * order, then a default shaped so every adapter's response parser completes —
 * which is what lets --dry-run walk a whole flow rather than stopping at the
 * first read.
 */
export function recorder(responses = []) {
  let cursor = 0;
  const calls = [];

  const fn = async (url, { method = 'GET', body, contentType = 'application/json' } = {}) => {
    calls.push({ method, url, body, contentType });
    return cursor < responses.length ? responses[cursor++] : DEFAULT_RESPONSE;
  };

  fn.calls = calls;
  fn.last = () => calls[calls.length - 1];
  fn.transcript = () => calls.map(render).join('\n\n');
  return fn;
}

const render = (c) => {
  const head = `${c.method} ${c.url}`;
  if (c.body === undefined) return head;
  return `${head}\n  content-type: ${c.contentType}\n` +
    JSON.stringify(c.body, null, 2).split('\n').map((l) => '  ' + l).join('\n');
};

// Keys are namespaced by their API so they do not collide.
const SHA = '0f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6';
const DEFAULT_RESPONSE = {
  // trackers
  id: 1847, key: 'PAY-1847',
  fields: { 'System.Title': '[SPEC-0031] placeholder', 'System.State': 'New',
            summary: '[SPEC-0031] placeholder', status: { name: 'To Do' } },
  workItems: [], issues: [], transitions: [],
  // source control — ADO returns refs under `value`, GitHub a single `object`
  value: [{ objectId: SHA, name: 'refs/heads/main' }],
  object: { sha: SHA },
  pullRequestId: 4321, number: 4321, html_url: 'https://example.invalid/pull/4321',
};
