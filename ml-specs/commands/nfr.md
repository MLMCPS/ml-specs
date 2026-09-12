---
description: Compile non-functional requirements into the two things that enforce them — standing constraints in the knowledge layer, and blocking pipeline gates
argument-hint: (no args) to check · `apply` to write docs/CONSTRAINTS.md · `gates <path>` to emit the pipeline block · `rules` to draft ml-skills custom rules
model: haiku
---

Route the project's NFRs: **$ARGUMENTS**

NFRs are the requirements most likely to be agreed and then lost. They do not
decompose into user stories — a story breakdown flattens them into prose that
nothing checks. They decompose into exactly two things: a **standing constraint**
the author reads while writing every spec, and a **blocking pipeline gate**.

## Run it

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/nfr-compile.mjs                       # check only
node ${CLAUDE_PLUGIN_ROOT}/scripts/nfr-compile.mjs --apply               # write docs/CONSTRAINTS.md
node ${CLAUDE_PLUGIN_ROOT}/scripts/nfr-compile.mjs --gates ci/nfr-gates.yml
```

Reads `docs/NFRS.md` — a markdown table, so a change to what is in force reviews
in a pull request like anything else — falling back to `nfrs.json`.

## The three things it refuses, and how to explain each

**No machine-checkable threshold.** "The API shall be performant" cannot become a
gate, so it cannot be enforced, so it will be lost. Do not soften this: ask the
user for the metric, operator and value. If they genuinely cannot name one, the
honest move is to delete the NFR rather than keep a requirement nothing can fail.

**Flattened into an acceptance criterion.** An NFR id appearing inside an AC is
the exact failure mode — at that point it has stopped being enforced and become a
sentence. Point at the spec and criterion, and move it back out.

**Named by a spec but defined nowhere.** Worse than unrouted: the spec claims a
constraint that does not exist. Either add it to `docs/NFRS.md` or remove the
reference.

## The third destination: a rule that actually fires

A constraint in `docs/CONSTRAINTS.md` is read by whoever writes the next spec. A pipeline gate runs
at the end. Between those two there is a gap: the code being written *right now*, by a person or an
agent who has not opened the constraints file. Some NFRs can close that gap, because they are
structural rather than measured — and those belong in the architecture standards as a rule.

The split is worth being precise about, because putting an NFR in the wrong place is how it stops
being enforced:

| NFR shape | Example | Where it goes |
|---|---|---|
| **Measured at runtime** | p95 latency < 200ms; 99.9% availability | Pipeline gate. Nothing static can see it. |
| **Structural, visible in source** | every outbound call sets a timeout; no PII in logs; images pinned | An `ml-skills` rule — it fires while the code is being written |
| **Both** | secrets never committed | A rule *and* a gate. Cheap; do both. |

Before drafting anything, ask whether the gate you already have is a gate at all. If the
`ml-skills` MCP server is available, call **`gate_manifest`**. It returns the complete set of rules
that can turn this pipeline red *today* — `blocking` — plus everything that only advises, and names
every standard still unratified and therefore toothless. A `blockingCount` of 0 is the answer to
"is this NFR enforced or merely written down?", and it is worth knowing before you add a rule to a
gate that cannot fail. Adding a rule under an unratified standard produces a warning nobody actions,
not a constraint — ratify it in the same change or the NFR is documentation wearing a rule's clothes.

For a structural NFR, draft the rule and put it to the user:

```jsonc
// .mlskills.json
{ "customRules": [{
    "id": "NFR001",                      // the NFR's own id, so the trace survives
    "skill": "resilience-patterns",      // which standard it belongs under
    "severity": "error",
    "files": ["**/*.ts", "**/*.java"],
    "forbid": "\\bfetch\\s*\\(",
    "near": { "pattern": "timeout|signal|AbortSignal", "lines": 6 },
    "title": "NFR001 — every outbound call sets a timeout",
    "why": "<the NFR's own rationale, verbatim from docs/NFRS.md>",
    "message": "outbound call with no timeout (NFR001)"
  }] }
```

Three things to hold to when you do this:

- **Keep the NFR's id as the rule id.** That is the whole trace: `docs/NFRS.md` → the rule → the
  finding a developer sees. Renaming it breaks the only link back to why the rule exists.
- **Draft it, then verify it actually fires.** Write the rule, then run
  `npx @mlmcps/ml-skills check .` against a file you know violates it. A rule that matches nothing
  reports a clean repo, which is worse than having no rule at all — it manufactures false
  confidence in exactly the requirement someone insisted on.
- **Do not ratify on the user's behalf.** A custom rule on an unratified standard can only warn.
  Say so, and let the human decide whether it is allowed to fail a build — that decision is theirs,
  and taking it for them is how a gate gets disabled the week after it lands.

If the standard the rule belongs under does not exist yet, say so rather than forcing it into the
nearest one — a mis-filed rule is a rule nobody looks for.

## After a successful `--apply`

Say which constraint ids changed — the script reports exactly that, and reports
nothing when the write was a no-op. Do not claim an update that did not happen.

Mention that the next `/ml-specs:spec` on an affected repo will carry these constraints
into the new spec automatically, so nobody has to remember they exist. If any of
them were also compiled into `ml-skills` rules, say which — those fire while the
code is being written, not just when it is reviewed.

## Close

If any NFR was refused, the project is not enforcing what it thinks it is. Lead
with that count, not with the ones that compiled.

Then report the routing honestly, per NFR: constraint only, constraint + gate, or
constraint + gate + rule. An NFR sitting in `docs/CONSTRAINTS.md` with no gate and
no rule is documented, not enforced, and the difference is the entire point of
this command.
