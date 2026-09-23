# Changelog

All notable changes to Dokima are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Dokima's premise is that agent sessions are untrusted and every durable state
change goes through verbs and hash-chained receipts. Entries below therefore
name what a change means for that boundary, not just what moved.

## [Unreleased]

### Changed

- **`dokima close` measures its evidence instead of recording the caller's.**
  It runs the verify command itself (sandboxed, the ticket's own `verify` when
  it declares one), checks every `--files` path exists in the project, and
  resolves every `--commits` SHA in the project's git repo; any failure refuses
  the close. Without a git repo the commits are recorded on the receipt as
  caller-asserted, never as verified.
- **The HTTP close verb measures the same way.** `POST
/api/v1/tickets/:id/close` runs the verify, stats the files and resolves the
  commits in the registered project, exactly as `dokima close` does; a
  `verify.exitCode` in the request body is ignored, and the receipt carries the
  same evidence block.
- **`DOKIMA_ALLOW_UNSANDBOXED_VERIFY` now does what it says, everywhere.** On a
  host with no process sandbox it was honoured at a build run's preflight and
  nowhere after it — every verify then failed with "sandbox unavailable" — and
  `dokima close` refused outright. With the waiver set, build runs and both
  close doors now run verify with network allowed and the environment still
  cleaned; without it, they still refuse. Close receipts record which it was
  (`evidence.sandbox`: `isolated` or `waived`). A host that can sandbox is
  unaffected.
- **`dokima doctor` opens a real database.** A new `native-db` check loads
  better-sqlite3 and opens (then removes) a throwaway database, so an install
  made with `ignore-scripts=true` — no native binary — now fails by name with
  the fix, instead of reporting `doctor: OK`.
- **The machine review's SAST check runs Opengrep over a pinned local
  ruleset.** `tool-sast` used `semgrep --config auto --metrics=off`, which
  current semgrep refuses, so it errored on every review and no ticket could be
  accepted without a person. It now runs `opengrep` (no metrics, no version
  check, no network) over the rule packs found at `DOKIMA_SAST_RULES` or
  `~/.dokima/rules/sast`, and never registry rules. The ruleset is pinned by a
  content digest recorded with each verdict. With no ruleset or no `opengrep`,
  the check reports NOT RUN, which still blocks automatic acceptance and is
  never counted as a pass; `dokima doctor` has a new `sast` check that says
  which one is missing and how to fix it.
- **Findings that were already at the ticket's base no longer count against
  it.** When a security check reports findings, the same scanner runs over the
  ticket's base commit, and only findings the change added are counted. The
  pre-existing count is still reported. If the base can't be scanned, every
  finding stands.
- **The machine review covers the whole ticket.** It used to diff only the
  ticket's last commit (`HEAD^..HEAD`), so a reviewer never saw the earlier
  commits and the security baseline counted them as pre-existing. The review,
  the baseline and the freshness check before acceptance now all use the commit
  the ticket forked from. When that commit can't be found, no baseline runs.
- **The reviewer is told that a scanner which did not run is missing
  coverage.** It is neither a clean result nor evidence against the change.
- **Free infrastructure retries wait before re-running**: 5 s, then 15 s, then
  45 s, capped at 60 s. When the provider says a model is loading or was
  unloaded, the waits start at 15 s. Previously all three retries could land
  inside one model reload. The number of retries is unchanged.
- **A refused reviewer reply is recorded, and parsed more tolerantly.** Each
  `review.bounced` event now carries the reply (bounded and redacted) and the
  reason it was refused. A `<think>` block before the JSON, a lower-case
  verdict, and a numeric-string score are now accepted. A refused reply still
  never counts as an approval.

### Removed

- **Breaking CLI change: `dokima close --verify-exit` is gone.** The exit code
  is measured, never supplied, so the flag is now a usage error that says what
  to do instead: drop `--verify-exit` and keep passing `--verify-cmd <command>`
  — close runs it and records what it returns, and when the ticket declares
  its own `verify`, that runs in its place. No 1.x release carrying the flag
  was ever published to npm (`npm view @bpmforge/dokima` is a 404; v1.0.0 is a
  git tag only), so no installed CLI is affected; a script written against the
  source checkout must drop the flag.

### Fixed

- A pipeline run's progress record and the fleet registry are written
  atomically, so a status poll can no longer catch either mid-write and report
  a live run as missing (404) or the registry as corrupt.
- Autonomous sessions can report their own commits: the agent's `commit` tool
  returns the new commit's `sha`, and the handoff says so (in a linked worktree
  the agent cannot read `.git`, and was being asked to).
- A session killed by a provider/request timeout after finishing its work is
  now derived and landed through the ordinary close gate instead of retried;
  an endpoint failure over unfinished work still retries for free.

## [1.0.1] — 2026-09-23

A packaging fix release that also closes one gate bypass. v1.0.0's tarball
could not start, so the guard the boundary relies on — "the CLI refuses an
unsupported Node before anything native loads" — never ran for an installed
user: the module that implements it was not in the package. And on Node 24,
newly supported here, the close gate's empty-run check was blind (below): a
verify command that executed zero tests would have been recorded as a pass.
Both are closed; no verb, receipt or event shape changed.

### Fixed

- **The published tarball could not start.** `files` listed the `bin` entry
  (`apps/server/src/bootstrap/cli-entry.mjs`) but not the two modules it
  imports: `node-abi-guard.mjs` (static — every command died with
  `ERR_MODULE_NOT_FOUND`) and `bundle-age.mjs` (dynamic, swallowed by a catch,
  so the stale-bundle notice silently never printed). Both now ship; test files
  beside them do not.
- **On Node 24, a verify command that ran zero tests passed the gate.**
  `node --test` on Node 24 prints its summary with the spec reporter even when
  piped (`ℹ tests 0`), and the empty-run detector only recognised TAP's
  `# tests 0` — so an acceptance criterion whose glob matched nothing exited
  zero and was recorded as green. Both shapes are now refused.
- A better-sqlite3 binary built under the other supported Node (installed on
  22, run on 24 — the npx cache and a project's `node_modules` are shared
  across Node versions) printed the raw `NODE_MODULE_VERSION` trace on the
  first command that opened a database. The CLI entry now loads the module
  before the bundle and names the fix — rebuild, not "switch back to 22".
  Other load failures are left to the command that needs the module, so
  `--help` still works on an install without the native binary.

### Added

- **Node 24 support.** `engines.node` is `22.x || 24.x`; the version guard
  accepts every line the range names and still refuses the rest. CI runs lint,
  typecheck and the full suite on both.
- **Pack → install smoke gate** (`pnpm smoke:pack`, CI job `pack-smoke` on
  Node 22 and 24): builds, runs `npm pack`, installs the tarball into an empty
  directory, then runs the installed `dokima --help`, `dokima doctor`, and an
  explicit better-sqlite3 load (`doctor` on a fresh home never opens a
  database). An offline check in `pnpm test` walks every relative import of the
  `bin` entry — static and dynamic, transitively — and fails when `files` does
  not cover one; the smoke alone could not see the swallowed dynamic import.
- `pretest` loads the native module before the suite runs, so a checkout
  installed under one supported Node and tested under the other is refused by
  name instead of failing ~50 tests with a raw ABI error.
- The W8 dogfood receipts (`docs/dogfood/` report and JSON) ship in the
  package, as VISION's dogfood gate says they do.

### Known gaps

- An npm client configured with `ignore-scripts=true` installs without the
  better-sqlite3 native binary, and `doctor` still reports OK on a fresh
  home. Documented in the release handoff; not changed here.

## [1.0.0] — 2026-09-03

The first public release. Every milestone gate in `docs/RELEASE_TRACKER.md`
(v0.1 foundation through v1.0 dogfood) was met before this tag; the
pre-public checklist — license, README, history-secrets scan, naming
clearance, package verification on a clean machine — is complete.

### The trust boundary

- Agent sessions are untrusted by construction. Every durable state change
  goes through a verb that mints a hash-chained receipt; a session cannot
  flip a ticket, approve its own work, or talk a gate into passing.
- Maker ≠ verifier is mechanical: reviewer identities, models and tokens are
  distinct from maker ones, and the machine review refuses honestly when the
  only available reviewer is a model that made work in the same run.
- The close gate re-runs a ticket's verify command itself and never trusts
  the manifest's claimed exit code; the machine review re-runs the manifest's
  own verify command independently before a verdict is recorded.
- Verify commands and validator packs run inside a process sandbox
  (`sandbox-exec` on macOS, user namespaces on Linux) and the build refuses,
  rather than degrades silently, on a host that cannot sandbox.
- The bundled expert library (89 agents, 83 validators, 26 protocols) ships
  signed; the signing key was rotated and purged from history before this
  release, and history scanning is part of the gate so a committed-then-deleted
  credential can never again read as clean.

### What ships

- A local-first workbench: Fleet, a three-pane project Canvas (Chat, Board,
  Artifacts), the Morning queue (Decide, Review, Record) and improvement plans
  whose accepted proposals mint tickets.
- The guided pipeline from idea to board: setup wizard, interview, blueprint,
  founder decisions, decomposition into a ticket board with lanes and write
  scopes — resumable after a pause, rejoinable after navigating away.
- Harbormaster, the unattended build loop: claims tickets one per lane,
  runs Dokima's own tool-using agent sessions through the gateway, enforces
  tool-iteration and token budgets, parks on provider limits and resumes,
  lands per ticket or per feature, and hands a person an honest park note
  when a ticket cannot close.
- Model policy is the user's choice, asked once at setup and never defaulted:
  local-only (a guaranteed configuration — nothing contacts a network), one
  pinned model, cheapest-first escalation, or approval-gated escalation.
  Providers: LM Studio/Ollama and any OpenAI-compatible endpoint, OpenAI,
  Anthropic, Google Vertex, GitHub Copilot device flow. Credentials live in the
  OS keychain (or an encrypted file vault on headless hosts) as references.
- `dokima` CLI: `doctor`, `backup`/`restore`, `packs update`,
  `providers refresh`, `service install|status|stop`, and the board verbs
  (`claim`, `start`, `close`, `accept`, `reject`, `comment`, `widen-scope`,
  `add-ticket`, `depends-on`, `retarget-acceptance`).

### License

- Dokima's own source is under the Functional Source License 1.1 with an
  Apache-2.0 future license (D-022). The bundled `content/` library remains
  Apache-2.0 with notices preserved.

### Known gaps

- The bundled expert library is ~133 upstream commits behind. The import is
  one-time by design (D-008, no umbilical); the importer is fixed, the
  re-import has not run.
- Two features are deliberately held for a founder decision and do not ship:
  the plugin loader (W12-44) and the autonomy dial (W13-32).
- Local models routinely finish a ticket's work and then fail to emit the
  Completion Manifest, burning the remaining iterations; the ticket is real
  and its evidence is real, but a person has to run `dokima close` to record
  it (P6-19). The gate is doing its job here — nothing mints a receipt from an
  unverified claim — but the exit is manual more often than it should be.
- A file written with literal `\n` sequences instead of newlines has twice
  been accepted at the write-tool boundary (P6-20).

## [0.1.0] — 2026-08-03

Tagged 2026-08-03 and never published. Every milestone gate through the v1.0
dogfood criterion was met; the version was deliberately conservative while the
name cleared trademark review. The 1.0.0 entry above is the first release to
reach a registry — this section is kept for the history it records.

> The `v0.1.0` tag was re-pointed once before release, after verification of the
> packaged artifact found that the shipped validator pack could not run at all
> (see _Fixed_ below). Nothing had been published or released against the
> earlier tag. Recorded here rather than quietly retagged.

### Added

- **Trust core.** Append-only, hash-chained event log; receipts minted with a
  keyed MAC over the row's content; `verifyReceipt` recomputes and requires a
  match. Completion is receipt-existence, never string-matching on agent output.
- **Maker ≠ verifier, mechanically.** Reviewer identities, models and tokens are
  distinct by construction; a ticket owner cannot accept its own work.
- **Local-first by default.** The full pipeline runs against a local model with
  no network. CI never calls a real model provider or forge host — every LLM
  call is faked at the gateway boundary, every forge call at the adapter
  boundary.
- **Canvas** (React/Vite): fleet, board, plans, trace, decisions, lessons,
  notifications, and a twelve-tab settings surface including provider registry
  and role×task-type model matrix.
- **Harbormaster close gate** running real validators out-of-session, with a
  planted-defect suite proving each gate fails when attacked.
- **Packaged CLI** — `dokima` boots the core and opens the Canvas, plus
  `doctor`, `backup`, `packs update`, `providers refresh`, and `service`.

### Security

- Content packs are signed; the loader is deny-by-default on unverified content.
- Secrets are never stored in settings files, prompts, or the event log —
  credential references only, resolved from the OS keychain at call time.
- **History secrets scanning** joined the release gate. The working-tree scanner
  passes `--exclude-dir=.git` and so could never see a credential that was
  committed and later deleted — which is how a signing key survived thirteen
  days before the 2026-08-02 incident. The new scan reads every object reachable
  from every ref, including commit and tag messages, with no external binary,
  and refuses to report clean on a shallow or narrowed checkout.
- The content-signing key compromised in that incident was rotated, the old key
  permanently distrusted, and history purged across all branches.

### Fixed

- `dokima --help` (and any mistyped command) booted the server instead of
  printing usage.
- The onboard/analysis path resolved its model from three environment variables
  and ignored the provider and model selected in the UI.
- The published package could not locate its own assets: the distribution root
  was identified by a hardcoded package name, which scoping the name for
  publication broke.
- **The shipped validator pack could not run at all.** The shared libraries
  every validator sources (`_lib.sh`, `_lib_sdlc_config.sh`) were absent from
  the signed manifest, so a real install landed 81 validators and zero
  libraries and executing any of them exited 127. The repo never noticed
  because its own gates run validators from the source tree, where the
  libraries sit beside them. The pack is now signed and installed complete, and
  a gate executes an installed validator rather than counting files.
- The content importer pointed at a repository that no longer exists (upstream
  renamed), and refreshed only 8 of 26 protocol documents.
- `**/` in a `write_scope` glob required at least one directory segment, so a
  scope the board accepted could be rejected by the enforcer.

### Licensing

- **FSL-1.1-ALv2** (D-022). Use, modification, internal and client use are all
  permitted; offering Dokima as a competing product or service is not. Each
  release becomes Apache-2.0 two years after it ships. Bundled `content/`
  remains Apache-2.0 (imported from `attest`).

### Known gaps

- The bundled expert library is ~133 upstream commits behind. The importer is
  fixed; the re-import itself has not run.
- Cloud provider kinds (`anthropic`, `openai`, `vertex`, `copilot`) throw a
  named `kind-not-constructible` refusal rather than falling back to localhost
  or fabricating a $0 cost. Local kinds work today.

[Unreleased]: https://github.com/bpmforge/dokima/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/bpmforge/dokima/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/bpmforge/dokima/releases/tag/v1.0.0
[0.1.0]: https://github.com/bpmforge/dokima/releases/tag/v0.1.0
