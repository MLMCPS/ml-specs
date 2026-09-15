# ml-specs MCP server

The **deterministic** half of the toolkit, exposed over MCP so any client — Claude Code, Cursor, a
custom agent, a CI script — can use it without a model in the loop.

Everything here is **read-only**. No tool writes, moves, or deletes anything.

## What ports, and what doesn't

Skills and hooks have no MCP equivalent: MCP cannot register a `SessionStart` or `PreToolUse`
hook, and it cannot spawn a subagent with its own tool allowlist and model. Those stay in the
plugin, and so does the real subagent execution the commands rely on.

Two things do port. First, the computation — the parts that read files and return facts, where a
model adds nothing:

| Tool | Answers |
|------|---------|
| `estate_lookup` | Who produces/consumes this contract? (from `docs/ESTATE.md`) |
| `knowledge_check` | Do the docs still match the code — every `file:line`, link, and shard? |
| `spec_list` | What specs exist, at what status, with how many criteria met? |
| `spec_next_number` | What's the next free spec number **across all branches**? |
| `spec_gate` | Does this spec have the mechanical evidence for its next status? |
| `spec_trace` | Is the id chain from ticket to test case intact, for one spec or all? |
| `spec_brief` | The approved spec packaged for whoever implements it (markdown) |
| `nfr_check` | Which non-functional requirements do **not** route into something enforceable? |
| `estate_survey` | What state are the neighbouring repos in, before spending `/ml-specs:repo-init` on them? |

The last five are `scripts/` exposed. They were the half of the toolkit that most needed to be
reachable from outside Claude Code and least was: `spec_gate` is the lifecycle gate itself, so
until now a CI job could not ask the one question the whole loop turns on — *does this spec have
the evidence for `Verified`?*

They are **invoked as subprocesses, not imported**. The scripts parse their arguments at module top
level, so importing one would run its CLI — but invoking is also the stronger no-drift guarantee.
An imported function can diverge from the CLI in argument handling and defaults; a subprocess is
the same execution path a human gets. One process spawn per call is nothing for a read-only tool.

Read-only holds **by construction**: `--apply`, `--out` and `--gates` are never passed, there is no
parameter that could smuggle one in, and a test asserts those flags do not appear anywhere in the
dispatch. Writing stays in the plugin, where a human approves it.

Two behaviours worth knowing, because both are deliberate:

- **A failed gate is a result, not an error.** These scripts exit 1 to mean "the gate failed".
  The tool returns the verdict with `exitCode: 1` rather than raising, because a legitimate `FAIL`
  the caller cannot read is worse than no answer. Exit 2 — *could not run* — is still an error.
- **`nfr_check` returns `present: false` when the repo has no `docs/NFRS.md`**, for the same reason
  `estate_lookup` does: absent means the non-functional requirements are **unknown**, not that
  there are none. Reporting "nothing failed to compile" would be a false all-clear on exactly the
  requirements most likely to be agreed and then lost.

Templates are also served as resources under `mlspec://templates/…`.

Second, the **commands**, served as MCP prompts — all 22 of them, described from their own
frontmatter, with `$ARGUMENTS` filled in at `prompts/get`. Clients namespace these, so `spec`
arrives as `/mcp__ml-specs__spec` rather than `/ml-specs:spec`; that is the client's doing, not a choice
made here.

Where a command delegates to an agent, that agent's instructions are appended to the prompt as an
appendix, because a client with no subagent mechanism would otherwise skip the step silently — a
command that appears to run while quietly dropping its adversarial pass is worse than one that
fails. Inline execution loses the isolated context, tool restrictions and parallelism the plugin
gets. `/ml-specs:spec-fanout` degrades most, being parallel by design.

`estate_lookup` returns `present: false` with an explicit note when the repo has no estate index.
That distinction is the whole point: "no index" is not "no consumers", and a false all-clear on a
cross-service change is worse than no answer, because it gets believed.

## Run it

```bash
node ml-specs-server.mjs --root /path/to/the/repo     # stdio transport; --root defaults to cwd
```

No dependencies and no install step — stdio MCP is newline-delimited JSON-RPC 2.0, implemented
directly here for the same reason `scripts/validate-plugin.mjs` has no dependencies: nothing in this
repo is ever installed before it runs. The two `package.json` files exist only to *publish* — they
declare no dependencies and there is no `node_modules`.

## Sharing it with a team

**First, the honest bit:** you cannot ship JavaScript to someone's machine and prevent them
reading it. `node_modules` is source, and even a compiled single-executable can be unpacked. So
pick based on what you're actually solving:

| Goal | Do this | Cost |
|---|---|---|
| Teammates get **only these nine tools** | `@mlmcps/ml-specs-mcp` npm package (below) | Public on npmjs — anyone can read the package source |
| Teammates get the **whole toolkit**, without repo access | `@mlmcps/ml-specs` npm package as the marketplace source | Public on npmjs; updates arrive on tag, not on merge |
| Teammates get the whole toolkit **and** the repo | Private repo + `/plugin marketplace add` | They can clone everything, history included |
| Genuinely no readable source | Single executable (`node --experimental-sea-config`, `bun build --compile`) | Per-platform builds; unpackable anyway |

**Hosting it remotely does not work for this server** — and the reason is worth knowing. Every tool
here answers questions about *the repo the caller is sitting in*. A remotely hosted server would
inspect files on the server, not on the teammate's laptop, so it would return answers about the
wrong repo. This server is local by design, not by omission.

### Public npm package (recommended)

The package ships `mcp/`, `scripts/` (the tools invoke them) and the one CI module it imports —
zero dependencies, no agents, no templates. Since 0.19.0 it is **public on npmjs.org under
MIT**, so a teammate needs no token, no registry config, and no access to this repo. The repo itself
stays private; `files[]` is what keeps the rest of it out of the tarball.

```bash
# you, once per release — normally CI does this on a tag
npm publish                       # publishConfig points at registry.npmjs.org, access public
```

Teammates configure nothing. In any repo they work in, `.mcp.json`:

```json
{
  "mcpServers": {
    "ml-specs": {
      "command": "npx",
      "args": ["-y", "@mlmcps/ml-specs-mcp", "--root", "."]
    }
  }
}
```

That file is safe to commit — it names a package, not a path on anyone's laptop.

## Wire it into a repo

Copy `../templates/mcp/.mcp.json` to that repo's root as `.mcp.json`, set the absolute path, and
commit it — project-scoped config, so the whole team gets it. Or register it per-user:

```bash
claude mcp add ml-specs -- node /abs/path/to/ml-specs/mcp/ml-specs-server.mjs --root .
```

Verify with `/mcp` in Claude Code; the nine tools should be listed.

## How updates reach people

Which mechanism applies depends on how they got it — and the first case is the one most teams
should be in, because it has no separate update step at all.

**Installed as part of the plugin** (Claude Code users). The bundled `.mcp.json` resolves through
`${CLAUDE_PLUGIN_ROOT}`, so the server is *inside* the plugin: when the marketplace updates the
plugin, the server comes with it. With `autoUpdate: true` that's automatic on the next launch —
restart Claude to pick it up. **There is nothing extra to publish or install.** If your whole team
uses Claude Code, you do not need the npm package.

**Installed from npm** (Cursor, custom agents, CI, or people who shouldn't get the whole plugin):

| `.mcp.json` args | Update behaviour | Use when |
|---|---|---|
| `["-y", "@mlmcps/ml-specs-mcp@0.19.0", …]` | **Pinned.** Everyone runs exactly what you tested; bumping is a commit teammates can review. | A team — recommended |
| `["-y", "@mlmcps/ml-specs-mcp", …]` | Resolves the latest at launch, so a new session can silently change versions. | Solo, or you want the newest always |

Servers start per session, so either way a **restart** is what applies an update — nothing hot-reloads.

**Which version is actually running?** Version skew across a team is the predictable failure here
(one stale npx cache, one freshly-updated plugin, two different answers). Ask it directly:

```bash
npx @mlmcps/ml-specs-mcp --version     # or: node .../mcp/ml-specs-server.mjs --version
```

It prints the version *and the resolved file path*, so "which copy is this" is answerable in one
line. The same version is reported in the MCP handshake, and the repo's validator keeps all five
places it's written from drifting.

## Relationship to the plugin

They compose — install both. The plugin gives you the loop (`/ml-specs:spec-explore` (optional) → `/ml-specs:spec` → … →
`/ml-specs:pr`), the agents, and
the hooks; this gives every tool the same facts underneath. `knowledge_check` shares one
implementation with the CI gate in `../templates/ci/knowledge-check.mjs`, imported rather than
copied, so the two can't drift apart.
