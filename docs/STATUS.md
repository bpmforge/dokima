# Shipwright — Status ledger

Append one line per merged ticket; a short gate section per wave
(criteria → evidence). This file is how humans resume the project cold.

## 2026-07-10 — SDLC package cut

- Blueprint v0.4.0 approved and decision-complete (docs/BLUEPRINT.md,
  docs/DECISIONS.md D-001…D-013).
- Full package: 29 docs, plan.json (63 tickets / 261 pts, W0–W8),
  MASTER_PROMPT/PLAYBOOK/CLAUDE.md executor contract, research path
  preserved under docs/research/.
- Board state: W0-01/02/06/07 + W1-01 claimable. Nothing started.

## 2026-07-10 — Conductor shipped (build harness)

- scripts/conductor.mjs + models.json: unattended plan.json executor —
  fresh claude -p session per ticket (Sonnet/Haiku routing), out-of-session
  gates, independent review session, per-wave security audit, merge + dual
  push under APPROVALS A-001/A-002, provider-limit sleep/resume.
- Runbook: docs/work/CONDUCTOR_RUNBOOK.md. Dry-run verified (claims W0-01).
- Product twin: FR-G8 + ticket W3-07 (gateway-native limit resilience).

## 2026-07-11 W0-01 done — monorepo scaffold + toolchain

- pnpm workspace live: apps/{server,web} + 12 packages (shared, events,
  tickets, loop, validators, gateway, harbormaster, pipeline, git, forge,
  mcp, memory), each with a placeholder `src/index.ts` + one vitest test.
- apps/server: Fastify 5 stub (`GET /health`, tested via `fastify.inject`).
  apps/web: Vite 6 + React 19 stub, builds clean (`vite build`).
- Toolchain: TypeScript 5.9 strict/NodeNext, ESLint 9 flat config
  (typescript-eslint recommended), Prettier, vitest 3 workspace runner.
  `pnpm lint && pnpm typecheck && pnpm test` green — 14/14 test files pass.
- Versions match docs/TECH_STACK.md pins (Node 22, pnpm 11, TS 5, ESLint 9,
  vitest 3, Fastify 5, React 19, Vite 6); no deviations to record.
- Scope note: ARCHITECTURE §4 dependency-matrix lint enforcement
  (eslint-plugin-boundaries + red fixtures) is deliberately deferred — no
  cross-package imports exist yet to enforce against, and W0-01's
  acceptance criteria don't require it. Needs its own ticket before real
  package code lands.

## 2026-07-11 W0-07 done — config layer (three-scope settings + keychain refs)

- packages/shared/src/config: `resolveEffectiveValue`/`resolveEffectiveSettings`
  — run > project > global precedence (FR-S1), atomic per-key winning-scope
  (no deep merge across scopes; documented + tested for nested objects).
- File-backed scopes: global `~/.shipwright/config.json` (relocatable via
  `SHIPWRIGHT_HOME`), project `<repo>/.shipwright/settings.json`; both
  flat dotted-key JSON maps, validated on read, and refuse to persist any
  secret-shaped value on write (`SettingsFileSecretError`) — defensive
  enforcement of FR-S2, not just a scan.
- Credential refs: `CredentialStore` port + `resolveCredentialRef` (throws
  `CredentialRefNotFoundError`, never a plaintext fallback, FR-S2). Real
  backends: macOS Keychain via `security` CLI (thin shell-out, no native
  dep) and a `node:crypto` AES-256-GCM encrypted-file vault behind
  `SHIPWRIGHT_NO_KEYCHAIN`/`SHIPWRIGHT_VAULT_KEY` (P-003 headless/WSL
  fallback) — the vault is what the automated suite exercises; the real
  macOS keychain integration test is opt-in
  (`SHIPWRIGHT_TEST_REAL_KEYCHAIN=1`) and skipped by default so `pnpm
  test` never touches a developer's real keychain.
- Settings changes emit a `settings.changed` event (actor, scope, key,
  old→new) via an injectable `SettingsEventSink` (FR-S3) — `packages/shared`
  cannot depend on `packages/events` (ARCHITECTURE §4 law 4) and W0-02
  (event log core) is still blocked, so wiring a real sink into the event
  log is left to a follow-up ticket; `createInMemorySettingsEventSink` is
  the fake used by tests today.
- No new dependencies: `packages/shared/package.json` is outside this
  ticket's write_scope and shared has zero deps today, so validation is
  hand-rolled (`isJsonValue`/`isSettingsMap`) instead of zod, and the
  keychain adapters shell out to OS tools instead of adding `keytar`. See
  the HANDOFF note on W0-07 in plan.json for the follow-ups this implies
  (zod migration, Linux secret-service adapter, `./config` subpath export
  from `packages/shared`).
- 52/52 new tests passing (1 real-keychain test skipped by design); 84/84
  tests passing workspace-wide (85 incl. the 1 skip); `pnpm lint && pnpm
  typecheck && pnpm test` green.

## 2026-07-11 W0-06 done — git worktree service

- packages/git: `createWorktree`/`destroyWorktree`/`listWorktrees` — one
  worktree per ticket at `.shipwright/worktrees/<ticket-id>` on branch
  `sw/<ticket-id>-<slug>`; destroy verified leak-free (directory removed,
  `git worktree list` entry gone, admin dir pruned).
- `commitWithScopeCheck`: explicit-path staging only (`git add -- <paths>`,
  never `-A`); SC-01 enforcement — stages, diffs `--cached --name-only`
  against the ticket's write_scope globs, and refuses + unstages on any
  violation before a commit is made. Hard exclusions (`.git/**`,
  `.github/workflows/**`, `.shipwright/**`) always refuse regardless of
  scope; symlink escapes are caught via realpath resolution against the
  worktree root.
- `mergeLocal`: local (no-forge) landing path, `git merge --no-ff`, refuses
  if repoRoot isn't checked out on the target branch.
- Dependency added: execa 9.6.1 (per docs/TECH_STACK.md pin) — no
  deviation to record.
- 20/20 tests in packages/git (33/33 workspace-wide); `pnpm lint && pnpm
  typecheck && pnpm test` green.
