# Changelog — ml-specs

All notable changes to this plugin. Bump `version` in `.claude-plugin/plugin.json`, `package.json`,
**and** the `ml-specs` entry in `../.claude-plugin/marketplace.json` together on each release —
`release.yml` checks all three against the tag and refuses to publish if any disagrees.

Entries before 1.0.0 refer to this plugin under its former name, `sdd-toolkit`.

## [1.2.0]

### Added
- **An ANALYZE phase before SPECIFY — `/ml-specs:spec-explore`.** The loop used to go straight to
  drafting: `/ml-specs:spec` explored the code and then committed to a design by writing it, so the
  analysis that chose the approach happened invisibly and the approaches it rejected were lost. A
  reviewer reading the spec three weeks later could not tell an alternative that was considered and
  dismissed from one nobody thought of, and the same alternatives got re-litigated in review.

  `/ml-specs:spec-explore <ticket-or-idea>` delegates to a new, read-only **`analyst`** agent
  (`Read, Grep, Glob, Bash` — no `Write`, no `Edit`) and writes a reviewable note to
  `specs/explore-<slug>.md`: what exists, what it touches, two or three approaches with what each
  costs and what it forecloses, the blocking contract questions, and what it could not determine.

  `/ml-specs:spec` gains a **step 0** that globs `specs/explore-*.md` and matches a note on its
  `Ticket` cell — or, for the `— (no tracker)` case that is most specs, on a normalized-token
  `Title`. Every match is reported and the human is asked; a match is never picked silently. The
  matched note's blocking questions go into step 3 instead of being re-derived, and its rejected
  approaches into the spec's rationale.

  **The phase is optional and the note is outside the spec lifecycle.** With no matching note
  `/ml-specs:spec` behaves exactly as before. The note has no four-digit prefix, so it carries no
  `Status`, never appears in `/ml-specs:repo-status` or `spec_list`, and `/ml-specs:spec-advance`
  neither reads nor writes it. Every statement of the loop that ships — both diagrams, both
  walkthroughs, the agent tables and the command chains — now shows five phases, with the literal
  word *optional* on the new one.

- **A command that answers "what does this code actually do?" — `/ml-specs:explain`.** Every
  read-only command the toolkit shipped pointed at a *change*: `/ml-specs:spec-explore` analyses a
  ticket into approaches, `/ml-specs:repo-doctor` reports knowledge-layer drift,
  `/ml-specs:repo-status` summarises the board. Understanding an unfamiliar module — joining a
  codebase, reviewing someone else's PR, picking up a service after six months — fell back to
  unstructured chat, where the answer is uncited and gone when the session ends.

  `/ml-specs:explain <path-or-symbol-or-flow>` delegates to a new, read-only **`explainer`** agent
  (`Read, Grep, Glob, Bash` — no `Write`, no `Edit`) and writes a reviewable note to
  `specs/explain-<slug>.md`: what the code does, its entry points, the flow through it, its
  contracts and callers, the gotchas, and what the agent could not determine — every claim carrying
  a real `file:line`.

  **It is outside the SDD loop**, like `/ml-specs:code` and `/ml-specs:fix`, and it is not
  `/ml-specs:spec-explore`: that command decides what should be built, this one describes what is
  already there. The note has no four-digit prefix, so it carries no `Status`, never appears in
  `/ml-specs:repo-status` or `spec_list`, and `/ml-specs:spec-advance` neither reads nor writes it.

- **A way to tell the toolkit you don't use architecture standards.** Parts of the verify loop
  integrate with `ml-skills`: the `reviewer` agent runs a standards check, `/ml-specs:spec-verify`
  relays its verdict, and `/ml-specs:spec-advance` records it on the `Verified` gate. Those
  instructions are deliberately honest about absence — an unrun check is reported `unavailable`,
  never rounded to a pass. In a repo that does not use `ml-skills`, that honesty turns into noise:
  every review ends with a paragraph stating that nothing happened, and it has to be read and
  discarded each time.

  A repo-root `.ml-specs.json` now says it once:

  ```json
  { "mlSkills": "off" }
  ```

  On `off` the check is not run and its absence is not reported. `auto` — the meaning when the file
  is absent — keeps today's behaviour exactly, so no existing repo changes unless it opts in.

  **`/ml-specs:spec-advance` still records one line** in the transition note when the flag is `off`.
  Suppressing the per-review paragraph removes noise; suppressing the permanent record would mean an
  archived spec could not be read to tell "checked, clean" apart from "opted out" — which is the
  same `unavailable ≠ pass` confusion the check exists to prevent, moved somewhere harder to notice.

  The flag **fails open**. A missing key, unreadable JSON, or an unrecognised value all mean `auto`,
  never `off` — a typo must not silently disable a gate.

  This gates the integration; it does not remove it. `/ml-specs:repo-skills`, the standards template
  and the skills documentation template all still ship, and setting the value back to `auto` restores
  the previous behaviour with no other change.

- **A session handoff standard — `/ml-specs:handoff`.** Work does not fit in one session, and when
  one ends everything the session worked out is gone: which approach was rejected and why, what is
  half-done, which test is red on purpose, what the next concrete step is. The next session starts
  from the code alone and re-derives it, badly.

  `/ml-specs:handoff [label]` gathers verifiable state first (`git rev-parse --abbrev-ref HEAD`,
  `git status --short`, `git log --oneline`), then writes one note per invocation to
  `.claude/handoff/<YYYY-MM-DD-HHMMSS>-<slug>.md` — where this got to, what is in flight, what was
  decided *and rejected*, the next step, and the landmines. It runs **inline and delegates to no
  agent**, deliberately: a subagent starts with fresh context and cannot see the parent session's
  conversation, which is the command's entire input. It writes nothing but the note, commits
  nothing, and touches no spec's `Status`.

  A third always-active hook, `hooks/handoff-notice.sh` (`SessionStart`), prints **one line** when a
  note from the last 7 days is waiting, naming it and saying to read it or delete it — and nothing
  at all otherwise. It never reads the note into context and never blocks. Tune the window with
  `ML_HANDOFF_MAX_AGE_DAYS`.

  `/ml-specs:repo-init` now states the convention in the `CLAUDE.md` it generates, including that
  committing handoffs or ignoring them is the adopting repo's choice.

  Fixed in passing, in the sibling hook: `knowledge-drift.sh` still told every adopting repo to run
  `/sdd-doctor` and `/sdd-refresh`, names gone since the `/ml-specs:` namespacing, and labelled
  itself `sdd-toolkit`. It now names `/ml-specs:repo-doctor` and `/ml-specs:repo-refresh`. The
  `SDD_DRIFT_THRESHOLD` environment variable is deliberately **not** renamed — adopting repos may
  already set it.

## [1.1.1]

### Fixed
- **The CI knowledge-check template reported broken references for documentation that was
  correct.** Its reference parser required a path to begin with an alphanumeric, so a leading dot
  was never captured: `.github/workflows/release.yml:127` was read as
  `github/workflows/release.yml:127` and reported as a file that does not exist. Every repo's docs
  cite dot-prefixed paths — `.github/`, `.claude-plugin/`, `.mlskills.json` — so the gate failed on
  correct input in this repo (15 errors, every one a false positive) and would have done the same
  in every repo that adopted it. A gate that fails on correct input gets switched off, and the real
  check goes with it.

  Relative citations were broken in a second way. `./x.mjs:1` was silently never checked at all,
  and `../a/b.mjs:1` captured the meaningless fragment `b.mjs`, producing a hard error naming a
  path the document never wrote. `./` and `../` now resolve against the directory of the document
  that contains them, which is what a reader assumes they mean; everything else stays
  repository-root-relative exactly as before.

  A citation that resolves outside the repository is now reported rather than skipped, with its own
  wording — `resolves outside the repository root` — instead of the misleading "does not exist".
  The distinction matters in CI, where nobody can ask which was meant. The check is lexical only:
  symlinks are deliberately out of contract.

  The line-number half of the check was resolving separately from the existence half, so a relative
  citation could confirm the right file exists and then count the lines of a different one. Both
  now resolve identically.

- **Upgrading will surface real breakage that was previously hidden.** Because dot-prefixed paths
  were never resolved, any genuinely stale `.github/…` or `.claude-plugin/…` citation in an adopted
  repo's documentation has been passing silently. Those become visible on the first run after this
  release. Expect a one-off cleanup; `/ml-specs:repo-refresh` is the intended way to clear it.

### Changed
- The knowledge-check template is now covered by tests, which it previously had none of. They live
  in `ml-specs/tests/` rather than beside the file they exercise, so that `templates/` keeps meaning
  exactly one thing: what gets written into an adopting repo.

  The marketplace validator also now enforces that the template and this repository's own copy of it
  stay byte-identical — they are required to match and nothing checked it. The check itself runs
  only in this repository's CI and is not part of the published package; the small comparison
  helper it calls, `scripts/lib/file-identity.mjs`, does ship, though nothing in the published
  packages imports it.

## [1.1.0]

### Added
- **A `security-reviewer` agent, wired into `/ml-specs:spec-verify`.** Verification used to ask one
  question — does this match the spec — and a change that matched its spec perfectly could still
  ship an injection or a leaked credential. Security was left to whoever remembered to ask for it,
  which meant it happened on the changes least likely to need it and got skipped on the ones that
  did. The agent runs as a standing part of the verify pipeline instead of on request, with its own
  severities and verdicts, and it is read-only: it reports what it finds and cannot "fix" it.

- **`/ml-specs:repo-skills`**, which maps a repo's actual stack onto the `ml-skills` catalogue and
  writes `docs/SKILLS.md`. Adopting architecture standards previously meant reading the catalogue
  and guessing which of them applied to your codebase. The command inspects what is really there —
  language, framework, database, CI — and proposes the subset that matches, so the standards a repo
  adopts are the ones it can actually violate.

### Fixed
- **Every slash-command reference in the shipped documentation was written in a form that does not
  work.** Commands are invocable only as `/ml-specs:<name>`, but all 573 references across the
  plugin's commands, agents, README, CHANGELOG and templates named them bare — `/spec-advance`
  rather than `/ml-specs:spec-advance`. Anyone copy-pasting the "next command in the loop" line that
  every command ends with got `Unknown command`. Both manifest `description` strings had the same
  defect, so the marketplace listing and `/plugin` taught the broken form too.

  This mattered most in `templates/`, which `/ml-specs:repo-init` and `/ml-specs:repo-adopt` write
  into every adopted repo — the defect reproduced itself into each new consumer. All of them now
  carry the namespaced form, so a newly adopted repo gets instructions that run.

  Existing adopted repos keep their stale references until they are re-run through
  `/ml-specs:repo-refresh` or `/ml-specs:repo-adopt`; there is no automatic migration.

  A validator check in this repo now fails the build on any bare reference that reappears, with a
  per-file `<!-- allow-bare-commands -->` escape for documents that quote the broken form
  deliberately. That guard is marketplace-side tooling and is not part of the published package.

## [1.0.0]

**Breaking.** The plugin is renamed and eight commands change name with it. Existing installs will
not upgrade in place — see *Migrating* at the end of this entry.

### Changed

- **`sdd-toolkit` is now `ml-specs`, in the `ml-tools` marketplace.** "SDD" named a methodology,
  not a product, and it meant nothing to anyone who had not already met the acronym. The plugin now
  sits under the same house prefix as its sibling: `ml-skills` says what good looks like here,
  `ml-specs` is the loop that proves you met it. Marketplace owner, npm package
  (`@mlmcps/ml-specs`), mirror repo and release tag prefix (`ml-specs-v*`) move with it.

- **The eight knowledge-layer commands are now `/repo-*`.** `/sdd-init`, `/sdd-refresh`,
  `/sdd-doctor`, `/sdd-adopt`, `/sdd-estate`, `/sdd-impact`, `/sdd-rollout` and `/sdd-status`
  become `/ml-specs:repo-init`, `/ml-specs:repo-refresh`, and so on. None of them was ever about specs — they learn,
  refresh and audit the repo's knowledge layer, and the `sdd-` prefix said only which plugin they
  came from, which the client already namespaces. The surface now splits along what it does:
  **`/spec-*` is the loop, `/repo-*` is the knowledge layer.** The loop commands are unchanged.

- **Agents lose their `sdd-` prefix**: `sdd-developer` → `developer`, `sdd-reviewer` → `reviewer`,
  `sdd-scanner` → `scanner`, `sdd-spec-author` → `spec-author`, `sdd-spec-reviewer` →
  `spec-reviewer`. `coder` and `pr-author` already had no prefix; the two conventions were an
  accident of history.

- **MCP server renamed** to `ml-specs`, its file to `mcp/ml-specs-server.mjs`, and its resource
  scheme from `sdd://` to `mlspec://`. Tools now arrive as `mcp__ml-specs__*`.

### Added

- **The architecture standards are wired into the loop at four points**, replacing prose that told
  each agent to work the routing out for itself. Where a command previously said *"call
  `skill_list`, then `skill_get` for the ones that apply — `openapi-contract` if §4.1 describes
  HTTP, `entity-relationships` if §4.2 changes a schema"*, it now calls one tool that knows that
  mapping:

  | Phase | Tool | What it replaced |
  |---|---|---|
  | `/ml-specs:spec` | `spec_standards` | hand-picking standards per §4.x |
  | `/ml-specs:spec`, `/ml-specs:spec-review` | `spec_precheck` | nothing — there was no pre-code check |
  | `/ml-specs:spec-verify`, `/ml-specs:spec-advance` | `verify_evidence` | interpreting `check_repo` by hand |
  | `/ml-specs:nfr` | `gate_manifest` | drafting a rule and hoping it fires |

  `spec_precheck` is the one with no predecessor. It runs the real checkers over the fenced blocks
  in a **draft spec** and reports findings at the spec's own line numbers, so a versioning, money-
  type or idempotency mistake is caught while it still costs one edit. Sections with no fenced
  contract are reported as **not checked** rather than folded into a clean result.

- **`verify_evidence` gives the `Verified` gate four verdicts, not two.** `/ml-specs:spec-advance` already
  said in prose that "`Verified` against a gate nothing could fail is a weaker claim than it
  looks"; that judgement is now a field. `inconclusive` — clean, but no standard in scope was
  ratified, so nothing *could* have failed — is reported as the absence of evidence rather than
  rounded up to a pass. Only `pass` clears the gate on its own.

- **Five deterministic scripts are exposed as MCP tools** — `spec_gate`, `spec_trace`,
  `spec_brief`, `nfr_check`, `estate_survey`. `scripts/` holds the half of the toolkit that must
  not be a model call, and until now only Claude Code could reach it, which left the most
  load-bearing check in the toolkit — *does this spec have the evidence for `Verified`?* —
  unavailable to CI, to Cursor, and to any other agent. They are invoked as subprocesses rather
  than imported, so they run the same execution path a human gets, and the write-capable flags
  are never passed.

- **The developer agent can reach a third-party skill catalog** via `skill_search` / `skill_fetch`
  for the things the eleven standards do not cover — a payment provider, a niche integration.
  Those results are reference material with no authority: where one contradicts a standard, the
  standard wins.

### Fixed

- **`/ml-specs:spec-fanout` gave a false all-clear when the estate index was missing.** A repo with no
  `docs/ESTATE.md` reported no affected consumers, which is indistinguishable from "there are
  none" and is the more dangerous of the two answers.
- **`/spec-brief` refused a Draft spec but not one with no acceptance criteria**, so the emptier
  failure got through the check written to catch it.
- **The release now fails when `MIRROR_TOKEN` is missing**, instead of shipping npm and reporting
  green while the public mirror — the channel Claude Code actually installs from — sat on an old
  version. 0.20.0, 0.20.1 and 0.21.0 all reported success against a mirror stuck at 0.19.0.

### Migrating

Existing installs point at a marketplace and plugin that no longer exist under those names:

```
/plugin uninstall sdd-toolkit
/plugin marketplace remove ace-tools
/plugin marketplace add MLMCPS/ml-claude-plugins
/plugin install ml-specs
```

Repo-level `.claude/settings.json` files that enable the plugin need the same edit. Two strings are
deliberately **not** renamed, because both are live contracts with things outside this repo: the
`sdd-spec-gate` required-status-check context (renaming it breaks branch protection on every repo
already configured) and the `<!-- sdd:constraints -->` markers already written into consumers'
`CLAUDE.md` (renaming them orphans every block already generated). Both need a migration, not a
find-and-replace.

## [0.21.0]

### Added
- **The MCP server now serves the plugin's commands as prompts**, so a client outside Claude Code
  gets the workflow and not just the lookups. Until now `@mlmcps/sdd-mcp` exposed four read-only
  tools and nothing else: someone wiring it into Cursor or a custom agent could ask *what specs
  exist* but had no `/ml-specs:spec`, `/ml-specs:spec-build` or `/ml-specs:code` to act on the answer. The commands were
  already the shape of an MCP prompt — frontmatter over a body with an `$ARGUMENTS` placeholder —
  so they are served as one. All 18 arrive, described from their own frontmatter.

  Clients namespace MCP prompts, so `spec` shows up as `/mcp__sdd-toolkit__spec`, not `/ml-specs:spec`.
  That is the client's doing and cannot be opted out of.

- **Agents a command delegates to are inlined into the prompt.** Several commands hand real work
  to a subagent, and MCP has no way to register one — so those steps would have silently done
  nothing, which is the worst failure available here: the command appears to run and quietly skips
  its adversarial pass. Any agent a command names in bold now has its instructions appended to the
  prompt under a heading that says why. The client follows them inline, losing the isolated
  context, tool restrictions and parallelism the plugin gets. `/ml-specs:spec-fanout` degrades most, being
  parallel by design.

  Matching the bolded name in the command's prose, rather than adding a machine-readable field,
  is deliberate: it is the same string a reader of the command sees, so the two halves cannot
  drift apart without the prose being wrong too.

- **Protocol tests for the MCP server** (`mcp/sdd-server.test.mjs`), which had none. They drive it
  the way a client does — spawn the process, write newline-delimited JSON-RPC to stdin, read the
  replies — so they also catch the one failure a unit test cannot: the server not starting at all.

### Changed
- `commands/` and `agents/` are now part of the `@mlmcps/sdd-mcp` package, since the prompts are
  read from them at runtime. Both directories are already on the public mirror, so this discloses
  nothing new. Skills, hooks, and the plugin's real subagent execution remain Claude Code only.

## [0.20.1]

### Fixed
- **`/ml-specs:nfr` and `/ml-specs:spec-fanout` were missing from the plugin's own description**, so the two commands
  0.20.0 added shipped invisible: the description is the command list a user sees in the marketplace
  and in `/plugin`, and neither new command appeared in it. They worked perfectly for anyone who
  already knew they existed, which is not how anyone finds a command.

  The cause is worth recording because it will recur otherwise. Two manifests carry that list —
  `plugin.json` and the `marketplace.json` entry — and nothing kept either in step with `commands/`.
  Preparing 0.20.0 one was updated and the other was not, and every existing check passed: the
  release gate verifies versions, and this is not a version. `validate-plugin.mjs` now fails when a
  command is missing from either description, and warns when a description names one that no longer
  exists, so the next release cannot repeat it.

  Git-source installs were unaffected — they resolve from the default branch, which had the fix
  within the hour. This release is for the npm packages and the public mirror, where 0.20.0 is
  immutable.

## [0.20.0]

### Added
- **The chain from ticket to test case is now checkable — `scripts/spec-trace.mjs`.**
  `spec-gate.mjs` already checked that a spec's claimed evidence exists on disk. Nothing checked
  that the branch, the pull-request title and the test-case ids all carry the *same* spec id — which
  is the chain an auditor actually asks about, and the way it silently stops being true is a
  hand-typed branch name. Every downstream id is now produced by a function with a matching parser,
  so a link that lost the key is a parse failure rather than a divergence nobody notices. Exits
  non-zero, so it gates a pull request.

  It reports **broken** and **unverifiable** separately, and that distinction is deliberate. A
  `Ticket` typed into a spec's header table cannot be checked from inside the repo; counting it as
  passing would make the whole report a lie, so it is named as unchecked instead.

- **`/ml-specs:nfr` — non-functional requirements stop vanishing.** NFRs are the requirements most likely to
  be agreed and then lost, because they do not decompose into user stories: a story breakdown
  flattens "the API shall be performant" into prose that nothing checks, and nobody notices until
  the load test that was never written would have caught it. This compiles each NFR into the two
  things that actually enforce it — a standing constraint in `docs/CONSTRAINTS.md`, and a blocking
  pipeline gate — and **refuses** one with no machine-checkable threshold, because an NFR nothing
  can fail is not a requirement. It also fails when an NFR id has been written into an acceptance
  criterion, which is the exact moment enforcement turns back into a sentence.

  The constraints it writes are carried into the next spec automatically, so a rule agreed in
  August is in front of whoever writes a spec in November without anyone remembering it exists.

- **`/ml-specs:spec-fanout` — a change spanning four services is one change, provably.** Today that is four
  pull requests a reviewer correlates by hand and hopes they got right. Every branch in a fan-out
  now carries the same derived name, and `docs/ESTATE.md` supplies the consumers — including the
  service one hop out that nobody remembered. Plans first, then `--dry-run` prints the exact
  requests, then opens them. Partial failure is reported rather than thrown: a permissions error on
  the fourth repository must not hide that three succeeded.

- **`scripts/branch-policy.mjs` — the gate can be checked for still being a gate.** A pipeline that
  runs and reports changes nothing; the load-bearing artifact is the branch policy. The quiet
  failure mode is someone demoting it to advisory to unblock a release on a Friday — nothing breaks,
  no test fails, and merges simply stop being gated until an audit finds the holes months later.
  `install` has no flag that can produce an advisory gate, and `audit` treats advisory, disabled,
  `manualQueueOnly` and GitHub's `enforce_admins: false` as blockers rather than warnings.

- **`scripts/tracker-sync.mjs` — governed sync with Azure DevOps or Jira.** A spec and a work item
  can both hold a title, a status and a list of criteria; two stores for one truth diverge silently.
  Exactly one system may now write each field — the spec owns the contract, the tracker owns status,
  assignee and sprint — and an attempt to write the other's field is refused rather than winning.

- **`scripts/spec-brief.mjs` — the handoff to whoever implements a spec.** An approved spec is a
  contract, but a scattered one: the criteria are in one section, the constraints in force in
  another file, the gates that will fail the build in a third. The parts most often skipped are the
  ones that cause the rework. This assembles them, and refuses a Draft spec — the contract is still
  being negotiated. It is deliberately **not a prompt**: the same document for a person or an agent,
  because anything an agent needs that a new engineer would not is a sign the spec is
  underspecified, and that fix belongs in the spec.

- **`templates/ci/spec-gate.yml` and `templates/ci/azure-pipelines-spec-gate.yml`** — the merge gate
  for both hosts. Both carry the same adoption note as `knowledge-layer.yml`: run it non-blocking
  for a fortnight first, because a gate that fails on day one gets disabled on day two. The Azure
  one audits its own branch policy on every run, which is the only check that survives someone
  changing that setting.

- **The first tests in this package — 99 of them**, on Node's built-in runner, no dependencies.
  They run offline: the tracker and source-control clients take an injectable transport, so the
  documents they build are asserted without credentials. `npm test` runs them.

### Changed
- **`scripts/lib/specs.mjs` gains `criteria[]`, `repos`, `nfrs`, `approvedBy` and `author`.**
  Additive only — `mcp/sdd-server.mjs` and `spec-dashboard.mjs` both read this shape and are
  unaffected. Acceptance criteria now parse as structured rows, so a script can pair each with its
  test case rather than counting checkboxes.

### Fixed
- **Test files would have shipped in the `@mlmcps/sdd-mcp` tarball.** `files[]` includes
  `scripts/lib/` wholesale, so the new `*.test.mjs` files were being packaged. Excluded via a
  negation pattern; `npm pack --dry-run` now contains none.

### Notes
- The Azure DevOps, Jira and GitHub clients are **contract-tested, not integration-tested**. They
  build what ADO 7.1, Jira Cloud v3 and GitHub 2022-11-28 document, verified offline against a
  recording transport. **None has run against a live organisation.** Every write path has
  `--dry-run`, which prints the exact requests and needs no credentials — which is also the thing
  to hand whoever has to approve an access token.
- The read/write split is enforced at runtime, not by convention: the read-only tracker and SCM
  clients are frozen objects carrying only read methods, so a write path from the planning side is
  absent and cannot be re-attached.

## [0.19.0]

### Changed
- **Both packages are now public on npmjs.org, under MIT.** `npm install @mlmcps/sdd-mcp` and
  `npm install @mlmcps/sdd-toolkit` now work for anyone, with no `.npmrc` scope line and no token.
  Until now they were published to GitHub Packages, which requires authentication *even for public
  packages* and inherited this repository's private access control — so "install the toolkit" meant
  "first get a GitHub PAT with `read:packages`, then map the `@mlmcps` scope in your `.npmrc`". That
  was the friction this change removes.

  The source repository stays private. What is public is the two published tarballs and nothing
  else — which makes each manifest's `files[]` a disclosure boundary rather than a tidiness rule.
  `@mlmcps/sdd-toolkit` carries the marketplace manifest and the plugin directory;
  `@mlmcps/sdd-mcp` carries the MCP server, `scripts/lib/`, and the CI knowledge-check. Neither
  ships `scripts/`, `examples/`, `CONTRIBUTING.md`, `PUBLISHING.md`, `.github/`, or git history, and
  `validate-plugin.mjs` fails the build if the plugin package's `files[]` widens.

  **Existing installs keep working but stop receiving updates.** Anything pinned to the GitHub
  Packages registry resolves to 0.18.0 forever — versions from 0.19.0 on exist only on npmjs. Drop
  the `@mlmcps:registry=` line from your `.npmrc` to pick them up.
- **License changed from `UNLICENSED` to `MIT`** in both manifests, with a `LICENSE` file at the
  repo root. A public package under `UNLICENSED` tells people they may not use what you just handed
  them; MIT is the grant that makes a public publish coherent. This applies from 0.19.0 onward —
  it does not retroactively relicense 0.16.0–0.18.0.
- **`release.yml` publishes to npmjs with an `NPM_TOKEN` secret** instead of the built-in
  `GITHUB_TOKEN`, and fails fast when that secret is missing — before the manifest and CHANGELOG
  gates, so a release can never get half-published. `packages: write` is no longer requested.

## [0.18.0]

This release is about what the toolkit *costs to run*. Nothing changes about the workflow; the same
commands do the same work while reading less, reasoning less about what a script can settle, and
running the expensive parts concurrently.

### Added
- **`sdd-scanner` agent — the learn phase no longer fills the calling session's context.** The
  commands that study a codebase (`/sdd-init`, `/sdd-refresh`, `/sdd-estate`) used to read source
  files inline, so every file sampled to write a doc stayed in the window for the rest of the run —
  while the model was writing docs, not reading code. Those commands now spawn scanners instead, in
  a single message so they run concurrently, and each returns a **capped findings block of
  `file:line` citations and never file contents**. `/sdd-init` fans out three briefs (stack,
  structure, patterns); `/sdd-estate` fans out one per peer repo, so N peers cost roughly one peer's
  wall-clock instead of N.
- **`scripts/spec-gate.mjs` — the mechanical half of a `/ml-specs:spec-advance` gate, checked exactly.**
  Lifecycle ordering, leftover `<placeholder>` text, whether every acceptance criterion is ticked,
  whether **every test file named in the §6 table exists on disk**, and whether the recorded branch
  is merged. That work was being done by a model re-reading the spec and globbing — slow, paid for
  on every run, and the half most likely to be done sloppily, since a named-but-missing test is the
  most common way a status ends up claiming evidence that is not there. It deliberately refuses to
  judge what a script cannot witness (human approval, whether a §8 question is blocking, whether the
  suite ran green) and marks those `MANUAL`, because a `PASS` there would be believed. Pure Node, no
  dependencies, no network calls; exits non-zero on any `FAIL` so it also works as a CI gate.

### Changed
- **`/sdd-refresh` re-learns only what moved.** It now derives the changed surface from
  `git diff --name-only <last-doc-commit>..HEAD` and scopes the scanners to those paths, re-detecting
  the stack only when the manifest itself changed — and stops early, saying so, when nothing has
  changed at all. Re-learning an entire repo to update a few drifted sections was the single most
  wasteful path in the toolkit. It still falls back to a full re-learn when most of the source moved
  or the last-doc commit is unreachable, and says which it did.
- **`CLAUDE.fragment.md` trimmed from 118 lines to 80** (~1,690 → ~1,220 tokens). This file is
  merged into every adopted repo's `CLAUDE.md`, so it is paid for on every session in every repo —
  the one place in the toolkit where prose has a recurring cost. What went: the
  `PLAN/FILES/IMPLEMENTATION/REVIEW/TESTS` block and the nine-rule working agreement, both of which
  the `coder` agent already carries in full and only needs when it actually runs. What stayed,
  verbatim: the no-AI-attribution policy and the knowledge-layer retrieval order, which is the part
  that pays for itself by keeping later reads small.
- **Model routing on the mechanical commands.** `/ml-specs:spec-advance`, `/sdd-impact`, `/sdd-estate` and
  `/sdd-rollout` now run on Sonnet — checking a fixed gate table, classifying a diff against a fixed
  taxonomy, filling a template, and summarizing a script's output are not Opus-shaped work.
  `/ml-specs:spec-review`, `/ml-specs:spec-verify` and both reviewer agents deliberately stay on the inherited model:
  adversarial review is exactly what the larger model is for, and cheapening it would trade the
  toolkit's main guarantee for a small saving.
- **Agent and command descriptions trimmed to what routing actually needs** (~1,390 → ~1,260 tokens
  including the new agent). Descriptions are loaded on every session whether or not the command
  runs, so an enumeration of supported languages or an output format in a `description` is paid for
  continuously and used never.

## [0.17.0]

### Added
- **`@mlmcps/sdd-toolkit` — install the plugin without read access to the marketplace repo.** Until
  now the only marketplace source was `github`, and Claude Code installs that with a `git clone`, so
  anyone who could install could also take a full copy of the repo — history, tooling, everything.
  Read access on GitHub *is* download access; there is no install-only permission, so the fix had to
  be a different artifact rather than a different setting. This package carries the marketplace
  manifest and the plugin directory and nothing else, letting a team be granted the package alone.
  Point `.claude/settings.json` at `{ "source": "npm", "package": "@mlmcps/sdd-toolkit" }` instead of
  the github source. The trade-off is when updates arrive: the git source updates on merge to the
  default branch, this one only when a tag is published.

### Changed
- **One tag now publishes both packages** — `@mlmcps/sdd-mcp` (the MCP server, for non-Claude
  clients) and `@mlmcps/sdd-toolkit` (the plugin) — with the marketplace package published second,
  so a failure there still leaves the MCP server shipped rather than advertising a plugin version
  that never existed.
- `validate-plugin.mjs` gained the fifth version location and a guard that **fails the build if the
  plugin package's `files[]` widens beyond the plugin**. That package exists specifically to
  withhold repo tooling, and a well-meaning `"scripts/"` added later would hand it over with no
  visible symptom — the kind of regression only an explicit check catches.

## [0.16.0]

### Changed
- **Moved to the `MLMCPS` organisation** — the marketplace source is now
  `MLMCPS/ace-claude-plugins`. Existing installs keep working because GitHub redirects the old path,
  but update the `repo` value in your `.claude/settings.json` rather than relying on that redirect
  outliving the move. The point of the move is how access is granted: an org team with read
  permission lets teammates install the toolkit without being able to change it, which per-person
  collaborator invites on a personal account do not scale to.
- **Breaking, npm consumers only: the package is now `@mlmcps/sdd-mcp`.** GitHub Packages requires
  the npm scope to match the owning account, so moving the repo forced the rename — it was not a
  preference. `@venkatmotivity/sdd-mcp` stays published at 0.13.0–0.15.0 and keeps working, but will
  never receive another version: published package versions cannot be renamed or transferred. Anyone
  pinning the old name in `.mcp.json` must change it to keep getting updates, and **0.16.0 is the
  first version to exist under the new scope** — pinning `@mlmcps/sdd-mcp` at anything earlier
  resolves to nothing. Claude Code users are unaffected either way: the MCP server ships inside the
  plugin and was never installed from npm.

## [0.15.0]

### Added
- **`templates/settings.json`** — committed project settings that stop AI attribution reaching
  commits and PRs, by setting `attribution.commit` and `attribution.pr` to empty. 0.14.1 stated that
  rule in `CLAUDE.fragment.md`, but prose is something a model has to read and remember; this is
  enforced by Claude Code itself, so the guarantee no longer depends on an instruction being
  followed. The two work together — `CLAUDE.md` explains why, the setting makes it true.

### Changed
- **`/sdd-init` and `/sdd-adopt` now install that setting** (step 10 and step 9 respectively)
  rather than merely offering it, because it is policy rather than something project-specific like
  hook commands or CI invocations. Both merge only the `attribution` key into
  `.claude/settings.json`, leaving every other key untouched, and both keep an existing
  `attribution` value and report it rather than overwriting a deliberate choice. Because the file is
  committed, it applies to everyone who clones the repo with no per-machine setup — the alternative
  was a per-developer git hook, which secures exactly one laptop and silently misses every teammate,
  every cloud session, and CI.

## [0.14.1]

### Added
- **`TEAM-SETUP.md`** at the marketplace root — the per-repo auto-enable rollout, what to verify
  afterwards, and the private-repo access prerequisite that causes most failed setups. A
  marketplace installs over a plain `git clone`, so a teammate without repo access hits a confusing
  failure rather than a permission error; that prerequisite now has a documented home instead of
  living in the head of whoever set it up first. `README.md` links to it, and the validator checks
  its relative links along with the other docs.

### Changed
- **No AI attribution in commits or PRs.** The `pr-author` agent, `/ml-specs:pr`, `/ml-specs:fix`, `/ml-specs:spec-build`, and
  the `CLAUDE.fragment.md` template now all state that commit messages, trailers, PR titles, and PR
  bodies name the humans who own the change and nothing else — no assistant `Co-Authored-By:` line,
  no "Generated with" line, no model or vendor name, no badge or emoji. The fragment and
  `/ml-specs:spec-build` also spell out why a stray trailer is not a local problem: a squash merge
  aggregates trailers from **every** commit on the branch, so one line added early resurfaces on
  the merge commit long after, attributed to a tool rather than to the people who own the work.
- **Releases no longer cut a GitHub Release** (`release.yml`). Every Release carries
  auto-generated "Source code (zip/tar.gz)" archives that GitHub builds from the tag, with no
  setting to suppress them — so the tag plus the published package is now the release, and
  `CHANGELOG.md` is where per-version notes live. The CHANGELOG gate survives the change (a
  version with no section still fails before anything publishes), and the workflow's `contents`
  permission drops from `write` to `read`, since creating the Release was the only step that
  needed it.

## [0.14.0]

### Added
- **Release automation** (`.github/workflows/release.yml`), fired by pushing a
  `sdd-toolkit-vX.Y.Z` tag. It re-checks the tag against **all three manifests before publishing
  anything** — an npm version can be deprecated but never replaced, so a wrong tag has to fail
  before it ships, not after — then validates, publishes to GitHub Packages, and cuts a GitHub
  Release. It authenticates with the built-in `GITHUB_TOKEN`, so there is no secret to configure
  and the package stays behind the same access control as the private repo.
- `scripts/changelog-section.mjs` — extracts one version's CHANGELOG section for the release body,
  and **exits non-zero when that section is missing or empty**, so a release cannot ship with
  unreadable notes.
- `CONTRIBUTING.md` and `/release` now state plainly that the two halves ship differently: the
  **plugin** releases by merging to the default branch (a marketplace installs from a branch, so no
  tag is involved), while the **npm package** releases on a tag. Conflating the two is the obvious
  way to think you've shipped and haven't.

## [0.13.0]

### Added
- **The MCP server is publishable as a standalone npm package** (`sdd-toolkit/package.json`,
  `@venkatmotivity/sdd-mcp`), so a team can use it without cloning the marketplace repo. The
  package ships only `mcp/`, `scripts/lib/`, and the single CI module the server imports — ~18KB,
  **zero dependencies**, no agents, commands, or templates. `publishConfig` targets GitHub
  Packages, which keeps distribution behind the same access control as the private repo rather
  than requiring a new registry account. Teammates then point `.mcp.json` at
  `npx -y @venkatmotivity/sdd-mcp`, which is safe to commit because it names a package instead of
  a path on someone's laptop. Verified end to end: packed, installed into a clean project, and
  driven over stdio through the published `sdd-mcp` binary.
  - `mcp/README.md` documents the three sharing options with their real costs, including the point
    that **you cannot ship JavaScript and prevent it being read** — `node_modules` is source and a
    compiled executable is unpackable — and that **remote hosting cannot work for this server**,
    since every tool answers questions about the repo the caller is sitting in.
- `--version` / `-v` on the server, printing the version **and the resolved file path** — version
  skew across a team is the predictable failure of distributing this (one stale npx cache, one
  freshly-updated plugin, two different answers), and "which copy am I running?" should be one line
  rather than archaeology. `mcp/README.md` documents how updates actually reach people per
  distribution path, including that plugin users get the server updated *with the plugin* and need
  no npm package at all.
- Validator: the version now has four homes (plugin manifest, marketplace entry, npm package,
  and the version the server reports over the wire) and all four must agree — the last two drift
  invisibly, which this release caught in itself. It also fails the build if the package ever
  declares a dependency or its `bin` target is missing or non-executable.

## [0.12.1]

### Fixed
- **`fix-specs.mjs` would have written statuses their authors never claimed.** Found by running the
  dry run against a real 190-spec repo — which is what dry runs are for. Two compounding mistakes:
  - The lifecycle word was matched by position in the **enum**, not position in the **text**, so a
    Status reading "Phase 1 ✓ + Phase 2a ✓ … branch master verified" resolved to whichever stage
    came first in `[Draft, Approved, Implemented, Verified, Archived]` rather than what the author
    led with. Now matched by where the word actually appears.
  - Even matched correctly, promoting a stage word found *mid-sentence* turns narration into a
    claim. Normalization now requires the word to **lead** the cell ("Implemented (2026-07-07) — …"
    is a declaration; "…branch master verified" is discussion). Anything else is left untouched and
    reported, alongside the existing no-lifecycle-word case, with the reason given per file.
  `resolveStatus()` moved into `scripts/lib/specs.mjs` so the dashboard and MCP server apply the
  same rule, and exposes `leading` / `ambiguous` / `candidates` for callers that want to flag rather
  than resolve.
- **`survey-estate.mjs` reported a parent directory as "not a git repo".** It only expanded a
  directory into the repos beneath it when given exactly one argument — so any extra argument made
  it treat every path as a repo. Each target is now expanded independently. It also detects the
  cause of the extra arguments: zsh does not treat `#` as a comment interactively, so a pasted
  trailing `# comment` arrives as arguments, and the script now says that instead of listing six
  English words as failed repos.

## [0.12.0]

### Added
- **`scripts/spec-dashboard.mjs`** — a self-contained HTML dashboard of every spec, generated
  locally. No CDN, no fonts, no network calls, so it works offline and the spec data never leaves
  the machine — which is the point for a repo that can't be shared. Lifecycle bars,
  acceptance-criteria completion, a severity-ordered needs-attention list, duplicate ids, and a
  searchable table.
  - **In-flight view for parallel work.** Running several specs at once (the three-developers
    pattern) means several worktrees on several branches, and telling them apart was guesswork.
    The dashboard joins each live `git worktree` back to the spec it's building — branch, commits
    ahead, dirty or clean, path — so four concurrent builds are four labelled rows.
  - One chart, deliberately: the lifecycle bars are single-hue with the stage named on the axis and
    the count direct-labeled, because colouring five stages five ways would be decoration. Status
    colours stay reserved for the attention list and always ship with an icon and a word, so meaning
    is never carried by colour alone. Light and dark are both explicitly stepped.
- `scripts/lib/specs.mjs` — spec parsing extracted so the dashboard and the MCP server share one
  implementation of "what a spec says" instead of two that drift. It also resolves a Status cell
  holding prose down to its lifecycle word, and reads header cells to the last pipe rather than the
  first, so prose containing `|` is no longer silently truncated.
- MCP `spec_list` now returns a **summary** (counts by status, AC totals, duplicate ids,
  needs-attention count) alongside the rows, plus a `summaryOnly` argument — so a client can answer
  "what's the state?" on a repo with hundreds of specs without rendering every row.

## [0.11.0]

### Added
- **The MCP server now ships bundled with the plugin** (`sdd-toolkit/.mcp.json`), declared with a
  `${CLAUDE_PLUGIN_ROOT}`-relative path so it resolves wherever the plugin was installed — any
  machine, any checkout. Previously each person had to hand-edit an absolute path into their repo's
  `.mcp.json`, which is fine for the author's laptop and broken for everyone else; that template
  remains as a fallback. The validator now **rejects absolute paths** in the bundled config, since
  that is precisely the bug that makes a git-distributed plugin work only for whoever wrote it.

### Fixed
- **The documented repo did not exist.** Manifests and READMEs pointed at an org that does not host
  this repo, in 7 places — so `/plugin marketplace add <documented path>` 404'd and git-based
  distribution could not have worked at all. Corrected to the real remote, and `PUBLISHING.md` now
  carries a rename recipe that ends in a validator run rather than a hand-written `sed` that had
  itself drifted.

## [0.10.0]

### Added
- **`/ml-specs:fix <bug>`** — bugs had no home. `/ml-specs:spec` is built for features (it asks what the contract
  *should* be), but a defect already has a contract and the code is just violating it, so a
  feature-shaped spec is wasted ceremony. Bugs were therefore falling through to `/ml-specs:code`, which
  applies no discipline at all. `/ml-specs:fix` is the middle path, and its discipline is a single rule:
  **reproduce it with a test that fails, and show the failure, before changing anything.** A fix
  without a test that failed first is a guess, and nothing stops the bug returning. Then: root cause
  stated in one sentence with `file:line` (and an explicit admission when the symptom is suppressed
  rather than understood), the smallest change that turns it green, real verification output, and a
  search for the same defect in sibling code paths. Escalates to `/ml-specs:spec` when the fix would change a
  contract — at that point it isn't a bugfix, it's a change of intent.

### Fixed
- **`/sdd-status` was unusable on a mature repo.** It rendered one table row per spec, which is fine
  at 12 specs and unreadable at 184 — and expensive, since it read every file into context to do it.
  It now summarizes above ~25 specs (counts by status, overall AC completion) and tables **only the
  specs needing a decision**, saying how many rows it withheld and how to see them
  (`/sdd-status all`, or a status to filter). It also prefers the MCP `spec_list` tool when
  available, which parses the specs locally instead of loading them all. New checks in the
  needs-attention list: a Status holding free-text prose rather than a lifecycle word, and duplicate
  spec numbers — both pointing at `scripts/fix-specs.mjs` rather than proposing to fix them one at
  a time.

## [0.9.0]

### Added
- **`/sdd-rollout`** — onboarding an estate, which is the bottleneck everything else waits on:
  `/sdd-impact` and the MCP `estate_lookup` both correctly refuse to answer until the peer repos
  have knowledge layers, so a toolkit installed in one service out of seventeen is mostly inert.
  The command exists to **aim the expensive part** rather than spray it. `/sdd-init` is the costliest
  operation here, and running it unattended across an estate buys both a large bill and a pile of
  knowledge layers nobody reviewed — the exact failure this toolkit exists to prevent. So:
  - Survey first, mechanically and free (below), then order repos by **cross-service surface** rather
    than alphabetically — onboarding a hub unlocks `/sdd-impact` for its peers, a leaf unlocks nothing.
  - **The first repo is an explicit calibration run**: onboard exactly one, stop, have a human read
    the generated docs. Something is almost always systematically off, and fixing it before repo two
    is the difference between 17 good knowledge layers and 17 copies of one mistake.
  - Routes each repo to `/sdd-init` or `/sdd-adopt` from the survey, never `/sdd-init` over existing
    docs. Leaves everything uncommitted. Ends with `/sdd-estate`, which is the actual payoff.
  - Resumable with no ledger: the survey re-derives each repo's state from disk, so onboarded repos
    show as `refresh` and fall out of the queue.
- **`scripts/survey-estate.mjs`** — the cheap half, split out so it needs no model: per repo, the
  stack from its manifest, knowledge-layer state, spec count, 90-day commit activity, uncommitted
  changes, and cross-service edge signals (event listeners, HTTP clients, contract files), ending in
  an init / adopt / refresh / review recommendation. Detects other tools' agent instructions
  (`AGENTS.md`, `.cursorrules`, Copilot) and routes those repos to `/sdd-adopt`, since `/sdd-init`
  would clobber them. Bounded file walk so a survey stays cheap on a monorepo, and it says when the
  cap truncated its counts rather than reporting a floor as a total. Read-only, no dependencies,
  no network calls.

## [0.8.0]

### Added
- **`scripts/fix-specs.mjs`** — repairs the two spec-hygiene problems that accumulate in a repo
  that adopted `specs/` before the newer commands existed. 0.6.0 stopped `/ml-specs:spec` from *creating*
  duplicate numbers but did nothing about ones already on disk, and the evidence-gated `Status`
  from 0.4.0 assumes a one-word value that older specs don't have.
  - **Duplicate numbers** — keeps the earliest-added file on the number and renumbers the rest to
    the next free id across **all** branches, `git mv` so history follows, rewriting exact filename
    references in `specs/`, `docs/`, and the root READMEs. Only exact filenames are rewritten;
    prose like "see spec 0043" is reported, not guessed at. Sub-spec suffixes (`0165b`, `0171c`)
    are distinct ids, not collisions.
  - **Prose in `Status`** — moves the lifecycle word into `Status` and preserves the original text
    **verbatim** as a `> **Status note:**` under the header table. That text is usually real
    information sitting in the wrong field, so it is relocated, never deleted. A status with no
    recognisable lifecycle word is left alone and reported for a human.
  - Dry run by default, `--apply` to write, `--force` to override the guard that refuses to apply
    over a dirty `specs/`/`docs/` (so the script's diff stays reviewable on its own). Idempotent.
    Pure Node, no dependencies, **no network calls** — it runs entirely on the user's machine, which
    matters when the repo it repairs can't be shared.
- `/sdd-doctor` now points at the script when it finds either problem, rather than proposing to fix
  them one file at a time.

## [0.7.0]

### Added
- **MCP server** (`mcp/sdd-server.mjs`) — the deterministic half of the toolkit, exposed to any MCP
  client (Cursor, a custom agent, CI), read-only and dependency-free.
  - `estate_lookup` — who produces/consumes a contract, from `docs/ESTATE.md`, with each row marked
    confirmed or unverified. Returns `present: false` with an explicit note when there's no index:
    "no index" is not "no consumers", and a false all-clear on a cross-service change is worse than
    no answer because it gets believed.
  - `knowledge_check` — the CI gate's checks as structured data. **Imports** the implementation from
    `templates/ci/knowledge-check.mjs` rather than copying it, so the two can't drift; that file is
    now a module with a CLI guard, and importing it is silent (a stray `console.log` would corrupt
    the JSON-RPC stream).
  - `spec_list`, `spec_next_number` — specs as structured data, with the across-all-branches
    numbering from 0.6.0, reporting explicitly when it couldn't fetch instead of assuming.
  - Templates served as `sdd://templates/…` resources, with path traversal rejected.
  No dependencies: stdio MCP is newline-delimited JSON-RPC 2.0, implemented directly, by the same
  convention that keeps `validate-plugin.mjs` dependency-free. `templates/mcp/.mcp.json` wires it
  into a repo; `/sdd-init` offers it rather than installing it, since it needs an absolute path.
  **The agents, skills, and hooks deliberately do NOT port** — MCP can't spawn a subagent with its
  own tool allowlist and model, and can't register a hook. Those stay in the plugin; the two compose.
- Validator: the server's advertised `serverInfo.version` must match `plugin.json` (nothing else
  keeps them in step, and the drift is visible only to clients), and its relative imports must
  resolve. `templates/mcp/.mcp.json` must parse and declare `mcpServers`.

### Fixed
- **`estate_lookup` parsed every event table with the wrong columns.** Section detection tested
  `includes('synchronous')` before `includes('asynchronous')` — and "asynchronous" contains
  "synchronous", so async rows were classified `sync` and their fields shifted by one, reporting an
  event name as the calling service. Caught by fixture testing before release.
- `spec_next_number` reported `remoteChecked: false` identically for "no remote configured" and
  "fetch failed" — the second is a real collision risk and now says so.

## [0.6.0]

### Added
- **Knowledge-layer CI gate** (`templates/ci/knowledge-check.mjs` + `knowledge-layer.yml`, seeded by
  `/sdd-init`). 0.5.0's `SessionStart` hook made drift *visible*; this makes it *enforced*, because
  advisory is exactly what got the docs to zero maintenance in the first place. It's the mechanical
  half of `/sdd-doctor` — the checks needing no judgment, so CI can run them on every PR: every
  `file:line` in the knowledge layer still resolves and the file is still that long, relative doc
  links resolve, every shard is reachable from the router, docs are within budget. Plus an advisory
  when a PR changes source and touches no doc. Pure Node, no dependencies. `--warn-only` exists for
  adoption on a repo with existing drift: a gate that fails on day one gets disabled on day two.
  `/sdd-doctor` now runs the script when present instead of eyeballing references.
- **`/sdd-impact [spec-file]`** — who breaks if this ships? Detects changes to *observable*
  contracts (event payloads, API request/response shapes, shared tables, exported types), resolves
  consumers from `docs/ESTATE.md`, classifies each as additive / compatible-with-sequence /
  breaking, and produces a deploy order that's safe at every intermediate step. Nothing else in the
  loop looks outside this repo — tests, `/code-review`, and `/ml-specs:spec-verify` all pass cleanly on a
  change that breaks a consumer. If the estate index is missing or mostly `_TBD_`, it **refuses to
  answer** rather than reporting "no consumers affected": that false all-clear is worse than no
  answer, because it gets believed. Wired into `/ml-specs:spec-verify` for contract-touching changes.
- **`/sdd-adopt`** — `/sdd-init` assumes a blank slate, which is wrong for most repos that already
  have a hand-written `CLAUDE.md`, `docs/`, or an RFC/ADR practice, and clobbering documentation a
  team wrote is the fastest way to make them distrust the tool. This classifies every existing
  section as keep-verbatim / merge / missing, keeps their structure and file names, maps the spec
  loop onto their existing process instead of replacing it, and reports where their docs and the
  code disagree **without changing anything** — a stale claim a human wrote is theirs to retire.
  `/sdd-init` now detects an existing knowledge layer and redirects here.

### Fixed
- **Spec numbers collided across branches.** `/ml-specs:spec` picked the next number from the working tree,
  so two people speccing in parallel both got `0007-` and found out at merge — as a conflict in a
  *filename*, which git resolves badly. It now takes the max across every branch
  (`git log --all --diff-filter=A -- 'specs/[0-9]*'`) unioned with `specs/` and `specs/archive/`,
  fetching first where there's a remote, and says so explicitly when it can't fetch rather than
  numbering off a stale view. Documented in `specs/README.md`, including how to resolve a collision
  that does land.

## [0.5.0]

### Added
- **Hooks that ship with the plugin and activate on install** (`hooks/hooks.json`). Usage data
  showed `/sdd-refresh`, `/sdd-doctor`, and `/sdd-status` at effectively zero — the knowledge layer
  was generated once by `/sdd-init` and then never re-checked, which quietly undoes the toolkit's
  main claim. A command nobody remembers to type loses to automation:
  - `knowledge-drift.sh` (`SessionStart`) — one line when `CLAUDE.md`/`docs/` are more than
    `SDD_DRIFT_THRESHOLD` (default 30) *source* commits behind the code; doc-only commits don't
    count, so refreshing the docs doesn't itself look like drift. Silent otherwise, and exits 0 on
    anything unexpected — a session-start hook must never be why a session starts badly.
  - `secret-scan.sh` (`PreToolUse` on Bash) — the old copy-paste example, hardened into a real
    script: added lines only (removing a leaked key isn't blocked), an allowlist at
    `.claude/secret-allowlist.txt`, and JWTs added to the pattern set. The only hook allowed to
    block, because a committed key is unbounded damage and a false positive costs one line.
  Project-specific automation (format/lint/test) still can't ship — the plugin can't know your
  commands — so `templates/hooks/settings.hooks.example.json` now holds only those, and points at
  what the plugin already runs for you.
- **`skills/knowledge-retrieval`** — the deep retrieval procedure (sharded-doc navigation, the 1-hop
  dependency closure, designing across a service boundary: both sides of the contract, deploy order,
  compatibility) moved out of the always-loaded `CLAUDE.md` fragment into a skill that loads only
  when a task actually hits one of those. The always-needed ladder stayed in `CLAUDE.md` on purpose —
  a rule you must know *before* you know you need it can't live on-demand.
- **`/release`** in `.claude/commands/` (the marketplace repo, not the plugin — it publishes plugins,
  so it must not ship to the repos that install them). Reads the real diff since the last release,
  proposes the semver level, writes the CHANGELOG entry in house style, bumps the version in both
  manifests that CI requires to match, and validates. Stops before committing.

### Changed
- **`/ml-specs:spec-build` now actually spawns `sdd-developer`.** It ran at 26% of skill usage while the
  agent ran at ~1% — the command was reimplementing the agent's job inline, so the agent's
  guarantees (test per criterion, functional/E2E for user-facing ones, real results only) silently
  didn't apply, and the parallel three-worktree pattern in `specs/AGENTS.md` couldn't happen at all.
  Blocking questions are resolved in the command *before* handing off, since a subagent has no
  channel to the human.
- **The validator now catches dead wiring** — the check that would have made 0.4.0's two orphaned
  agents impossible. A *mention* no longer counts as an invocation: it matches the idiom
  `Use the **agent-name** agent`, because describing an agent in backticks is exactly how
  `sdd-reviewer` and `pr-author` looked wired while nothing ran them. An agent with no command must
  declare why with an `<!-- invoked-by: … -->` comment (`sdd-spec-author` does — `/ml-specs:spec` must ask the
  human its contract questions, which a subagent can't). Also added: `${CLAUDE_PLUGIN_ROOT}/…` paths
  resolve, `hooks.json` scripts exist **and are executable** (a non-executable hook fails silently),
  `skills/<name>/SKILL.md` frontmatter matches its directory, and relative README links resolve.

## [0.4.0]

### Added
- **`/ml-specs:spec-verify <spec-file>` — the VERIFY phase finally has an entry point.** The `sdd-reviewer`
  agent had shipped since 0.1.0 with *nothing* invoking it: `/ml-specs:spec-build` sent users to the built-in
  `/code-review` instead, which reviews the diff for bugs and never opens the spec. The gate the
  toolkit advertised — "test per criterion + adversarial review" — was reachable only if the model
  happened to route to the agent on its own. `/ml-specs:spec-verify` delegates to it, relays the
  per-criterion verdict and the real final-acceptance output unsoftened, and splits must-fixes into
  *code is wrong* (fix and re-run) vs *spec is wrong* (a contract change → back through
  AskUserQuestion, never a quiet widening of the spec to match what was built). Both reviews are now
  prescribed, with a table saying which question each one answers.
- **`/ml-specs:pr <spec-file>`** — same orphan problem: `pr-author` existed with no command. Defaults to the
  spec matching the current branch, flags a not-yet-`Verified` spec up front, produces text only,
  and opens the PR only on an explicit ask (via `--body-file`, never a retyped body).
- **`/ml-specs:spec-advance <spec-file> [status]` — spec status becomes evidence-backed.** Status was written
  ad hoc by whichever agent felt done, so `Verified` meant "an agent said so". It is now written
  *only* here, and each transition must show its evidence: `Approved` needs the human's approval in
  conversation and no blocking question parked in §8; `Implemented` needs every test named in the §6
  table to **exist on disk** (a named-but-missing test being the usual lie); `Verified` needs a clean
  `/ml-specs:spec-verify` *and* a green §6.1 suite, never an assertion; `Archived` needs the branch merged,
  then `git mv`s the spec to `specs/archive/` keeping its number. Missing evidence means the
  transition is **refused**, which is a successful run. Backwards moves are allowed but must add a
  Revisions row. The command also records the spec's **Branch**, so `/sdd-status` reads it instead of
  guessing from `git branch --all`.
- **`/sdd-estate`** — `docs/ESTATE.md` had a template but no generator, so the estate index (the
  thing that makes this a multi-service toolkit rather than a per-repo one) was hand-maintained.
  The command scans the peer repos read-only, indexes the real edges — HTTP/RPC clients, event
  producers/consumers, shared tables/packages — with `file:line` on **both** sides, marks unconfirmed
  peer-side rows `(inferred)`, merges rather than overwrites, and reports the edges it could not
  resolve as the headline output (an unresolved edge is where a cross-service change breaks).

### Changed
- `templates/docs/ESTATE.md` → **`ESTATE.template.md`** (matching `PATTERNS.template.md` /
  `ARCHITECTURE.template.md`) and genericized. It shipped pre-filled with one estate's real services
  and queues, which `/sdd-init` would then copy verbatim into unrelated repos. Now placeholders,
  plus an evidence column and an optional shared-data table.
- Spec template: `Branch` row and the `Archived` status; a note that Status is written by
  `/ml-specs:spec-advance`, not by hand.
- `specs/README.md` gained a **Lifecycle** table (status → meaning → gate), and the loop's VERIFY
  step now names `/ml-specs:spec-verify` and `/ml-specs:pr`. `specs/AGENTS.md` maps each agent to the command that
  runs it — the mapping whose absence hid the two orphans.
- `/ml-specs:spec-build` now hands off through `/ml-specs:spec-advance Implemented` → `/ml-specs:spec-verify` → `/code-review`
  → `/ml-specs:spec-advance Verified` → `/ml-specs:pr` instead of ending at "recommend `/code-review`". `/ml-specs:spec` and
  `/ml-specs:spec-review` no longer touch Status (an author doesn't approve their own spec).
- `/sdd-status` reads the spec's `Branch` row (marking fallback guesses with `?`), collapses
  `specs/archive/` to a count, and flags merged-but-unarchived specs. `/sdd-doctor` now flags
  `Verified` specs whose named tests don't exist and blocking questions parked in §8.
- `/sdd-init` and `/sdd-refresh` delegate `docs/ESTATE.md` to `/sdd-estate` rather than copying or
  hand-editing it.

## [0.3.0]

### Added
- **One-pass spec review.** Human review of a spec was looping: read → find holes → answer →
  re-read. Three causes, all fixed:
  - `/ml-specs:spec` and `sdd-spec-author` gave **opposite instructions** on the same trigger — the command
    said ask the user before writing; the agent said park the questions in the document. The agent
    won whenever the model routed to it, so blocking contract decisions reached the human as
    homework. Both now resolve blocking ambiguity *before* the spec is written, with one definition
    of blocking (the answer changes an API shape, data model, error code, scope boundary, or
    compatibility — i.e. you'd rewrite a section knowing it). `/ml-specs:spec` asks the batch directly via
    AskUserQuestion, each question carrying concrete options and a recommendation; `sdd-spec-author`
    is a subagent with no user channel, so it stops and returns the questions to its caller instead.
    Section 8 is now non-blocking follow-ups **only**, and the template says so.
  - **`/ml-specs:spec` never routed through `/ml-specs:spec-review`** — it sent the user straight from draft to
    approve to `/ml-specs:spec-build`, making the human the first reviewer. `/ml-specs:spec` now runs the adversarial
    pass over its own draft and fixes what it finds before the human sees anything.
  - **Revisions had no bounded surface** — a sent-back spec cost a full re-read. `TEMPLATE.md` now
    carries a `Revisions` table (what changed, why, which sections) so round two is a diff read.
- `sdd-spec-reviewer` agent — the adversarial spec pass as a reusable unit with **fresh context**
  (a spec's author cannot see its own holes). `/ml-specs:spec-review` is now a thin delegator to it, and
  `/ml-specs:spec` spawns it automatically. Also flags blocking questions parked in section 8 as blockers.
- **Per-component model tiering (quality-first).** Everything that affects code quality stays on
  the inherited (Opus) model: the code-writing agents (`coder`, `sdd-developer`, `/ml-specs:spec-build`),
  the spec author (`sdd-spec-author`, `/ml-specs:spec`), and both quality gates (`sdd-reviewer`,
  `/ml-specs:spec-review`). Only work with **no** bearing on code correctness runs cheaper via frontmatter:
  `pr-author` (PR prose) → **sonnet**; `/sdd-doctor`, `/sdd-status` (mechanical read-only
  dashboards) → **haiku**. `spec-build`/`sdd-developer` run only the targeted tests during
  implementation and the full functional/E2E suite **once** at the final-acceptance step (cheaper,
  no quality loss — the full gate still runs). The validator checks `model` frontmatter values.
- **Functional/E2E tests + final-acceptance gate.** The spec template now has a functional/E2E
  test type and a `## 6.1 Final acceptance` section, and a `Verified` status. Every user-facing /
  contract-level acceptance criterion needs a functional/E2E test (not just a unit test), and a
  spec is only `Verified` once the project's *full* suite (incl. functional/E2E) passes end to
  end. Threaded through `/ml-specs:spec-build`, the `sdd-developer` and `sdd-reviewer` agents,
  `specs/README.md`, the CLAUDE.md fragment, and `docs/PATTERNS.md`.
- `/ml-specs:spec-review <spec-file>` — adversarial review of a spec **before** any code: checks contracts,
  acceptance criteria, and cross-module ripple are complete and testable.
- `/sdd-doctor` — read-only health check of the knowledge layer (broken `file:line` refs, stale
  commands, over-budget docs, `(inferred)` markers, spec hygiene); recommends `/sdd-refresh`.
- `/sdd-status` — dashboard of every spec: lifecycle status, acceptance-criteria progress, and the
  matching git branch.
- `pr-author` agent — turns a completed spec + its diff into a PR title and body with the
  acceptance criteria as a review checklist (read-only; does not open the PR).
- **CI:** `.github/workflows/validate.yml` + `scripts/validate-plugin.mjs` (no-dependency) validate
  manifests, agent/command frontmatter, agent-name/filename match, and **version sync** between
  `plugin.json` and the `ace-tools` marketplace entry.
- `CONTRIBUTING.md` — agent/command authoring conventions and the release checklist.
- `examples/promo-service/` — a worked example of what `/sdd-init` produces (filled-in `CLAUDE.md`,
  `docs/PATTERNS.md`, and a completed spec).

### Changed
- Set the real git org across the manifests and READMEs (was a placeholder).
  <!-- Corrected in 0.11.0: this pointed at an org that did not host the repo. -->

- Hardened the optional PreToolUse hook example into a working staged-diff secret scan (AWS keys,
  private keys, Slack/GitHub tokens, generic `key=…` assignments) that blocks the commit.

## [0.2.1]

### Changed
- **Leaner agents / DRY:** collapsed the duplicated stack-detection prose (was repeated across all
  4 agents + 3 commands) into one short "detect from the manifest, mirror the code, read the docs"
  procedure. `coder.md` dropped ~45 lines; per-stack/DB specifics now live only in the generated
  `docs/PATTERNS.md` (where project detail belongs), not in always-loaded agent prompts.
- Added a confidence convention to `PATTERNS.template.md` — mark `(inferred)` patterns so the agent
  re-checks them against code; never invent a convention to fill a section.
- Clarified `/ml-specs:code` vs `/ml-specs:spec` boundary and noted `/code-review`/`/security-review` are built-in.

### Fixed
- Duplicate step number in `/sdd-init`; a Spring-specific `Feign` reference in the stack-neutral
  knowledge layer.

## [0.2.0]

### Added
- `/ml-specs:code <task>` — one-shot coding command via the `coder` agent.
- `/sdd-refresh` — re-learn the project and update the knowledge files after the code drifts.
- `docs/PATTERNS.md` — learned "house style" memory, generated by `/sdd-init` and read by all agents.
- Optional `templates/hooks/settings.hooks.example.json` — opt-in post-edit/lint/test/secret hooks.
- Git & PR workflow section in the shared CLAUDE.md fragment.

### Changed
- Agents and commands are now **stack-aware for any language** (Java, React, Node/Express/NestJS,
  Python, Go, Ruby, .NET, …) and any database (MySQL, PostgreSQL, MongoDB, …) — detect the
  manifest/commands and mirror the project's conventions instead of assuming Spring Boot.
- `/sdd-init` is now **learn-first**: it studies the codebase and generates `CLAUDE.md`,
  `docs/PATTERNS.md`, and `docs/ARCHITECTURE.md` from real `file:line` evidence.
- Spec template, architecture template, and knowledge layer made stack-neutral.
- Marketplace plugin `source` switched to the relative path `./sdd-toolkit`.
- **Token/memory optimization:** tiered knowledge layer (CLAUDE.md = thin index that links, not
  inlines; PATTERNS/ARCHITECTURE loaded on demand, ~200-line budgets each), `file:line` references
  over pasted code, read file ranges not whole files, and `/sdd-refresh` now prunes/trims to budget.
- **Large-app mode:** sharded knowledge layer — `docs/ARCHITECTURE.md` becomes a router linking to
  per-module `docs/architecture/<module>.md` (and `docs/patterns/<module>.md`) shards loaded on
  demand, so each task's context is the router + only the relevant shard. `/sdd-init` generates and
  `/sdd-refresh` updates shards per-module.
- **Interlinked modules (edges, not just nodes):** each shard carries a `Depends on / Used by`
  header, the router holds a module **contract index** (shared events/APIs/types/tables →
  producers/consumers), and the agent loads the bounded **1-hop dependency closure** (target shard +
  neighbors' contract sections). Optional always-loaded `docs/architecture/_core.md` for heavily
  shared contracts; tightly-coupled specs are sequenced, not parallelized.

## [0.1.0]
- Initial release: `coder` + `sdd-spec-author`/`sdd-developer`/`sdd-reviewer` agents,
  `/ml-specs:spec`, `/ml-specs:spec-build`, `/sdd-init`, and the spec/docs templates (publisher-service focused).
