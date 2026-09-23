# ml-specs

<p>
  <a href="https://www.npmjs.com/package/@mlmcps/ml-specs"><img src="https://img.shields.io/npm/v/@mlmcps/ml-specs.svg?color=e6a54b" alt="npm version"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-5fb2cc" alt="node >= 22">
  <img src="https://img.shields.io/badge/dependencies-0-4caf72" alt="zero dependencies">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
</p>

A Claude Code plugin for spec-driven development in any stack — a stack-aware coding agent, an
evidence-gated spec lifecycle, and a knowledge layer that stays honest about drift. 29 commands,
10 agents, 1 skill, four hooks that are active on install, and a read-only MCP server.

Every lifecycle transition is decided by a script rather than a prompt, and leaves an **evidence
record** behind — so a `Verified` that has stopped being true can say so, instead of staying
`Verified` because nobody looked.

**This repository is generated.** It is a release mirror of a private development repo, carrying
the plugin and its marketplace manifest and nothing else. Issues and pull requests here will not be
seen — it is pushed to, never merged into.

## Install

```
/plugin marketplace add MLMCPS/ml-specs
/plugin install ml-specs@ml-tools
```

Restart Claude Code, then type `/ml-specs:spec` or `/ml-specs:repo-` to confirm the commands are there.

To enable it for everyone who clones a repo, commit this as `.claude/settings.json` in that repo:

```json
{
  "extraKnownMarketplaces": {
    "ml-tools": {
      "source": { "source": "github", "repo": "MLMCPS/ml-specs" },
      "autoUpdate": true
    }
  },
  "enabledPlugins": { "ml-specs@ml-tools": true }
}
```

## Start here

`/ml-specs:repo-init` in an existing repo. It reads the codebase and writes `CLAUDE.md`, `docs/PATTERNS.md`,
`docs/ARCHITECTURE.md`, and `specs/` from what is actually there. Everything else assumes those
exist. Then the loop:

```
/ml-specs:spec-explore (optional) → /ml-specs:spec <ticket> → /ml-specs:spec-review
                                  → /ml-specs:spec-advance … Approved → /ml-specs:spec-build
                                  → /ml-specs:spec-verify → /ml-specs:spec-advance … Verified
                                  → /ml-specs:pr → merge → /ml-specs:spec-advance … Archived
```

`/ml-specs:code` and `/ml-specs:fix` are the short paths for changes that don't warrant a spec.

Full documentation: [`ml-specs/README.md`](ml-specs/README.md) ·
changes: [`ml-specs/CHANGELOG.md`](ml-specs/CHANGELOG.md)

## Also on npm

| Package | For |
|---|---|
| [`@mlmcps/ml-specs-mcp`](https://www.npmjs.com/package/@mlmcps/ml-specs-mcp) | The read-only MCP server — Cursor, VS Code, CI, custom agents. Ten tools, zero dependencies. |
| [`@mlmcps/ml-specs`](https://www.npmjs.com/package/@mlmcps/ml-specs) | This plugin as an npm package, for vendored or air-gapped installs — **and the `bin` that installs the loop into 16 other agent hosts**: `npx @mlmcps/ml-specs hosts`, then `install --host <id\|all>`. |

Claude Code users need neither for the plugin itself — the MCP server is bundled inside it and
updates with it. The `bin` is for the hosts that are not Claude Code.

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

## License

MIT — see [LICENSE](LICENSE).
