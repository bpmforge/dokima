# Changelog

All notable changes to Dokima are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Dokima's premise is that agent sessions are untrusted and every durable state
change goes through verbs and hash-chained receipts. Entries below therefore
name what a change means for that boundary, not just what moved.

## [Unreleased]

Nothing yet.

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

[1.0.0]: https://github.com/bpmforge/dokima/releases/tag/v1.0.0

## [0.1.0] — 2026-08-03

First public release. Every milestone gate through the v1.0 dogfood criterion
is met; the version is deliberately conservative while the name clears
trademark review.

> The `v0.1.0` tag was re-pointed once before release, after verification of the
> packaged artifact found that the shipped validator pack could not run at all
> (see _Fixed_ below). Nothing had been published or released against the
> earlier tag. Recorded here rather than quietly retagged.

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

## [0.1.0] — 2026-08-03

First public release. Every milestone gate through the v1.0 dogfood criterion
is met; the version is deliberately conservative while the name clears
trademark review.

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

[Unreleased]: https://github.com/bpmforge/dokima/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/bpmforge/dokima/releases/tag/v0.1.0
