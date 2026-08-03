# Changelog

All notable changes to Dokima are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Dokima's premise is that agent sessions are untrusted and every durable state
change goes through verbs and hash-chained receipts. Entries below therefore
name what a change means for that boundary, not just what moved.

## [Unreleased]

### Added

- Content importer now takes a configurable, validated upstream checkout
  (`--source=` / `DOKIMA_CONTENT_SOURCE`), rewrites host-install paths at import
  time, refuses to clobber registered local patches, and has a `--dry-run` that
  writes nothing.

### Changed

- **License: Apache-2.0 → FSL-1.1-ALv2** (D-022), before any public release.
  Use, modification, internal and client use all stay permitted; offering
  Dokima as a competing product or service does not. Each release becomes
  Apache-2.0 two years after it ships. Bundled `content/` remains Apache-2.0.

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

[Unreleased]: https://github.com/bpmforge/dokima/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/bpmforge/dokima/releases/tag/v0.1.0
