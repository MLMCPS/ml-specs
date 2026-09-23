# ml-specs

Spec-driven development toolkit packaged as a Claude Code plugin, so every repo and every
developer gets the same agents and commands. The agents are **stack-aware**: they detect the
project before editing and follow its conventions — Java/Spring (Maven/Gradle), React, and
Node backends (Express, NestJS), across MySQL, PostgreSQL, and MongoDB. (Originally built for
a large microservice estate; works in standalone apps too.)

**Zero dependencies. Node 22+ stdlib only. 29 commands, 10 agents, 1 skill, four hooks, ten MCP tools.**

## Quick start

```
/plugin marketplace add MLMCPS/ml-specs
/plugin install ml-specs@ml-tools
```

Restart Claude Code, then:

```
/ml-specs:repo-init      # learn this repo, scaffold specs/ + docs/ + the CI gate
/ml-specs:next           # from here on: the one thing to do next, whenever you lose the thread
```

Not on Claude Code? `npx @mlmcps/ml-specs hosts`, then `install --host <id|all>` — see
[Every other host](#every-other-host).

## Why use this (vs. just asking Claude)

Same model — the difference is what's wrapped around it. Default Claude Code re-learns your repo
every session, infers conventions on the fly, jumps straight to code, and reports "done" with the
human as the only check. This toolkit adds three things that change the outcome:

1. **Durable, learned memory** — `/ml-specs:repo-init` studies the repo once and writes `CLAUDE.md` +
   `docs/PATTERNS.md` + `docs/ARCHITECTURE.md` with real `file:line` evidence. Every later task
   reads *your* conventions instead of re-guessing them, so output matches your codebase
   consistently across sessions and developers.
2. **Spec-before-code for non-trivial changes** — `/ml-specs:spec → review → /ml-specs:spec-build` puts the contract
   (API, data model, cross-module ripple) on paper for human approval **before** code exists, so
   the costly design errors get caught when they're a sentence to fix, not a rollback.
3. **Discipline baked in** — a test per acceptance criterion, adversarial review against the spec,
   "report real test results — never claim green," and tiered/sharded context so it stays cheap and
   usable on large, interlinked codebases.

| | Normal Claude Code | ml-specs |
|---|---|---|
| Knows your conventions | Re-guesses each session | Learned once, remembered |
| Consistency across devs/repos | Varies per prompt | Same agents, format, specs |
| Non-trivial change | Code first, find issues in the diff | Contract approved on paper first |
| Verification | "Looks done" | Test per criterion + adversarial review |
| Large / coupled codebase | Context bloat | Lazy-loaded, sharded, bounded |
| Cost per task | Re-reads a lot | Thin index → only what's needed |

**The trade-off:** more upfront ceremony (write/approve a spec, run `/ml-specs:repo-init` once, keep the docs
fresh) in exchange for consistency, fewer wrong-contract surprises, and an agent that knows your
code. Worth it for teams, multi-service estates, and long-lived codebases; **skip it** for one-line
fixes and throwaway scripts — use `/ml-specs:code` (or plain Claude) there. The payoff is real only if the
learned docs are accurate, which is why patterns carry `(inferred)` confidence markers and
`/ml-specs:repo-init` flags them for a quick human review.

## Token cost (set expectations before running on a big repo)

The toolkit **front-loads** tokens to **cut** the per-task and rework tokens — so it pays off on
repeated work and costs more on one-offs.

**Spends more on:** `/ml-specs:repo-init` (a one-time codebase scan — the most expensive single op, biggest on
large repos), the `/ml-specs:spec` phase (a doc before code), the per-task memory tax (`CLAUDE.md` + relevant
`docs/` loaded each coding task), and the multi-agent loop (author → developer → reviewer are
separate contexts — you're buying verification).

**Saves on:** re-exploration (reads a small index instead of grepping the repo every session — the
biggest recurring win on large repos), lazy/sharded loading (only the module a task touches, +1-hop
contracts; `file:line` refs not pasted code), and **rework** (knowing conventions + approving the
contract on paper means fewer thrown-away wrong implementations — pure wasted tokens otherwise).

| Scenario | Net vs. plain Claude |
|---|---|
| One-line fix via `/ml-specs:code` | ~Same (no spec; just the thin index) |
| Non-trivial change, repo already `init`-ed | **Lower** — saved exploration + rework beats the spec overhead |
| First change in a fresh repo (pay `/ml-specs:repo-init`) | **Higher** that session; pays back over the next few |
| Large / interlinked codebase, ongoing | **Much lower per task** — sharding avoids context blowups |
| Throwaway script, one session | **Higher** — don't use the full loop |

**Keep it cheap:** use `/ml-specs:code` for small changes (don't spec a typo); run `/ml-specs:repo-init` once per repo
and review, not casually; keep `docs/` within the ~200-line budgets (a bloated `PATTERNS.md` taxes
every task — `/ml-specs:repo-refresh` prunes); shard large apps; skip the reviewer agent for low-risk changes.
Honest caveat: `/ml-specs:repo-init` on a big repo is genuinely expensive — if you'll only ever make one change
there, you won't recoup it. The design assumes repeated work against the same codebase.

## What's inside

**Agents** (`agents/`)
- `analyst` — the ANALYZE phase: turns a ticket or half-formed idea into a comparison of viable
  approaches with their trade-offs, the cross-module ripple and the blocking contract questions a
  spec must answer (read-only; it reports those questions, it does not ask them, and it does not
  write the note). Run it with `/ml-specs:spec-explore`.
- `coder` — senior-engineer coding agent; detects the stack, inspects before editing, smallest
  correct change, fixed `PLAN / FILES / IMPLEMENTATION / REVIEW / TESTS` output, asks instead of guessing.
- `explainer` — explains what existing code **does today**: a cited account of its behaviour,
  entry points, flow, contracts and callers, gotchas, and what it could not determine (read-only;
  it does not modify code, does not propose changes, and does not write the note). Run it with
  `/ml-specs:explain`.
- `spec-author` — turns a ticket into a reviewable spec under `specs/` (no code). Stops and
  returns blocking contract questions rather than guessing them or parking them in the document.
- `spec-reviewer` — adversarially reviews a **draft spec** before a human reads it (read-only,
  fresh context): contracts complete, criteria testable, ripple named.
- `developer` — implements ONE approved spec, test-first, strictly to its acceptance criteria.
  `/ml-specs:spec-build` spawns one per spec; several specs at once means one agent each in its own git
  worktree.
- `reviewer` — adversarially verifies an implementation against its spec (read-only). Run it
  with `/ml-specs:spec-verify`.
- `security-reviewer` — reviews the same diff for security regressions an acceptance-criteria
  review cannot see: authorization, tenant isolation, data reaching a new sink, injection, secrets
  (read-only; reports, does not fix). Returns `clear` / `inconclusive` / `blocked`, and anything
  but `clear` stops `Verified`. `/ml-specs:spec-verify` runs it alongside `reviewer`, on every change.
- `pr-author` — turns a completed spec + its diff into a PR title/body with the acceptance criteria
  as a checklist (read-only; doesn't open the PR). Run it with `/ml-specs:pr`.
- `scanner` — reads a codebase and returns a **capped findings block of `file:line` citations,
  never file contents**. `/ml-specs:repo-init`, `/ml-specs:repo-refresh` and `/ml-specs:repo-estate` spawn several at once instead
  of reading source themselves, so the learn phase runs concurrently and the files it opens never
  land in the calling session's context.

**Commands** (`commands/`)
The loop: `/ml-specs:spec-explore` (optional) → `/ml-specs:spec` → `/ml-specs:spec-review` →
`/ml-specs:spec-advance Approved` → `/ml-specs:spec-build` → `/ml-specs:spec-verify` →
`/ml-specs:spec-advance Verified` → `/ml-specs:pr` → `/ml-specs:spec-advance Archived`.

- `/ml-specs:next [spec | --route "<what you want to do>"]` — the way **in**. With no argument it
  reads the board and names the one thing to do next; with a sentence it names the command that
  fits. Every answer carries the artifact it came from — a Status cell, or an evidence record — so
  a wrong suggestion is arguable rather than mysterious, and a failing record outranks the
  lifecycle: a `Verified` spec over a stale record is told to re-earn the claim, not to open a PR.
  **Read-only and advisory.** It prints a command and never runs one; routing is navigation, never
  consent.
- `/ml-specs:code <task>` — make a one-shot change with the `coder` agent (any language; detects the stack).
- `/ml-specs:fix <bug>` — the bug-shaped flow. A defect already has a contract; the code is just violating
  it, so a feature-shaped spec is wasted ceremony — but `/ml-specs:code` gives it no discipline at all. This
  is the middle path, and the discipline is one rule: **reproduce it with a failing test first.**
  Then root cause (stated, with evidence), smallest change, real verification, and a search for the
  same defect in sibling code paths. Escalates to `/ml-specs:spec` if the fix would change a contract.
- `/ml-specs:handoff [label]` — write a session handoff note to
  `.claude/handoff/<YYYY-MM-DD-HHMMSS>-<slug>.md`: what got done, what is in flight (from
  `git status`, not memory), what was decided *and rejected*, the next concrete step, and the
  landmines. Runs inline — a subagent cannot see the session it would be summarising. Outside the
  loop: it changes no code, commits nothing, and carries no `Status`. A `SessionStart` hook surfaces
  a recent note in one line so the next session actually reads it.
- `/ml-specs:explain <target>` — answer *what does this code actually do?* The `explainer` agent
  reads a module, file, function or flow read-only and returns a cited account — what it does,
  entry points, flow, contracts and callers, gotchas, and what it could not determine — and the
  command writes it to `specs/explain-<slug>.md`. Outside the loop: it changes no code and the note
  carries no `Status`.
- `/ml-specs:spec-explore <ticket>` — the **optional** ANALYZE phase before the spec exists: the
  `analyst` agent compares two or three approaches with their trade-offs and surfaces the blocking
  contract questions, and the command writes them to `specs/explore-<slug>.md`. `/ml-specs:spec`
  then consumes that note instead of re-deriving it — so the approaches you rejected are on the
  record rather than re-litigated in review. Skip it and the loop is unchanged.
- `/ml-specs:spec-new [title]` — scaffold the next spec and stop. Takes the next free number
  **across every branch** (not just this one, which is how two specs end up both called `0031`),
  fills the header table, and leaves the body for you to write. It is not `/ml-specs:spec`: nothing
  is drafted, nothing is asked, no agent runs. For when you already know what the spec says and
  only want the file in the right place with the right number.
- `/ml-specs:spec <ticket>` — draft a spec. Asks the blocking contract questions up front (batched, with
  recommendations), then self-reviews via `spec-reviewer` before handing you the draft — so your
  review is an approval, not a hole-hunt.
- `/ml-specs:spec-review <spec-file>` — run that adversarial pass on demand (for hand-written or heavily
  edited specs; `/ml-specs:spec` already does it).
- `/ml-specs:spec-build <spec-file>` — implement an approved spec.
- `/ml-specs:spec-verify <spec-file>` — the VERIFY gate: `reviewer` judges the implementation against the
  spec's acceptance criteria (fresh context, read-only) and runs the final-acceptance suite. This is
  what earns `Verified`. Complements `/code-review`, which checks the diff for bugs — run both.
- `/ml-specs:spec-advance <spec-file> [status]` — the **only** writer of a spec's Status, and every
  transition has to show its evidence: `Approved` needs the human's OK and no blocking question left
  in §8; `Implemented` needs every named test to exist on disk; `Verified` needs a clean
  `/ml-specs:spec-verify` plus a green full suite; `Archived` needs the branch merged, then `git mv`s the
  spec to `specs/archive/` (number kept). If the evidence isn't there it refuses — that's the point.
  Also records the spec's branch so `/ml-specs:repo-status` stops guessing.
- `/ml-specs:pr <spec-file>` — spec + diff → PR title and body with the acceptance criteria as a review
  checklist (produces text; doesn't push or open the PR unless you ask).
- `/ml-specs:pr-address [pr]` — the step between "PR opened" and "PR merged": read an open PR's
  review feedback, triage each comment, make the change with `coder`, then reply on each thread.
  The **only** command that commits and pushes, and the gate is in the library rather than the
  prose — it fetches the PR itself and refuses to claim anything about work that is not pushed.
  A comment that would change a contract is **refused** and routed to `/ml-specs:spec`, so a
  reviewer comment cannot bypass the loop. Replies are keyed on `(comment, updatedAt)`, so a
  re-run answers nothing twice.
- `/ml-specs:repo-estate` — build/refresh `docs/ESTATE.md`: scans the peer repos and indexes the real
  cross-service edges (HTTP/RPC clients, event producers/consumers, shared data), citing `file:line`
  on both sides and marking anything unconfirmed `(inferred)`. Read-only outside this repo.
- `/ml-specs:repo-impact [spec-file]` — **who breaks if this ships?** Detects changes to published contracts
  (event payloads, API shapes, shared tables, exported types), looks up the consumers in
  `docs/ESTATE.md`, classifies each as additive / sequenced / breaking, and gives the safe deploy
  order. If the estate index is empty it says so rather than reporting "nothing affected" — a false
  all-clear here is worse than no answer. Nothing else in the loop looks outside this repo.
- `/ml-specs:nfr` — non-functional requirements are the ones most likely to be agreed and then lost, because
  they do not decompose into user stories: a story breakdown flattens them into prose nothing checks.
  This compiles each into the two things that *do* enforce it — a standing constraint in
  `docs/CONSTRAINTS.md` that the next `/ml-specs:spec` carries into the document automatically, and a blocking
  pipeline gate. An NFR with no machine-checkable threshold is **refused**, because one nothing can
  fail is not a requirement.
- `/ml-specs:spec-fanout <spec-id> <contract...>` — one spec, N repos, N pull requests, all on the same derived
  branch name, so a change spanning four services is provably one change rather than four a reviewer
  correlates by hand. Uses `docs/ESTATE.md` to find the consumers, including the service one hop out
  that nobody remembered. Plans first, then `--dry-run` prints the exact requests, then opens them.
  Partial failure is reported, not thrown — a permissions error on the fourth repo must not hide that
  three succeeded.
- `/ml-specs:repo-rollout <parent-dir>` — onboard a whole estate without spraying the expensive part. Surveys
  every repo mechanically first (free — no model), classifies each as init / adopt / refresh /
  review, orders them by cross-service surface so the repos that unlock `/ml-specs:repo-impact` for their
  peers go first, then onboards **one at a time**. The first repo is an explicit calibration run:
  you review its output before repo two, so a systematic mistake gets fixed once instead of 17
  times. Ends by running `/ml-specs:repo-estate`, which is the point of the whole exercise. Resumable — state
  is re-derived from disk each run, so there's no ledger to go stale.
- `/ml-specs:repo-adopt` — for a repo that **already has** a hand-written `CLAUDE.md`, `docs/`, or its own
  RFC/ADR practice. Merges rather than overwrites: classifies every existing section into keep /
  merge / missing, never deletes human prose, maps the spec loop onto their existing process, and
  reports conflicts between their docs and the code without silently "fixing" them.
- `/ml-specs:repo-init` — **learn the existing project, then scaffold it.** Studies the real codebase,
  extracts its code patterns, and auto-generates the Claude memory files (`CLAUDE.md` with a
  "Code patterns" section, `docs/PATTERNS.md`, `docs/ARCHITECTURE.md`), plus `specs/`,
  `docs/`, `.gitattributes`, and a committed `.claude/settings.json` that keeps AI attribution
  off the repo's commits and PRs for everyone who clones it.
- `/ml-specs:repo-skills` — map the repo's stack onto the ml-skills catalog and record the matches in
  `docs/SKILLS.md`, so later sessions know which third-party skills are worth `skill_fetch`ing.
  Re-runnable; records pointers, never installs. Skipped entirely when ml-skills is absent.
- `/ml-specs:repo-refresh` — re-learn the project and update those memory files after the code has drifted.
- `/ml-specs:repo-doctor` — read-only health check of the knowledge layer (drift, broken refs, stale
  commands); recommends `/ml-specs:repo-refresh` when needed.
- `/ml-specs:repo-status` — dashboard of every spec: lifecycle status, acceptance-criteria progress, branch.
- `/ml-specs:repo-wiring` — **what this repo is actually wired for, and what is missing.** The CI
  gate, the doc gate, the hooks, MCP, the knowledge layer — each row either present or absent, and
  every absent row carries the one command that fixes it. A toolkit with sixteen moving parts has a
  failure mode where half of them were never switched on and nothing ever said so.
- `/ml-specs:repo-cycle` — **how long specs actually take**, computed from the timestamps the
  evidence records already carry: Draft → Approved → Implemented → Verified, per spec and in
  aggregate. Read-only, and deliberately **never keyed to a person** — a cycle-time report that
  names who is slow stops being a measurement and becomes a performance review, and then the
  records stop being trustworthy. Specs written before evidence records existed are reported as
  unmeasurable rather than counted as instant.
- `/ml-specs:repo-skill` — the **skill catalogue**: what procedures exist, what each takes and
  produces, and which declared capabilities nothing implements yet. The last part is the point — an
  unimplemented capability is invisible until something needs it.
- `/ml-specs:repo-hosts` — which agent hosts this repo is wired for, where an install would land, and which rows are unverified. Read-only; installing is `npx @mlmcps/ml-specs install --host <id>`, which you run yourself.

**Skills** (`skills/`) — procedures that load only when they apply, so they cost nothing when they
don't.
- `knowledge-retrieval` — navigating a sharded knowledge layer, the 1-hop dependency closure for
  interlinked modules, and designing a change that crosses a module or service boundary (both sides
  of the contract, deploy order, compatibility). Loads on demand; the always-needed retrieval ladder
  stays in the repo's `CLAUDE.md`, because it has to be known before you know you need it.

**Architecture standards** (optional, via [`ml-skills`](https://github.com/MLMCPS/ml-skills)) — the
toolkit governs *process*: a contract on paper, approved before code, verified against its own
criteria. It has never had an opinion about whether that contract is any good. `ml-skills` is the
other half — eleven standards and ~176 rules over API shape, data model, backend layering, infra,
UI, security, testing, events, observability, resilience and config — and the two wire together at
four points in the loop:

| Phase | What changes |
|---|---|
| `/ml-specs:spec` | The spec author reads the standards that govern the contract **before writing it**. A decision the organisation has already ratified is not a blocking question, so it stops being asked; a ticket that genuinely conflicts with a standard becomes one. |
| `/ml-specs:spec-build` | The developer agent reads the applicable standard before coding, and checks its own output before claiming done. Where local code contradicts a standard it flags the divergence instead of copying it — the one case that overrides "match the surrounding code". |
| `/ml-specs:spec-verify` | The standards check is mechanical evidence in the reviewer's verdict, separated into new violations (must-fix) and pre-existing ones (not this change's problem). |
| `/ml-specs:spec-advance Verified` | A clean standards run joins the green suite as required evidence — and the transition records which standards were **unratified**, because `Verified` against a gate nothing could fail is a weaker claim than it looks. |

`/ml-specs:nfr` gains a third destination. A non-functional requirement that is *measured* (p95 latency)
can only ever be a pipeline gate. One that is *structural* (every outbound call sets a timeout, no
PII in logs) compiles into an `ml-skills` custom rule keeping the NFR's own id — so it fires while
the code is being written rather than at review, and `docs/NFRS.md` → rule → finding stays a
traceable chain.

`/ml-specs:repo-init` seeds `.mlskills.json` and reports the baseline **without ratifying anything**. Every
standard starts `proposed`, which means it can only warn: a gate that fails on day one gets
disabled on day two, and deciding a standard may break the build is a human call, not an init step.

**It is genuinely optional** — the toolkit works unchanged without it. But where it is wired in,
the same rule applies as everywhere else here: if the standards could not be consulted, that is
reported as **unavailable**, never as clean. An unrun check is not a passing one.

**Hooks** (`hooks/`) — active on install, no setup:
- **Knowledge-layer drift warning** (`SessionStart`) — one line when `CLAUDE.md`/`docs/` have fallen
  more than 30 source commits behind the code, silent otherwise. Drift is invisible and
  `/ml-specs:repo-refresh` only runs when someone remembers it; this is the reminder. Tune with
  `SDD_DRIFT_THRESHOLD`.
- **Session handoff notice** (`SessionStart`) — one line when `.claude/handoff/` holds a note written
  in the last 7 days, naming the newest one and telling you to read it or delete it; silent
  otherwise. It surfaces the note, never reads it into context. Tune the age window with
  `ML_HANDOFF_MAX_AGE_DAYS`.
- **Secret scan** (`PreToolUse` on Bash) — blocks a commit whose staged diff contains a likely AWS
  key, private key, Slack/GitHub token, JWT, or `secret=…` assignment. Added lines only, so removing
  a leaked key is never blocked. False positives: add a regex to `.claude/secret-allowlist.txt`.
- **Scope guard** (`PreToolUse` on Write, Edit, MultiEdit, NotebookEdit, Bash) — refuses a write
  outside the active spec's `Touches` row, ~57ms, before the edit lands. `spec-gate.mjs` already
  fails a transition whose branch touched something undeclared, but by then the work exists and
  somebody has to choose between reverting good code and widening the spec after the fact.

  **Opt-in per spec.** The active spec is the one whose `Branch` row names your current branch;
  leave `Touches` as `—` and nothing is bounded. It fails open on every uncertainty — no spec
  names this branch, two do, the row is unfilled, node is missing — and says which. A guard that
  blocks a file you can see is in scope is a guard you switch off, and then it catches nothing.

  On `Bash` it reads **redirections and `tee`** out of the command, because a Bash payload has no
  file path. It does not parse `cp`, `mv`, `sed -i` or `dd` — one argument grammar per utility is
  one false block per mistake. `> "$out"`, a heredoc body, `/dev/null`, and anything outside the
  repo all yield nothing, and nothing means allowed.

  `specs/` and `.ml-specs/` stay writable whatever the row says: the fix for an out-of-scope
  change is usually to widen the declaration, and a rule you cannot amend is one people route
  around.

Project-specific automation (format, lint, test) can't ship — the plugin can't know your commands —
so it stays opt-in in `templates/hooks/settings.hooks.example.json`.

**CI gate** (`templates/ci/`, seeded by `/ml-specs:repo-init`) — `knowledge-check.mjs` fails a PR when a doc
asserts something no longer true: a `file:line` pointing at deleted code, a router row pointing at a
missing shard, a broken doc link. It also warns when a PR changes source and touches no doc. That's
the mechanical half of `/ml-specs:repo-doctor`; the judgment half stays a human-run command. Adopting on a
repo with existing drift? Start with `--warn-only`, clear the backlog with `/ml-specs:repo-refresh`, then drop
the flag — a gate that fails on day one gets disabled on day two.

**Deterministic checks** (`scripts/`) — the half of the loop that must not be a model call. A merge
gate has to give the same verdict every run, with no API key and no network, and *"the gate passed
because the model said so"* is not an audit trail. All pure Node, no dependencies, and each exits
non-zero so it can fail a build:
- `spec-gate.mjs` — the mechanical evidence a lifecycle transition claims (named tests exist, git
  state, required sections). Used by `/ml-specs:spec-advance`.
- `spec-advance.mjs` — **the only thing that writes a spec's `Status`.** `spec-advance.md` always
  claimed to be, and nothing was behind it: the gate reported and a model edited the header table.
  A rule in a prompt is advice — same model, same repo, two runs, two outcomes, and no way to tell
  afterwards which happened. The script refuses on any `FAIL`, refuses when a `MANUAL` gate is
  unsigned, refuses an attestation under ten characters, writes the Status cell and nothing else,
  and exits 1 on refusal / 2 when it could not run.
- `spec-evidence.mjs` — reads the **evidence records** back and judges each: `stale` (a file the
  gate read has changed), `amended` (the spec itself moved after it passed), `unsound` (the record
  was edited after it was written), `superseded` (the spec has moved past that status), or
  `unknown`. The four are not interchangeable — each wants a different action, so
  `/ml-specs:repo-doctor` prints a different remedy for each. `unknown` is **not** a failure: a
  record that cannot be judged has not been shown wrong.
- `ml-specs.mjs` — **the published `bin`**, and the only part of the toolkit that reaches hosts
  other than Claude Code. `ml-specs hosts` lists the 16 agent hosts, whether each is detected on
  this machine, and where an install would land; `ml-specs install --host <id|all>` writes a thin
  entry file into the place that host reads. Its verb list is a frozen contract — every shim it
  installs names `npx @mlmcps/ml-specs <verb>`.
- `pr-address.mjs` — the library half of `/ml-specs:pr-address`: fetches the PR, keys replies on
  `(comment, updatedAt)` so a re-run answers nothing twice, and refuses to claim anything about
  work that is not pushed. The gate is here rather than in the prose on purpose.
- `spec-eval.mjs` — runs the prompt eval suite. **It reports and never gates.** An eval expectation
  is a file, an exit code or an absence — never a string the model produced, because a suite that
  pins wording is a suite that fails on a better prompt. Needs `ML_SPECS_EVAL_RUNNER` set to
  actually run; without it, it says so rather than reporting a pass.
- `spec-new.mjs`, `spec-next.mjs`, `spec-why.mjs`, `spec-cycle.mjs`, `spec-wiring.mjs`,
  `spec-skills.mjs` — the scripts behind `/ml-specs:spec-new`, `/ml-specs:next`,
  `/ml-specs:repo-cycle`, `/ml-specs:repo-wiring` and `/ml-specs:repo-skill`. All read-only except
  the first, which only ever creates a new file.
- `spec-trace.mjs` — the chain from ticket to test case. Distinguishes **broken** from
  **unverifiable**: a Ticket typed into the header table cannot be checked from inside the repo, and
  counting it as passing would make the report a lie.
- `nfr-compile.mjs` — see `/ml-specs:nfr`.
- `spec-brief.mjs` — packages an approved spec for an implementer: criteria paired with reserved
  test-case ids, constraints in force, and the gates that will fail the build. Deliberately **not a
  prompt** — the same document for a person or an agent, because anything an agent needs that a new
  engineer would not is a sign the spec is underspecified.
- `tracker-sync.mjs` — governed sync with Azure DevOps or Jira. The spec owns the contract; the
  tracker owns status, assignee and sprint. Neither writes the other's fields.
- `spec-fanout.mjs` — see `/ml-specs:spec-fanout`.
- `branch-policy.mjs` — install and audit the branch policy that makes a pipeline into a gate.
  `install` cannot produce an advisory gate; `audit` treats advisory, disabled, `manualQueueOnly` and
  GitHub's `enforce_admins:false` as blockers, because a gate quietly demoted to optional is how this
  kind of governance dies.
- `fix-specs.mjs`, `survey-estate.mjs` — spec hygiene repair, and cheap estate triage before
  `/ml-specs:repo-rollout`.

> The tracker and source-control clients are **contract-tested, not integration-tested**: they build
> what ADO 7.1, Jira Cloud v3 and GitHub 2022-11-28 document, verified offline against a recording
> transport. None has run against a live organisation. Every write path has `--dry-run`, which prints
> the exact requests and needs no credentials — useful to hand whoever has to approve the token.

**Dashboard generator** (`scripts/spec-dashboard.mjs`) — writes a **self-contained HTML page** of
every spec: lifecycle bars, acceptance-criteria completion, a needs-attention list ordered by
severity, duplicate spec numbers, and a searchable/filterable table. Crucially it also shows
**in-flight parallel work** — one row per git worktree joined to the spec it's building, with
branch, commits ahead, and whether the tree is dirty, so running four specs at once is four
labelled rows instead of four indistinguishable terminals. No CDN, no fonts, no network calls: the
page works offline and the spec data never leaves the machine that generated it.

```
node scripts/spec-dashboard.mjs --root /path/to/repo --open
```

**Lifecycle gate** (`scripts/spec-gate.mjs`) — the mechanical half of a `/ml-specs:spec-advance` transition,
done exactly instead of by re-reading: lifecycle ordering, leftover `<placeholder>` text, whether
every acceptance criterion is ticked, whether **every test file named in the §6 table exists on
disk**, and whether the recorded branch is merged. Prints `PASS` / `FAIL` / `MANUAL` per gate and
exits non-zero on any `FAIL`. It deliberately refuses to judge what a script can't witness — human
approval, whether a §8 question is blocking, whether the suite ran green — and marks those `MANUAL`,
because a `PASS` there would get believed. Read-only, no network calls.

```
node scripts/spec-gate.mjs specs/0001-foo.md --to Verified [--json]
```

**Survey script** (`scripts/survey-estate.mjs`) — read-only inventory of candidate repos: stack,
knowledge-layer state, spec count, 90-day activity, uncommitted changes, and cross-service edge
signals (event listeners, HTTP clients, contract files), ending in an init/adopt/refresh/review
recommendation per repo. Used by `/ml-specs:repo-rollout`, but useful alone — it costs nothing and answers
"where do we even start?". No network calls.

**Repair script** (`scripts/fix-specs.mjs`) — for a repo that has been using `specs/` for a while,
run before adopting the newer commands. Renumbers duplicate spec numbers (taking the next free
number across **all** branches, `git mv` so history follows, rewriting exact filename references),
and moves prose out of `Status` into the canonical lifecycle word — **preserving the prose verbatim**
as a `> **Status note:**` under the header table, since that text is usually real information in the
wrong field. Dry run by default; `--apply` to write; refuses to apply over a dirty `specs/` so its
diff stays reviewable on its own. Idempotent. No network calls — it runs entirely on your machine.

**MCP server** (`mcp/`) — the deterministic half, for any MCP client (Cursor, a custom agent, CI),
read-only and dependency-free. **Ten tools**: `estate_lookup` (who produces/consumes a contract),
`knowledge_check` (do the docs still match the code), `spec_list`, `spec_next_number`
(collision-safe across branches), plus the `scripts/` half — `spec_gate` (the mechanical lifecycle
evidence), `spec_trace` (ticket → test-case chain), `spec_brief` (an approved spec packaged for
whoever implements it), `nfr_check` (which NFRs do not route into anything enforceable),
`estate_survey`, and `spec_evidence` — the only one that answers about the **past**: does the gate
that already passed still describe this repository? Plus the templates as `mlspec://` resources and
all 29 commands as MCP prompts, with the agents they delegate to inlined.

**Nothing that writes is exposed.** `spec-advance.mjs` is the only thing that may change a spec's
Status, and it stays out of MCP deliberately: a status transition is a claim a human signs, and a
tool a model can call in a loop is the wrong shape for one.

Exposing `scripts/` matters more than the count suggests: `spec-gate.mjs` is the gate the whole
lifecycle turns on, and until now a CI job or a non-Claude agent could not ask it *does this spec
have the evidence for `Verified`?* A failed gate comes back as a verdict with `exitCode: 1`, not as
a tool error — a legitimate `FAIL` the caller cannot read would be worse than no answer. Skills, hooks, and real subagent execution have no MCP equivalent
and stay in the plugin — see [mcp/README.md](mcp/README.md). `knowledge_check` imports
the CI gate's implementation rather than copying it, so the two can't drift.

**Templates** (`templates/`) — seeded/filled into each repo by `/ml-specs:repo-init`: spec
README/TEMPLATE/AGENTS, `docs/` knowledge templates (PATTERNS, ARCHITECTURE, ESTATE, and the two
optional ones — GLOSSARY and CONTEXT), the CLAUDE.md fragment, `settings.json` (committed
attribution policy), optional `hooks/` automation examples, `.gitattributes`, and
`ML-SPECS.template.md` — the single generated document that carries the loop into a host that is
not Claude Code.

**The two optional documents are seeded only on evidence.** `/ml-specs:repo-init` writes
`docs/GLOSSARY.md` when the repo has domain vocabulary worth defining and `docs/CONTEXT.md` when it
has constraints the code cannot state, and writes neither otherwise. `/ml-specs:repo-doctor` reports
an absent one as **"not in use"**, never as a gap. An empty glossary is worse than none: it costs
context on every load and answers nothing.

## Evidence behind a status

A status used to be a claim with no basis on file. Pass the gate on Monday, change the module it
covered on Tuesday, and `Verified` still read `Verified` with nothing able to notice.

`/ml-specs:spec-advance` now records what the gate read: the base branch and sha, a hash of every
§6 test it resolved, a hash of every file the branch changed, the gate verdicts, and the signed
attestation. `spec-evidence.mjs` reads them back; `/ml-specs:repo-doctor` runs it; `/ml-specs:next`
consults it before the lifecycle, so **a failing record outranks the board** — a spec reading
`Verified` over a stale record is told to re-earn the claim, not to open a PR.

| Verdict | What it means | What to do |
|---|---|---|
| `stale` | a file the gate fingerprinted has changed | re-run the gate: `spec-advance --re-record` |
| `amended` | the **spec** moved after it passed — a criterion reworded or removed, a §6 row repointed | decide whether that was intended **before** re-running anything |
| `unsound` | the record was edited after it was written | it is not evidence; nothing about it is recoverable |
| `superseded` | a record exists for a status further along | nothing — this is a successful advance, not drift |
| `unknown` | the record cannot be judged, or predates records | **not a failure.** A record that cannot be judged has not been shown wrong |

Three things are deliberate. `superseded` is decided from the **records**, never from the `Status`
cell a human can hand-edit, and it never outranks `unsound` — advancing a spec cannot launder a
doctored one. `Approved` records **no file radius**, because approval happens before the work: an
approval that went `stale` for being implemented is how a freshness signal stops being read. And a
record says **how it was attested** — `human` or `unattended` — because `--attest` takes any
ten-character string, so an automated run could sign a person's name to a judgement they never
made. `--unattended` lowers no bar; it makes the transition legible, not permitted.

## Install (per developer / per repo)

```
/plugin marketplace add MLMCPS/ml-specs
/plugin install ml-specs@ml-tools
```

That's the public release mirror — no repo access, org membership, or token. Both commands default
to `--scope user`, so one run covers every project on your machine.

Or make it automatic for a repo by committing `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "ml-tools": { "source": { "source": "github", "repo": "MLMCPS/ml-specs" }, "autoUpdate": true }
  },
  "enabledPlugins": { "ml-specs@ml-tools": true },
  "attribution": { "commit": "", "pr": "" }
}
```

Teammates who clone a repo with that file get the plugin installed automatically (after trusting
the workspace). A `github` source is the only kind that works from a committed settings file — a
`directory` source stores an absolute path, and an `npm` source is silently ignored by the client.

**Don't also add `.mcp.json`.** The MCP server is bundled in the plugin; declaring it separately
registers a second copy that updates on a different schedule and will eventually disagree with the
first. The standalone `@mlmcps/ml-specs-mcp` package is for clients with no plugin system — Cursor,
VS Code's Copilot, CI.

## Every other host

The gates were always host-neutral — `spec-gate.mjs` reads a Markdown file and exits `0`/`1`/`2`.
What was missing was a way to reach them without `${CLAUDE_PLUGIN_ROOT}`, a variable exactly one
host defines.

```bash
npx @mlmcps/ml-specs hosts                 # 16 hosts, which are detected, where an install lands
npx @mlmcps/ml-specs install --host all    # or --host cursor, --host windsurf, …
npx @mlmcps/ml-specs install --host all --dry-run
```

It writes a thin entry file into the place each host reads, pointing at one generated `ML-SPECS.md`
that holds the loop. `/ml-specs:repo-hosts` reports the resulting board.

**Claude Code is deliberately skipped.** It is served by the plugin, which gives it 29 commands, 10
agents and four live hooks; a generated shim would be a strictly worse copy of that.

**A generated file may never name a mechanism its host lacks** — no `${CLAUDE_PLUGIN_ROOT}`, no
`$ARGUMENTS`, no `/ml-specs:` command, no hook, no subagent dispatch. `install` **refuses to write**
rather than emitting a document that tells an agent to do something its host cannot do. That is one
rule rather than sixteen precisely because Claude Code gets no generated file at all.

**Not all sixteen have been watched load.** `ml-specs hosts` marks which rows are verified and which
are written from the host's documented layout, and `/ml-specs:repo-hosts` carries that column
through. Claiming all sixteen were exercised would be worth less than a list that admits which.

## First-time setup in a new service

```
/ml-specs:repo-init        # learns THIS repo, then generates CLAUDE.md + docs/PATTERNS.md + docs/ARCHITECTURE.md, scaffolds specs/, .gitattributes, .claude/settings.json
/ml-specs:repo-estate      # only if this repo is one service in a larger estate — indexes the cross-service contracts
```
Then use the loop: `/ml-specs:spec-explore` (optional) → `/ml-specs:spec <ticket>` → review → `/ml-specs:spec-advance … Approved` →
`/ml-specs:spec-build specs/NNNN-*.md` → `/ml-specs:spec-verify` + `/code-review` → `/ml-specs:spec-advance … Verified` → `/ml-specs:pr`.

## Going faster on an existing app

The install and the loop above are the mechanics. This is how teams actually get shorter cycle
times out of them.

**1. Teach the repo first — this is where the speed comes from.** Run `/ml-specs:repo-init` once per
repo. Without the learned knowledge layer every session re-derives your stack, conventions and
layout from scratch — slow, and it guesses wrong. With it the agent loads the *least* context that
answers the task, and matches your existing style on the first attempt instead of the third. Keep it
honest with `/ml-specs:repo-refresh` after structural changes, and `/ml-specs:repo-doctor` to spot
drift.

**2. Pick the right lane — don't spec everything.**

| Change | Use |
|---|---|
| One-liner, obvious edit | `/ml-specs:code` |
| A bug | `/ml-specs:fix` — reproduces with a failing test first, then the smallest change that turns it green |
| Touches an interface, several files, or a contract | the full spec loop |

Most of the time lost to this toolkit is lost by running the heavy loop on trivial work, or by
skipping it on work that then gets rewritten twice.

**3. Review the spec, not just the diff.** `/ml-specs:spec-review` runs before any code exists. The
slow part of agent-assisted development isn't generating code, it's discovering halfway through that
the wrong thing got built — and a spec review catches that while it's still a paragraph to edit
rather than a branch to throw away.

**4. Then parallelise.**

- `/ml-specs:spec-fanout` — one spec, N repos, N PRs, all carrying the same key. The big one when a
  contract change lands across several services at once.
- `/ml-specs:repo-impact` — who breaks if this ships, answered before it ships.
- Several `developer` agents at once, one approved spec each, isolated in its own git worktree.
- `/ml-specs:repo-rollout` — onboard an estate in reviewed waves rather than repo by repo.

**Starting point.** Pick your least critical repo, run `/ml-specs:repo-init`, and take one small real
ticket through the loop end to end. You'll see where the gates earn their keep and where they're
overhead for your team, before committing the estate to it.

## Opting out of architecture standards

Some of the toolkit integrates with [`ml-skills`](https://www.npmjs.com/package/@mlmcps/ml-skills):
`/ml-specs:spec-verify` reports an architecture-standards verdict, and `/ml-specs:spec-advance`
records it on the `Verified` gate. In a repo that does not use it, every review ends with
`standards: unavailable` — technically honest, and pure noise once you have read it the tenth time.

Put a `.ml-specs.json` at the repo root to say so once:

```json
{ "mlSkills": "off" }
```

| Value | Behaviour |
|---|---|
| `off` | The check is out of scope. It is not run, and its absence is **not** reported in review output. `/ml-specs:spec-advance` still records one line in the transition note, so an archived spec never leaves a reader unable to tell "checked, clean" from "opted out". |
| `auto` | The default when the file is absent — run `ml-skills` if it is installed, report honestly when it is not. |

Anything else — a missing key, unreadable JSON, an unrecognised value — means `auto`. The flag
fails **open**: a typo must never silently disable a gate.

This is a second, explicit gate on top of the existing one: the standards check only ever runs
when the repo also has a `.mlskills.json`. `off` is reversible at any time — change the value, and
the next review reports standards again.

## What this does not do

Collected in one place, because each of these is stated where it is implemented and a reader
should not have to find five sections to learn them.

- **It does not judge whether your contract is any good.** The toolkit governs *process*: a
  contract on paper, approved before code, verified against its own criteria. Whether the API shape
  or data model is sound is the optional [`ml-skills`](#opting-out-of-architecture-standards) half,
  and it is off in many repos.
- **It is not a service.** No database, no daemon, no network calls from the gates. `spec-gate.mjs`
  reads Markdown and git and exits `0`/`1`/`2`. Four CLIs do reach host APIs — `pr-address`,
  `spec-fanout`, `tracker-sync`, `branch-policy` — and only **two SCM hosts exist**, GitHub and
  Azure DevOps Repos. No GitLab, no Bitbucket.
- **The tracker and SCM clients have never run against a live organisation.** They are
  contract-tested against a recording transport, built to what ADO 7.1, Jira Cloud v3 and GitHub
  2022-11-28 document. Every write path has `--dry-run`, which needs no credentials.
- **Hosts other than Claude Code get a document, not the machinery.** No hooks, no subagent
  dispatch, no slash commands — those are host mechanisms, and `install` refuses to write a file
  naming one the host lacks rather than emitting an instruction that cannot be followed.
- **Not all sixteen hosts have been watched load.** `ml-specs hosts` marks which are verified and
  which come from vendor documentation.
- **The prompt evals report and never gate**, and the structural prompt checks are warnings. A
  check that can fail a build starts pressuring people to write worse prose to appease it.
- **A gate refuses rather than guesses.** `MANUAL` is a real verdict: human approval, whether a §8
  question is blocking, whether the suite truly ran green. A `PASS` there would get believed, so
  the scripts decline to give one.
- **The learned docs are only worth what they say.** Patterns carry `(inferred)` markers, and a
  stale summary is worse than none — which is why `/ml-specs:repo-refresh` and
  `/ml-specs:repo-doctor` exist and why absence is reported as "not in use" rather than as a gap.

## Updating

Consumers: repos with `autoUpdate: true` pick up a new version on the next launch; everyone else
runs `/plugin marketplace update ml-tools`. Restart Claude Code to apply it.

Maintainers: run `/release` in the marketplace repo. The version lives in **five** files and a tag
publishes to three channels — see that repo's README rather than bumping by hand.
