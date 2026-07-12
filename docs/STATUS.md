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

## 2026-07-11 W0-02 done — event log + projections engine

- packages/events: append-only `events` + `identities` tables per
  DATABASE.md §2 (numbered SQL migrations, `PRAGMA user_version`); FK from
  `events.actor_id` to `identities.id`; `kind CHECK(human|machine)`;
  `BEFORE UPDATE`/`DELETE` triggers `RAISE(ABORT)` on `events` — tamper
  attempts fail at the DB layer.
- `appendEvent`: seq and prev_hash resolved from the tail row inside one
  `db.transaction()` — no AUTOINCREMENT-then-update race window.
  `computeEventHash`/`verifyChain` implement
  `sha256(prev_hash‖seq‖type‖actor‖payload)` (ARCHITECTURE §3), hashed over
  the literal stored payload text; `verifyChain` catches tampered
  payloads/hashes, truncation, and reordering.
- Projection framework (`Projection<S>`, `rebuildProjection`,
  `ProjectionRegistry`): fast-check property tests prove rebuild-from-zero
  equals incremental fold across arbitrary event sequences.
- `persistBeforeExecute` appends `<op>.started` before running and
  `<op>.completed`/`.failed` after; `sweepOrphans` (wired into
  `openEventLog` via `systemActorId`) appends `<op>.orphaned` for any
  `.started` left unresolved by a crash — tested via a pending-operations
  projection that is empty after every scenario, including a simulated
  crash (close mid-flight, reopen, sweep).
- Single-writer (C6): writer connections open with `timeout: 0`; a second
  connection's write while the first holds an open transaction throws
  `SQLITE_BUSY` immediately (<500ms, test-asserted) — no app-level
  lockfile, native SQLite behavior under the synchronous better-sqlite3
  API.
- packages/shared/src/events/: `EventEnvelopeContract`/`IdentityContract`
  + `isIdentityKind` — canonical boundary shapes (D-005). Not yet imported
  by packages/events: wiring a subpath export touches
  packages/shared/package.json / src/index.ts, outside this ticket's
  write_scope glob — deferred to a follow-up ticket (noted in plan.json).
- Dependencies added: better-sqlite3 12.11.1, @types/better-sqlite3
  7.6.13, fast-check 4.9.0 (per docs/TECH_STACK.md pins) — no deviation to
  record; pnpm-lock.yaml/pnpm-workspace.yaml updated (same pattern as
  W0-06/execa).
- 26/26 tests in packages/events, 4/4 new in packages/shared (113/114
  workspace-wide, 1 pre-existing opt-in skip); `pnpm lint && pnpm
  typecheck && pnpm test` green.
- Review fix: `identities` now gets the same `BEFORE UPDATE`/`DELETE`
  append-only triggers as `events` (001_init.sql) — an in-place edit of
  `kind`/`role` after events were recorded against an `actor_id` would
  otherwise silently rewrite the audit trail's meaning without breaking
  `verifyChain()` (C-4/C-6). Regression test in db.test.ts asserts direct
  SQL UPDATE/DELETE on `identities` throws. 27/27 tests in packages/events
  (114/115 workspace-wide, 1 pre-existing opt-in skip); `pnpm lint && pnpm
  typecheck && pnpm test` green.

- Closed 2026-07-11 W0-02 done — event log + projections engine; hash chain (verifyChain), projection rebuild=incremental property test, persist-before-execute + orphan sweep, single-writer C6. Reverted an out-of-scope docs/DATABASE.md edit from the prior attempt. Gate: pnpm lint && pnpm typecheck && pnpm test = 114 passed | 1 skipped.
2026-07-11 W0-02 SECURITY FIX — hash preimage was delimiter-free (field-boundary collisions defeat tamper-evidence); now length-prefixed + regression test. Caught by manual review AFTER the conductor merged it (LLM review non-determinism let the HIGH slip). events: 28 tests green.
2026-07-11 W0-03 done — ticket engine: contract + six lifecycle verbs (claim/start/close/accept/release/comment) as the ONLY mutators, folding an in-memory projection from @shipwright/events; transition graph enforced; WIP=1 per actor (close, not accept, frees the worker); close refused without manifest (>=1 file/commit, verify exit 0), minting a close receipt embedded verbatim; accept reads only the stored manifest, refuses self-accept or missing receipt (FR-T1/T2). 23 tests (unit + docs/research/source-system-experts.md §6 conformance + fast-check property). Gate: pnpm lint && pnpm typecheck && pnpm test = 138 passed | 1 skipped.
2026-07-11 W0-04 done — lane/write-scope invariants + claimable-set reflow: glob-overlap detector (segment/char-level DP over the `*`/`**`/`?` write_scope dialect, mirroring packages/git/src/glob.ts without importing it — tickets may not depend on git per ARCHITECTURE.md §4); findLaneScopeViolations/validateLaneWriteScopes flag same-lane overlap only between active (claimed/in_progress/in_review) tickets, cross-lane overlap at any status (FR-T3, schema error at plan load). reflow.ts: claimable = ready AND unowned AND deps done, recomputed fresh on every call; `blocked` is a pure overlay over ready+unmet-deps (the six verbs never write it, so blocked<->ready auto-resolves by construction); isStaleBlocked flags a stored blocked status whose blockers have since completed (board.stale_blocked). index.ts barrel exports left untouched (outside write_scope) — deferred to whichever ticket first consumes lanes/reflow. 29 tests (13 unit + 5 fast-check glob-overlap/violation properties in lanes*, 10 unit + 2 fast-check in reflow*). Gate: pnpm lint && pnpm typecheck && pnpm test = 167 passed | 1 skipped.

## 2026-07-11 — Wave W0 security pass: 1 CRITICAL + known risks (BUILD HALTED for review)

The conductor's between-wave security audit halted the run (correct behavior on CRITICAL). Findings:

- **CRITICAL — plan.json status edited without receipts.** The conductor/agents flip ticket status by hand-editing plan.json, which is the exact anti-pattern (unreceipted state change, maker self-asserting) the ticket engine built this wave exists to prevent. This is a BOOTSTRAP-HARNESS artifact (plan.json is the conductor's work tracker, predating the events-based ticket system it is building), not shipped-product code — but the principle is sound. DECISION NEEDED (founder): accept as a documented, signed waiver for the bootstrap and continue, or make the conductor dogfood the ticket engine / project status from the events log. Until decided, the build stays halted (a security CRITICAL is NEVER-AUTO).
- **HIGH (known/by-design until W3) — close/accept trust maker-supplied verify.** `packages/tickets` closeTicket/acceptTicket transition on maker-supplied files/commits/verify with no independent re-run; that verification is the Harbormaster's job (FR-H1, ticket W3-01) and the durable receipts table (W0-05, was blocked — now unblocked). Self-attestation window exists until W3 lands. Tracked risk.
- **MEDIUM follow-ups** (not blockers): reducer.ts folds event payloads via unchecked `as` casts (add zod validation at fold time); verbs.ts trusts bare `actorId: string` (accept a verified Identity); lanes.ts glob DP is recursive/unbounded (make iterative + cap length).

Full report: docs/work/SECURITY_W0.md. W0-05 write_scope defect fixed + reset to todo (see its notes).

## 2026-07-11 — CRITICAL waived (SW-001), build resumed

Brad signed SW-001 (docs/work/SECURITY_WAIVERS.md) accepting the plan.json bootstrap-status finding as a documented known risk. Conductor now downgrades waived CRITICALs to logged security.waived events; unwaived criticals still halt. Build resumed W0-05 -> onward.

2026-07-11 W2-01 done — provider framework (FR-G1): Provider interface (chat/listModels/getContextLength/health/warmUp/queueStats) + OaiCompatProvider serving LM Studio, Ollama, and generic OpenAI-compatible endpoints (packages/gateway/src/providers/), wire shapes verified live against OpenAI/Ollama/LM Studio docs rather than training data. Per-endpoint RequestQueue defaults to concurrency 1 (local one-at-a-time); chat() auto warm-up-pings a cold endpoint once. normalizeUsage() meters tokens in/out via a cost table (unpriced/local models = $0, never silently zero-metered — missing usage throws). HTTP failures classified: ProviderAuthError/ProviderRateLimitError (parses Retry-After)/ProviderTimeoutError/ProviderUnreachableError/ProviderHttpError. Native fetch, not the `openai` SDK — packages/gateway/package.json is outside write_scope (see ticket notes HANDOFF). 29 new tests, all against recorded fixtures, no live calls. Gate: pnpm lint && pnpm typecheck && pnpm test = 195 passed | 1 skipped.

2026-07-11 W2-02 done — Anthropic + OpenAI cloud adapters (FR-G1, FR-S2): AnthropicProvider (packages/gateway/src/providers/anthropic.ts) speaks the native /v1/messages wire format (system prompt as a top-level field, typed content blocks, x-api-key/anthropic-version headers), verified live against platform.claude.com's messages/streaming/models-list docs — the last confirms /v1/models carries max_input_tokens, so context-length discovery is live, not static-only like W2-01's local adapter. OpenAiProvider (openai.ts) composes W2-01's createOaiCompatProvider for every non-streaming Provider method (identical verified wire shape) and adds a required Authorization bearer, optional OpenAI-Organization/OpenAI-Project headers, and a required cost table (no $0 default for a paid API). Both adapters satisfy "streaming + non-streaming" via an internal `stream` config toggle that aggregates each vendor's SSE format into the same normalized ChatResponse — Provider (types.ts) has no streaming method yet and is outside this ticket's write_scope, so that's future scope. Anthropic's 529 overloaded_error is classified as ProviderRateLimitError (same back-off-and-retry contract as 429). apiKey on both adapters is a pre-resolved secret the caller must supply via a credential ref (FR-S2) — neither adapter touches a keychain itself. 39 new tests (26 Anthropic, 13 OpenAI), covering auth/rate-limit/truncation/stream-abort/mid-stream-error/chunk-boundary-reassembly for both wire paths, all against recorded fixtures, no live calls. Gate: pnpm lint && pnpm typecheck && pnpm test = 234 passed | 1 skipped.
