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

## 2026-07-12 — 3 false blocks landed by hand + conductor gate fixed

W0-05 (receipts, keyed-HMAC anchor), W1-01 (full content import: 85 experts+70 validators+8 protocols+index.json), W1-03 (micro-loop) were all FIXED by the model ladder but false-blocked by the conductor: reviewer APPROVED yet sticky bookkeeping held stale findings unresolved. Root-caused + fixed the merge gate (trust informed APPROVE; block only on freshly-raised or explicitly-still-PRESENT findings). Full gate green on all three.

## 2026-07-12 — real validators wired into the conductor gate

content/validators (imported W1-01) now feed the per-ticket gate. Reliable/objective validators (validate-file-size, validate-circular-deps) run diff-scoped as HARD gates — a ticket only answers for violations IN ITS OWN diff, never pre-existing debt. Grep-heuristic validators (validate-code-health, validate-dead-code) are NOISY on TS (magic-numbers-in-comments, bogus-unreachable) so they run ADVISORY: their diff-scoped findings anchor the LLM review, which adjudicates real-vs-false-positive — the source systems' "script floor + agent verified pass" design. Config: conductor.config.json validators.gate/advisory (promote to gate once red-fixture-calibrated).

2026-07-12 W1-04 done — coverage tracker (FR-L4): packages/loop/src/coverage.ts — createCoverageTracker(specs) starts every unit PENDING; start/complete/waive transition it to RUNNING or a terminal status (DONE/FAILED/BLOCKED/WAIVED); finalize() surfaces any unit still PENDING/RUNNING as SKIPPED (expected-but-never-ran) and returns the COVERAGE_REPORT — requiredSkipped + gatePasses is the phase-gate input (SKIPPED on a required unit fails the gate; optional SKIPPED units are reported but don't gate). waive() refuses without a non-empty by+reason attribution. toCoverageReportJson/toCoverageReportMarkdown render the .json/.md artifacts; every transition also emits an event-shaped record (coverage.unit.*/coverage.report.generated) returned to the caller — pure engine, no event-log or filesystem dependency (mirrors micro-loop.ts from W1-03); wiring those into the real event log/artifact directory is the orchestrator's job (harbormaster W3-01 / phase machine W5-01), outside this ticket's narrow write_scope. 22 new tests (coverage.test.ts + coverage.conformance.test.ts, the latter adapted from docs/research/source-system-foreman-jarvis.md per D-008). Gate: pnpm lint && pnpm typecheck && pnpm test = 289 passed | 1 skipped.

2026-07-12 W1-05 done — anchor framework + calibration clamp (FR-L2, FR-L3): packages/loop/src/anchors.ts — Anchor interface (`gather(item, criterion) -> AnchorFact[]`), `gatherAnchorFacts`/`formatAnchorFactsForPrompt` compose an arbitrary anchor set into the "gather -> facts into prompt" block; `createToolAnchor` is fully wired to validator/scanner output (the `{name, exitCode, gapCount, gaps?}` shape matching `receipts.validators` JSON, docs/DATABASE.md) — a failing validator always yields a fact the model must reconcile with. `createStubChallengerAnchor`/`createStubMemoryAnchor` define the real interfaces (including the challenger's borderline-confidence `shouldFire` firing contract, [0.5, 0.85]) but `gather()` honestly returns no facts — real wiring is W5 (challenger) / W7 (memory), not faked here. packages/loop/src/calibration.ts — per-(model,phase) `CalibrationRecord` (bias/sampleCount/meanRawConf/meanVerifiedConf); `updateCalibration` learns a rescue-only bias (verified-minus-raw underconfidence gap, clamped [0, MAX_BIAS=0.2], zeroed below MIN_SAMPLE_COUNT=5 — an overconfident model earns bias 0, never a penalty); `applyCalibrationBias` re-clamps defensively and gates application on anchor-presence + min-sample. The load-bearing invariant is `gateDecision({anchorIsPresent, deterministicGatePassed})`, which takes no confidence parameter at all — a type-level proof that self-confidence, raw or calibrated, cannot manufacture a DONE (the 2026-07-01 inversion regression class). Property tests (calibration.property.test.ts, a seeded mulberry32 PRNG — 500 cases/property, no external dep, kept in write-scope) prove: bias always ∈ [0, MAX_BIAS] including against malformed/out-of-range stored bias; bias is exactly 0 below min-sample; `gateDecision` equals `anchorIsPresent && deterministicGatePassed` for every boolean combination, independent of confidence. 25 new tests (anchors.test.ts, calibration.test.ts, calibration.property.test.ts). Gate: pnpm lint && pnpm typecheck && pnpm test = 314 passed | 1 skipped.

2026-07-12 W1-06 done — HANDOFF contract + agent session runner: packages/loop/src/handoff.ts — typed Handoff -> renderHandoff() to the exact BLUEPRINT §4 ════-delimited block (ROLE/TICKET/CONTEXT/WRITE-SCOPE/PRODUCE/VERIFY/RETURN); HandoffTicket is a local minimal projection (id, title), not @shipwright/tickets' Ticket, since loop may not import tickets (ARCHITECTURE.md §4 dependency matrix). packages/loop/src/session-manifest.ts — CompletionManifest shape matches API_DESIGN.md §4 exactly; stripThinking removes `<think>...</think>` before any parsing (SRS FR-L5 thinking-strip); parseCompletionManifest is three-tier defensive (whole-output JSON contract -> embedded JSON via a string-aware balanced-brace scan -> fenced code block). packages/loop/src/session-scope.ts — detectScopeViolations (basic glob classification, duplicated dialect from packages/git/src/glob.ts per the same tickets/loop precedent set in W0-04, since loop may not import git either) + computeChangedPaths (real `git diff`/`ls-files` via node:child_process directly, no execa dependency needed since package.json sits outside this ticket's write_scope). packages/loop/src/session.ts — runSession renders the HANDOFF, spawns via an injected SpawnSession (never hardcodes an agent CLI or imports gateway — loop's egress law), strips thinking, defensively parses the manifest, and reports scope violations from the real diff independent of the session's own claims (SC-02's two-trust-level split: untrusted manifest vs. observed reality). createChildProcessSpawn is a real node:child_process implementation defaulting to a PATH-only env, not `process.env` — an untrusted session must never default-inherit parent credentials (SC-03/SC-07); caught by the advisor's independent review before close and fixed with a planted-secret regression test. Did not touch packages/loop/src/index.ts (barrel) — outside write_scope, deferred to the harbormaster ticket (W3-01) that first wires this in. 44 new tests; scope-check and child-process tests run against real temp git repos and a real `node -e` child process, no mocks. Gate: pnpm lint && pnpm typecheck && pnpm test = 350 passed | 1 skipped (pre-existing) workspace-wide, 53 test files.

2026-07-12 W2-04 done — Google Vertex AI adapter (FR-G1, D-007): VertexProvider (packages/gateway/src/providers/vertex.ts) implements the Provider contract over Vertex's regional Gemini REST endpoint (`https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent`), verified live against docs.cloud.google.com's inference/count-tokens references. Auth is ADC via google-auth-library's GoogleAuth (vertex-auth.ts) — the library TECH_STACK.md L121-125 mandates ("never hand-roll JWT signing"): GoogleAuth owns credential discovery (explicit service-account JSON ref / GOOGLE_APPLICATION_CREDENTIALS / well-known gcloud file / GCE metadata), RS256 JWT-bearer signing, the refresh-token grant, and token caching+refresh. (This supersedes a prior close that hand-rolled the JWT flow with node:crypto — a TECH_STACK trap, reverted here.) Construction is lazy; a malformed ref, missing credential, or token-acquisition failure surfaces as a typed ProviderAuthError/health 'error' only at call time — never an uncaught crash. The GoogleAuth client sits behind an injectable authClientFactory so contract tests acquire tokens network-free (CLAUDE.md Law 9). Dependency footprint: google-auth-library is declared in the ROOT package.json, not packages/gateway/package.json — this ticket's write_scope excludes the gateway package.json and the conductor's out-of-scope gate (ALWAYS_OK) only blesses the root package.json + pnpm-lock.yaml; Law 2 ("provider SDKs in gateway only") is honored in substance since the library is imported solely from vertex*.ts. HANDOFF: relocate the dep into packages/gateway/package.json once a ticket owns that file. Model discovery (listModels/getContextLength) is static-config-only (no verified catalog wire shape, same scope decision as oai-compat.ts). health()/warmUp() always verify ADC token acquisition and probe the free countTokens endpoint only when the caller supplies healthCheckModel — never a hardcoded model id. 33 tests across providers/vertex*.test.ts (auth path selection + error mapping via a fake auth client; 401/429/500/unreachable classification; wire-format), all network-free. Gate: pnpm lint && pnpm typecheck && pnpm test = 383 passed | 1 skipped (pre-existing) workspace-wide.

2026-07-12 W2-05 done — role->model matrix + task routing + maker!=verifier defaults (FR-G2, FR-S3): packages/gateway/src/routing/ — matrix.ts resolves a (role, taskType) call to [primary model, ...fallbackChain] from a three-scope (run>project>global) matrix, atomic per role, falling back to the 'default' role when unset; maker-verifier.ts's guardMakerVerifierDistinct refuses a verifier role (code-reviewer/challenger) landing on the same model as the maker (SameModelRefusedError) unless an explicit per-role override setting is true, in which case it mints a MakerVerifierOverrideEvent via an injectable sink; router.ts's route() composes both and makes the guard STRUCTURAL — routing any verifier role auto-resolves the maker role (default coding-agent) for the same task type and compares, so a caller can't silently bypass the refusal by omitting a parameter (fixed after advisor review flagged the initial caller-triggered shape). presets.ts ships All-local/Hybrid/All-cloud, each covering coding-agent/code-reviewer/challenger/test-engineer/pm-interviewer/default; presets.test.ts implements the SRS FR-G2 verify clause verbatim — for every preset and every task type, code-reviewer/challenger never resolve to the coding-agent model. No workspace dependency on packages/shared (package.json out of write_scope, same constraint W2-01/02/04 hit) — the three-scope precedence algorithm is reimplemented locally; HANDOFF left in routing/index.ts. 38 new tests. Gate: pnpm lint && pnpm typecheck && pnpm test = 421 passed | 1 skipped (pre-existing) workspace-wide.

2026-07-12 W2-06 done — escalation ladder R0-R4 + escalation events (FR-G3): packages/gateway/src/escalation/ — runEscalationLadder (ladder.ts) drives R0 (MemoryConsultHook free consult, ends the ladder with zero events on a hit) -> R1 (matrix chain[0] for role+taskType, default coding-agent/code) -> R2 (chain[1], "one rung up," degenerating to R1's model when the matrix has no fallback) -> R3 (frontier: taskType 'escalation' resolved against a distinct `frontierRole`, default 'challenger' — NOT the climbing role itself, since no shipped preset defines a taskTypes.escalation override on coding-agent, so that would've silently repeated R1's model; caught by advisor review before close, regression-tested via it.each against all three real presets asserting R3 != R1) -> R4 (blocked-with-evidence). The actual model call/micro-loop stays in packages/loop (out of scope, no workspace dep from this write_scope, same constraint W2-05 documented) — an injected AttemptRunner reports back one GateOutcome per rung; this ticket owns rung sequencing, model selection, and event emission only. MissingFailureEvidenceError structurally refuses to advance a rung or reach R4 on a failure reported with zero receipts (evidence-triggered, never vibes-triggered, enforced not just documented). GateOutcome.receiptId threads optionally through to EscalationEvent so a future real AttemptRunner (minting via packages/events' mintReceipt) can be verified against its actual anchored W0-05 receipt rather than trusting the event's copied validator summary. events.ts mirrors routing/maker-verifier.ts's injectable-sink pattern (this package can't depend on packages/events either). isMonotonicRungSequence exposes the "spend rungs are monotonic per ticket" check (TESTING.md §3) for tests. 16 new tests including the SRS-verbatim FR-G3 titles ("a passing ticket can never emit an escalation event", "a simulated R1 gate failure escalates to R2 with the failure receipt attached") plus R4-evidence and degenerate-matrix coverage. Gate: pnpm lint && pnpm typecheck && pnpm test = 437 passed | 1 skipped (pre-existing) workspace-wide, 155 in packages/gateway (16 in escalation).

2026-07-12 W2-07 done — budget service: ledger + 70/85/100% breakers (FR-G4, FR-H5): packages/gateway/src/budget/ — CostLedger keyed by project/run/ticket, every entry carrying a berthId so run/project totals aggregate across every berth by construction, never by caller discipline (FR-H5). BudgetBreakerTracker reads the ledger per (project, run), takes the tighter of the run-limit/project-limit ratio (FR-G4: "per run and per project"), and ledgers each of 70% (warn, Record tier), 85% (downshift, Record tier), 100% (hard_stop, Decide tier + approval card carrying US-243's 'budget' risk class) exactly once as spend crosses it — spend is monotonic (a ledger only ever adds cost) so a level once reached is never re-emitted; one large entry that jumps past several thresholds at once still ledgers each one it passed through, in order, at the same final spend, so an audit sees exactly when each tripped (UC-05). policyForLevel() exposes skipOptionalPasses/preferCheaperRungs (true at downshift and above) and canClaimNewTicket (false only at hard_stop, so an in-flight ticket still completes or checkpoints rather than corrupting mid-ticket) — this ticket only decides the policy; enforcement is the consumer's job, same injection-point split as escalation/ladder.ts's AttemptRunner (W3-01's harbormaster ticket loop, which depends_on this ticket, is the intended canClaimNewTicket consumer). events.ts mirrors escalation/events.ts's injectable-sink pattern (noop default + in-memory sink for tests) since this package cannot depend on packages/events from this ticket's write_scope. Not exported from packages/gateway/src/index.ts (out of write_scope, same gap every prior gateway ticket left for its own module). 33 new tests, plain vitest (no fast-check — gateway's existing escalation tests skip it too despite similar monotonicity properties, stayed consistent). Gate: pnpm lint && pnpm typecheck && pnpm test = 464 passed | 1 skipped (pre-existing) workspace-wide.

2026-07-12 W2-07 gate-fix — prior attempt's trackerKey() in packages/gateway/src/budget/breakers.ts embedded a literal raw NUL byte (0x00) as a Map-key separator inside a template literal; git's binary-file heuristic classified the whole file as binary, so `git diff`/`git show` rendered "Binary files differ" for it — defeating blame/log -p and undermining this same file's own UC-05 auditability claim. Fixed by replacing the NUL with a plain `::` delimiter (trackerKey is purely an internal, in-process Map key — never serialized or compared across a boundary, so no behavior change) and re-saving as clean UTF-8 with no control bytes (confirmed: no 0x00 byte in the file, `file` reports "Unicode text, UTF-8 text", and `git diff --text` now renders a normal two-line diff instead of a binary notice). No tests added or changed. Gate re-run green: pnpm lint && pnpm typecheck && pnpm test = 464 passed | 1 skipped (pre-existing) workspace-wide, same counts as the original close.

2026-07-12 W2-08 done — model fitness check: planted-defect bench + fitness cards (FR-G6, BLUEPRINT §12.1): packages/gateway/src/fitness/ — a bench of fixed oracle tasks per role (coding-agent/code-reviewer/challenger, the three named in acceptance) that mints a FitnessCard (fit/unfit/marginal) per (model, role, harnessVersion), keyed per docs/DATABASE.md §7's model_fitness PK. Two oracle kinds: 'function-behavior' is the real executable oracle TESTING.md §8 calls "a bug with a failing test" for the coding-agent task — the model's returned function is extracted via balanced-brace matching and actually invoked (node:vm) against known input/output cases; 'keyword' covers review/challenge, text-reasoning tasks with no executable check for "did it catch the planted issue" (does it cite the planted FIT-DEFECT-1 marker / ask for a citation on the uncited claim). Verified empirically before building on it that vm.Script's `timeout` only bounds the script's own synchronous evaluation, not a later call to a function it returns — calling the returned function host-side hung on an infinite-loop candidate; fixed by wrapping the invocation inside the same timed script text so the call itself is bounded, covered by a test that a while(true) function fails fast instead of hanging the suite. fixtures.ts loads e2e/fitness-fixtures/*.json (plain data, not code) at runtime via fs rather than a cross-package TS import graph; this is this ticket's other write_scope root, not test/fitness/ as TESTING.md §8 names it — plan.json's write_scope governs, same kind of doc-vs-plan.json deviation W2-01 documented. assignment.ts/events.ts satisfy the second acceptance criterion: guardFitAssignment structurally mirrors routing/maker-verifier.ts's guardMakerVerifierDistinct — an unfit or marginal pair throws UnfitAssignmentRefusedError (carrying the card) unless the caller passes an explicit ack, which mints a fitness.unfit_ack event via an injectable sink (this package cannot depend on packages/events from this ticket's write_scope, same constraint every prior gateway ticket hit). Not wired into routing/router.ts's route() (packages/gateway/src/routing/** is outside this ticket's write_scope) and FitnessCardStore is in-memory only (no global SQLite DB owner yet) — both left as HANDOFF in fitness/index.ts for future tickets, same injection-point split W2-05/06/07 left for their own consumers. 46 new tests, including the red-fixture proof this gate needs (TESTING.md §8: "CI tests the harness, not real models") — a scripted strong fake mints 'fit' and a scripted weak fake mints 'unfit' per role against the real e2e/fitness-fixtures/ set, not a synthetic task list. Gate: pnpm lint && pnpm typecheck && pnpm test = 510 passed | 1 skipped (pre-existing) workspace-wide.
