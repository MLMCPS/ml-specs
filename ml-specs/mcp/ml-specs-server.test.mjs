// Tests for the MCP server's protocol surface, driven the way a client drives it: spawn the
// process, write newline-delimited JSON-RPC to stdin, read the replies. There is nothing to
// import — the server is a script that owns stdio the moment it loads — so a subprocess is the
// honest unit here, and it also catches the failure a unit test would miss: the server not
// starting at all.
//
// Run with: node --test ml-specs/mcp/
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, 'ml-specs-server.mjs');

const INIT = {
  jsonrpc: '2.0', id: 0, method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
};

// Every exchange re-initializes: the server holds no cross-request state worth preserving and a
// fresh process per case keeps one failure from cascading into the next.
function rpc(...requests) {
  const input = [INIT, ...requests].map((r) => JSON.stringify(r)).join('\n') + '\n';
  const out = execFileSync('node', [SERVER, '--root', HERE], { input, encoding: 'utf8' });
  const byId = new Map();
  for (const line of out.trim().split('\n')) {
    const msg = JSON.parse(line);
    byId.set(msg.id, msg);
  }
  return byId;
}

/** Same, against an arbitrary repo root — the script-backed tools answer about a repo, not about mcp/. */
function rpcAt(root, ...requests) {
  const input = [INIT, ...requests].map((r) => JSON.stringify(r)).join('\n') + '\n';
  const out = execFileSync('node', [SERVER, '--root', root], { input, encoding: 'utf8' });
  const byId = new Map();
  for (const line of out.trim().split('\n')) { const msg = JSON.parse(line); byId.set(msg.id, msg); }
  return byId;
}

const EXAMPLE_REPO = join(HERE, '..', '..', 'examples', 'promo-service');
const payload = (msg) => JSON.parse(msg.result.content[0].text);
const callAt = (root, name, args = {}) =>
  rpcAt(root, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).get(1);

describe('script-backed tools', () => {
  test('every deterministic script in scripts/ that ports is exposed', () => {
    const tools = rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }).get(1).result.tools.map((t) => t.name);
    for (const name of ['spec_gate', 'spec_trace', 'spec_brief', 'nfr_check', 'estate_survey']) {
      assert.ok(tools.includes(name), `${name} is not exposed`);
    }
  });

  test('spec_gate accepts a bare id, not only a path', () => {
    // spec-gate.mjs itself takes a path; spec-trace and spec-brief take either. A caller cannot
    // be expected to know which is which, so the server resolves it.
    const byPath = payload(callAt(EXAMPLE_REPO, 'spec_gate', { spec: 'specs/0001-add-coupon-expiry.md' }));
    const byId = payload(callAt(EXAMPLE_REPO, 'spec_gate', { spec: '0001' }));
    assert.equal(byId.spec, byPath.spec);
    assert.ok(Array.isArray(byId.gates) && byId.gates.length, 'no gates returned');
  });

  test('spec_gate reports a failed gate as a RESULT, not a tool error', () => {
    // The scripts exit 1 to mean "the gate failed". Treating that as a crash would turn a
    // legitimate FAIL into something the caller cannot read.
    const msg = callAt(EXAMPLE_REPO, 'spec_gate', { spec: '0001', to: 'Archived' });
    assert.notEqual(msg.result.isError, true, 'a failing gate must not be an error');
    const body = payload(msg);
    assert.ok('ok' in body && Array.isArray(body.gates));
    assert.ok(body.gates.some((g) => ['PASS', 'FAIL', 'MANUAL'].includes(g.verdict)));
  });

  test('spec_gate refuses an unknown id rather than guessing', () => {
    const msg = callAt(EXAMPLE_REPO, 'spec_gate', { spec: '9999' });
    assert.equal(msg.result.isError, true);
    assert.match(msg.result.content[0].text, /no spec with id 9999/);
  });

  test('spec_trace returns the chain for every spec', () => {
    const body = payload(callAt(EXAMPLE_REPO, 'spec_trace'));
    assert.ok(Array.isArray(body.specs) && body.specs.length > 0);
    assert.ok('ok' in body);
  });

  test('spec_brief returns markdown, deliberately not JSON', () => {
    const body = payload(callAt(EXAMPLE_REPO, 'spec_brief', { spec: '0001' }));
    assert.match(body.output, /^# SPEC-0001/m);
    assert.ok(!body.output.trimStart().startsWith('{'), 'a brief is a document, not a payload');
  });

  test('nfr_check distinguishes "no NFR file" from "no NFR problems"', () => {
    // Same rule as estate_lookup: absent means UNKNOWN, not zero. A false all-clear here is worse
    // than no answer, because it gets believed.
    const body = payload(callAt(EXAMPLE_REPO, 'nfr_check'));
    assert.equal(body.present, false);
    assert.match(body.note, /UNKNOWN, not absent/);
  });

  test('a relative --root is not applied twice', () => {
    // ROOT is both the spawn cwd and the --root handed to each script. When it was relative the
    // two composed and every script looked inside <root>/<root>, returning nothing.
    const rel = 'examples/promo-service';
    const repoRoot = join(HERE, '..', '..');
    const input = [INIT, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'spec_trace', arguments: {} } }]
      .map((r) => JSON.stringify(r)).join('\n') + '\n';
    const out = execFileSync('node', [SERVER, '--root', rel], { input, encoding: 'utf8', cwd: repoRoot });
    const msg = JSON.parse(out.trim().split('\n').find((l) => JSON.parse(l).id === 1));
    assert.notEqual(msg.result.isError, true, 'a relative root must work');
    assert.ok(JSON.parse(msg.result.content[0].text).specs.length > 0);
  });

  test('write-capable flags are never reachable through a tool', () => {
    // nfr-compile --apply and spec-brief --out both write. The server promises read-only, and
    // that promise has to hold by construction, not by convention.
    const src = readFileSync(SERVER, 'utf8');
    const dispatch = src.slice(src.indexOf('function callTool'));
    for (const flag of ["'--apply'", "'--out'", "'--gates'"]) {
      assert.ok(!dispatch.includes(flag), `${flag} is reachable from a tool`);
    }
  });
});

describe('prompts', () => {
  let list;
  before(() => {
    list = rpc({ jsonrpc: '2.0', id: 1, method: 'prompts/list' }).get(1).result.prompts;
  });

  test('the server advertises the prompts capability', () => {
    const caps = rpc().get(0).result.capabilities;
    assert.ok(caps.prompts, 'a client that sees no prompts capability never calls prompts/list');
  });

  test('every command file is exposed as a prompt', () => {
    assert.ok(list.length >= 18, `expected the whole commands/ dir, got ${list.length}`);
    for (const name of ['spec', 'spec-build', 'spec-verify', 'code', 'fix', 'repo-init']) {
      assert.ok(list.some((p) => p.name === name), `missing prompt: ${name}`);
    }
  });

  test('descriptions come from the command frontmatter', () => {
    const spec = list.find((p) => p.name === 'spec');
    assert.match(spec.description, /spec-driven-development spec/);
  });

  test('a command with no $ARGUMENTS declares no arguments', () => {
    // Otherwise a client renders a required-looking field for a command that ignores it.
    assert.deepEqual(list.find((p) => p.name === 'repo-init').arguments, []);
  });

  test('an argument is never required, so a client cannot block on it', () => {
    for (const p of list) {
      for (const a of p.arguments) assert.notEqual(a.required, true, `${p.name} would block`);
    }
  });

  test('prompts/get substitutes $ARGUMENTS', () => {
    const res = rpc({
      jsonrpc: '2.0', id: 1, method: 'prompts/get',
      params: { name: 'spec', arguments: { arguments: 'PAY-42 refunds' } },
    }).get(1).result;
    const text = res.messages[0].content.text;
    assert.match(text, /PAY-42 refunds/);
    assert.ok(!text.includes('$ARGUMENTS'), 'an unsubstituted placeholder reaches the model as literal text');
  });

  test('omitting arguments leaves no placeholder behind', () => {
    const text = rpc({
      jsonrpc: '2.0', id: 1, method: 'prompts/get', params: { name: 'spec' },
    }).get(1).result.messages[0].content.text;
    assert.ok(!text.includes('$ARGUMENTS'));
  });

  test('an agent a command names in bold is inlined', () => {
    // The client has no subagents; without this the delegation step silently does nothing.
    const text = rpc({
      jsonrpc: '2.0', id: 1, method: 'prompts/get', params: { name: 'spec' },
    }).get(1).result.messages[0].content.text;
    assert.match(text, /Inlined agent instructions/);
    assert.match(text, /### Agent: spec-reviewer/);
  });

  test('a command that delegates to nobody gets no appendix', () => {
    const text = rpc({
      jsonrpc: '2.0', id: 1, method: 'prompts/get', params: { name: 'repo-doctor' },
    }).get(1).result.messages[0].content.text;
    assert.ok(!text.includes('Inlined agent instructions'));
  });

  test('an unknown prompt is an error, not an empty prompt', () => {
    const msg = rpc({ jsonrpc: '2.0', id: 1, method: 'prompts/get', params: { name: 'nope' } }).get(1);
    assert.ok(msg.error);
    assert.match(msg.error.message, /no such prompt/);
  });
});

describe('the existing surface still works', () => {
  // Pinned deliberately: the tool list is a published contract, and a tool appearing or vanishing
  // by accident is exactly what this catches. Changing it is meant to be a decision someone makes
  // in a diff, which is why this assertion is exhaustive rather than a subset check.
  test('tools/list is exactly the published surface', () => {
    const names = rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }).get(1).result.tools.map((t) => t.name);
    assert.deepEqual(names.sort(), [
      // the original four — facts parsed out of the repo's own docs
      'estate_lookup', 'knowledge_check', 'spec_list', 'spec_next_number',
      // the deterministic scripts, which used to be reachable only from Claude Code
      'estate_survey', 'nfr_check', 'spec_brief', 'spec_gate', 'spec_trace',
    ].sort());
  });

  test('every tool declares a usable input schema', () => {
    const tools = rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }).get(1).result.tools;
    for (const t of tools) {
      assert.ok(t.description && t.description.length > 40, `${t.name} has no real description`);
      assert.equal(t.inputSchema.type, 'object', `${t.name} schema is not an object`);
      for (const req of t.inputSchema.required ?? []) {
        assert.ok(t.inputSchema.properties?.[req], `${t.name} requires undeclared property ${req}`);
      }
    }
  });
});
