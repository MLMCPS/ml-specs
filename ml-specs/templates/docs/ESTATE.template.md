# <estate name> — service & contract index

> Estate-level retrieval index for the coding agent. When a change crosses a service boundary
> (an event, an HTTP/RPC call, a shared table), this is where the agent learns **the other side of
> the contract** without cloning and grepping every repo. Generated and refreshed by `/ml-specs:repo-estate`.
>
> Keep it under ~200 lines — it's an index, not documentation. One copy per service repo, kept in
> sync (or hosted centrally and symlinked). Mark anything not confirmed against real code
> `(inferred)` so the agent re-checks it instead of trusting it.

## Service registry

One row per service in the estate. `Summary doc` points at that repo's own `docs/ARCHITECTURE.md`
(the deep detail lives there, not here). Use `_TBD_` for peers not onboarded yet — an honest gap is
better than a guess.

| Service | Owns | Stack | Summary doc |
|---------|------|-------|-------------|
| <this-service> | <the domain nouns it is the source of truth for> | <language / framework / datastore> | `<this-service>/docs/ARCHITECTURE.md` |
| <peer-service> | <domain> | <stack, or `_TBD_`> | `_TBD_` |

## Cross-service contract index (who calls / publishes / consumes what)

The point of this file. Every row is an **edge** between two services — the agent reads it to find
the peer's side before designing a change.

### Synchronous (HTTP / RPC / gRPC / Feign)

| Caller | Callee | Via | What | Evidence |
|--------|--------|-----|------|----------|
| <service> | <peer> | <client class / module name> | <what it asks for> | `path/to/Client.ext:42` |

### Asynchronous (events / queues / topics)

| Event / queue / topic | Producer | Consumer | Notes | Evidence |
|-----------------------|----------|----------|-------|----------|
| `<event-name>` | <service> | <service> (`<listener class>`) | <payload gist, ordering/idempotency> | `path/to/Listener.ext:17` |

> Queue/topic names often resolve from config rather than literals — note where
> (`<config key or config server path>`). Update this table whenever a listener or a published
> topic is added.

### Shared data & packages (optional — delete if none)

| Shared thing | Owner | Used by | Notes |
|--------------|-------|---------|-------|
| <table / collection / shared library / published type> | <service> | <services> | <coupling risk, migration order> |

## How to use this for retrieval

1. Read this repo's own `docs/ARCHITECTURE.md` first (in-repo orientation).
2. Only if the task touches an event, a cross-service call, or shared data: find the edge in the
   contract index above, then open the peer's summary doc — design the change against **both**
   sides of the contract, and note the deploy order in the spec's §7 Rollout.
3. Only then do agentic search (`Explore` / grep) for the exact lines.
