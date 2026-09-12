---
description: Generate or refresh docs/ESTATE.md — the cross-service contract index (who calls, publishes, and consumes what) for a multi-service estate
argument-hint: (no args) to scan sibling repos, or paths/globs to the peer repos — e.g. ../user-service ../payments-service
model: sonnet
---

You are building this repo's **estate index**: the map of the services around it and the contracts
between them. It is what lets a change that crosses a service boundary be designed against both
sides without cloning and grepping the whole estate.

Peer repos to scan: **$ARGUMENTS**

The template lives at `${CLAUDE_PLUGIN_ROOT}/templates/docs/ESTATE.template.md`.

## Phase 1 — scope it

1. **Does this repo need an estate index at all?** If it's a standalone app with no outbound
   service calls and no event producers/consumers, say so and **stop** — do not create the file. A
   monorepo's internal modules are `docs/ARCHITECTURE.md` shards, not estate peers.

2. **Locate the peers.** In order: the paths given in `$ARGUMENTS`; else sibling directories of this
   repo's parent that are git repos; else the other working directories available in this session.
   List what you found and how many you'll scan. If the set is ambiguous or large (>~12 repos), put
   it to the user with AskUserQuestion — scan the ones they name rather than guessing.

3. **Read-only outside this repo.** You may read peer repos; you may not write to them.

## Phase 2 — learn the edges (not the peers)

You are indexing contracts, not learning each service — that's `/ml-specs:repo-init` inside that repo. Stay
shallow and cheap: for each peer, the manifest for its stack, its README/`docs/ARCHITECTURE.md` for
what it owns, and then only the files that carry an edge.

**Delegate the peer reading, one agent per repo.** Spawn **scanner** once per peer repo with
the `edges` brief, all **in a single message** so they run concurrently — N peers cost about one
peer's wall-clock instead of N, and their file reads never enter this context. Give each the peer's
path and the specific contracts you're trying to resolve (step 5), so it looks for counterparts
rather than surveying the service. Scan this repo's own edges (step 4) inline — you need that
detail first-hand to brief the peer scanners.

4. **This repo's outbound edges** (highest confidence — you can read the real code):
   - Synchronous: HTTP/RPC/gRPC clients, `@FeignClient`, generated SDK clients, base URLs from config.
   - Asynchronous: published events/topics, and the listeners/consumers it subscribes to.
   - Shared data: tables/collections/schemas or published packages/types shared with a peer.
   Cite `file:line` for each.

5. **The other side of each edge.** In the peer repo, find the counterpart — the controller/route
   that serves the call, the producer of the event this repo consumes, the consumer of the event it
   publishes. Confirmed from real code → cite `file:line`. Not confirmed → write the row anyway and
   mark it **`(inferred)`** or `_TBD_`. Never invent a peer-side handler to make a table look complete.

6. **Note what the names resolve from.** Queue/topic names and service URLs usually come from config
   (env, a config server, service discovery), not literals — record where, so the next reader can
   resolve them.

## Phase 3 — write it

7. Fill the template into `docs/ESTATE.md`. If the file already exists, **merge**: keep human-edited
   rows and notes, correct what's now wrong, add new edges, and delete edges whose code is gone.
   Refreshing is also pruning — keep it under ~200 lines. It is an index that links out, not
   documentation that inlines.

8. Make sure `CLAUDE.md`'s knowledge-layer section points at `docs/ESTATE.md` for cross-service work
   (add the line if missing). Don't inline any of it into `CLAUDE.md`.

9. **Other repos:** if the user wants the same index in the peer repos, offer it as an explicit
   follow-up and write it only on their say-so. Never write into another repo unasked.

## Phase 4 — report

10. Report: peers scanned, edges found (sync / async / shared data), how many are confirmed vs
    `(inferred)`, and the edges you could **not** resolve — those are the real output, because an
    unresolved edge is where a cross-service change will break. Do NOT commit.

Re-run this after adding a listener, a published topic, or a new cross-service client. Related:
`/ml-specs:repo-refresh` (this repo's own docs) and `/ml-specs:repo-doctor` (drift check).

The index exists to be *used*: `/ml-specs:repo-impact` reads it to answer "who breaks if this ships?" — which
is why an unresolved edge here becomes a blind spot there, and why `_TBD_` is better than a guess.
