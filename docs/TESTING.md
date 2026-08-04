# Dokima — Test Strategy

Traces to `docs/SRS.md`, `docs/BLUEPRINT.md` §2.2/§6, `docs/DECISIONS.md` (esp. D-008).
Non-negotiables: **CI never calls a real model provider or forge host** — every LLM call is
faked at the gateway boundary, every forge call at the adapter boundary; the **planted-defect
gate-integrity suite (§6) runs every commit from W0 and is never waived** — a platform whose
pitch is "the gates cannot be spoofed" proves it in CI, on itself. Runner: vitest
(unit/property/conformance/integration), Playwright (E2E over the Canvas).
`pnpm test` = all vitest tiers; `pnpm e2e` = Playwright against a seeded stack.

## 1. Tier map (what runs at which gate)

| Tier | Scope | Runs at | Blocks |
|---|---|---|---|
| Unit (vitest, co-located `*.test.ts`) | pure logic per package | every commit | commit |
| Invariant/property (fast-check) | ticket lifecycle, lane collision, receipts, calibration | every commit | commit |
| **Gate-integrity planted-defect suite (§6)** | trust boundary (FR-T2, FR-H1, FR-P2, NFR-4) | every commit from W0 | commit — never waivable |
| Conformance suite (source-system fixtures, §4) | micro-loop, coverage tracker, ticket semantics | every commit from W1 | commit |
| API integration (`fastify.inject` + temp SQLite) | core routes, projections, verbs | every commit | commit |
| Event-sourcing replay | projections rebuilt from log ≡ live state | every commit from W0 | commit |
| Playwright E2E (fake-model gateway, §7) | UC-01…UC-12 journeys over the Canvas | pre-merge on UI tickets + nightly | merge |
| Model-fitness bench fixtures (§8) | FR-G6 harness itself | W2 gate + on bench changes | wave gate |
| Crash/chaos matrix (kill −9, watchdog, drift) | NFR-3, FR-H2/H3 | pre-wave-gate W3+ | wave gate |
| Offline soak (network-blocked full mini-program) | NFR-1 | W4+ wave gates, release | wave gate |
| a11y (axe) + perf timers (NFR-2) | all routed Canvas pages | pre-merge on web tickets + W4/W8 gates | merge/gate |
| **History secrets scan (§6a)** | every object reachable from every ref — file contents *and* commit/tag messages, i.e. what the tree scanner structurally cannot see | every push/PR (CI `history-secrets`) + release | push — never waivable |
| Dogfood gate | Dokima runs its own pipeline on itself | W8 | 1.0 release |

Per-ticket definition of done: `pnpm lint && pnpm typecheck && pnpm test` workspace-wide
plus the ticket's own `verify` command — which is exactly what FR-T2 re-runs at close.

## 2. Unit conventions (vitest)

- Co-located `*.test.ts` next to source; no `__tests__` dirs.
- Mock only at port boundaries: model provider adapter, forge adapter, clock, filesystem-heavy
  git ops. Never mock our own modules inside a package — if a unit needs three mocks, the unit
  is wrong.
- SRS acceptance sketches appear **verbatim as named tests** (e.g. `FR-G3: a passing ticket can
  never emit an escalation event`); wave-gate traceability check greps FR IDs in test titles.
- Deterministic time and IDs everywhere: injected clock, seeded RNG — receipts and event logs
  must be byte-comparable in fixtures.

## 3. Invariant & property tests (fast-check) — the trust core

The properties below are the productized honesty invariants (Blueprint §0); each is a
permanent CI property, not a one-off:

- **Ticket lifecycle (FR-T1/T2):** for any sequence of verbs, (a) only transitions on the
  enforced graph occur; (b) no path reaches `done` without close receipt + manifest + verify=0
  + reviewer≠owner; (c) WIP=1 per actor holds at every step; (d) there is no API that writes
  `status` directly (compile-time + route-walker assertion).
- **Lane collision (FR-T3, FR-H5):** for any generated plan, same-lane active tickets have
  disjoint write-scopes or the plan is rejected at load; for any berth schedule over a valid
  plan, no two concurrently-active tickets share a lane, and the union of their applied diffs
  never overlaps a foreign write-scope.
- **Receipt verification (FR-P1/P2):** receipt validity is a pure function of (input tree hash,
  validator set, exit codes); mutating any input file flips validity; a receipt for a validator
  set that is no longer current is stale; waiver receipts require a signature not on the
  agent-identity blocklist.
- **Escalation (FR-G3):** escalation events exist only downstream of a failure receipt; spend
  rungs are monotonic per ticket; R4 always carries evidence.
- **Calibration (FR-L3):** for all (bias, confidence, anchor) tuples, DONE ⇒ anchor present ∧
  deterministic gate passed; bias ∈ [0, MAX_BIAS]; below min-sample the bias is 0. (Regression
  property for the 2026-07-01 inversion bug class.)
- **Coverage (FR-L4):** after any run, every inventory unit is in exactly one of the five
  states; state-count sum ≡ inventory size; SKIPPED > 0 ⇒ phase gate red.
- **Event log (NFR-4/6):** hash chain verifies for any prefix; truncating or editing any event
  breaks verification; projections are a pure fold — `rebuild(log) ≡ liveState` after every
  fixture scenario.

## 4. Conformance suite — source-system fixtures (D-008)

Per D-008 the runtime is re-implemented clean, porting **contracts and algorithms, not code**
— the source systems' test fixtures are the proof the port is faithful. W1's content import
brings, with provenance headers, fixture sets under `test/conformance/`:

- **Micro-loop fixtures** (Jarvis/Foreman `runItemMicroLoop` + MICRO_LOOP contract):
  criterion-refusal cases, gap-checksum no-progress kills, bounded evidence actions, honest
  PARTIAL exits, anchor-reconciliation cases. Dokima's Loop Engine must reproduce the
  expected pass/exit sequence for every fixture.
- **Coverage-tracker fixtures** (coverage-tracker branch): inventory→state mappings including
  the WAIVED-attribution and SKIPPED-flagging cases; end-of-phase report shape.
- **Ticket-semantics fixtures** (bpm-opencode-experts `tickets.mjs` / TICKET_SCHEMA): valid and
  invalid plans (scope overlap, cyclic deps, missing verify), claimable-set recomputation
  sequences, reflow blocked⇄ready cases.
- **Receipt/HANDOFF format fixtures** (gate receipts, HANDOFF blocks): parse + round-trip.

Rules: fixtures are imported **once** (no live sync — no umbilical, D-008); divergence is
resolved by changing Dokima or consciously forking the fixture with a provenance note in
the fixture header; the conformance suite is a distinct vitest project so its pass/fail is
reported as its own line in CI.

## 5. Integration (Fastify inject + temp SQLite)

- `fastify.inject()` against the fully-registered app — no listener, no port.
- **Per-worker temp SQLite**: each vitest worker gets its own `:memory:` (or tmpdir WAL file
  for persistence-path tests) database, migrated at setup — parallel-safe, disposable; WAL
  crash-recovery cases use the file-backed variant.
- Verb endpoints tested end-to-end: verb → events appended → projections updated → WebSocket
  frame emitted (captured via injected transport).
- Route-walker: every registered route requires an identity (v1 single-user auth middleware,
  D-005); machine identities rejected on human-only routes (waiver signing, NEVER-AUTO
  approvals); the walker reads the route table so new routes are covered automatically.
- Egress guard active in every integration test: any network call to a model/forge host fails
  the test (all traffic must pass the faked adapters).

## 6. Gate-integrity planted-defect harness (the red-team suite)

A fixture set proving the trust boundary holds — every case below **must FAIL to achieve its
goal**, and the suite fails if any spoof *succeeds*. This is the M27 gate-integrity audit
turned into permanent CI, and it is the release gate's centerpiece (NFR-4/6).

| Defect fixture | Attack simulated | Must be refused by |
|---|---|---|
| Spoofed lock/receipt | Hand-written `gates/<phase>-receipt.json` with fake exit codes, or retroactively minted after doc edits | FR-P2 input-hash recompute + validator-set currency check |
| Fabricated manifest | Manifest claims files/commits that don't stat, or a verify result that doesn't reproduce | FR-H1 out-of-session stat + verify re-run |
| Promise token | Agent output containing every historical completion phrase ("DONE", "all gates green", manifest-shaped prose) with no artifacts | FR-T2 — completion is receipt-existence, never string-match; grep the codebase: no completion-phrase matching exists |
| Self-accept | Owner identity (human or agent) calling `accept` on its own ticket; reviewer manifest missing the embedded close receipt | FR-T2 reviewer≠owner + verbatim-receipt check |
| Agent-signed waiver | Waiver receipt signed with an agent identity | FR-P2/FR-N3 blocklist |
| Scope escape | Session diff touching paths outside `write_scope` | FR-H1 diff scope check — edits refuse to apply |
| Credential probe | Agent session env/prompt inspected for reviewer/forge tokens | NFR-4 — assert absence in a real spawned session |
| Ledger forgery | NEVER-AUTO ledger row without human signature; edited ledger row | FR-N3 runtime ledger validation + hash chain |
| Risk downgrade | Model output attempting to lower an approval's rule-assigned risk class | FR-N2 raise-only rule |
| Soft-gate on build | Waiver attempt against a phase-4 verify gate | FR-G5 hard rejection |

Each row is one fixture directory + one named test; new spoof classes discovered in the field
(lessons intake, Blueprint §12.6) are added here first, fix second.

## 6a. History secrets scan — the gate that reads what the tree scanner cannot

`content/validators/secrets-scan.sh` (W3-13, SC-06) greps the working **tree** and passes
`--exclude-dir=.git`. By construction it can never see a credential that was committed and
later removed. That is not a theoretical hole: the Ed25519 content-signing **private** key sat
in pushed history from 2026-07-20 to 2026-08-02 — gitignored, absent from the tree, and green
on every gate the whole time ([`work/SECURITY_RELEASE_BLOCKER_2026-08-02.md`](work/SECURITY_RELEASE_BLOCKER_2026-08-02.md)).

`scripts/validate-history-secrets.mjs` (W10-27) closes it. Every object reachable from
`git rev-list --objects --all` — file contents **and commit/tag messages** — using the same six
credential categories as the tree scanner, git plumbing plus Node and **no scanning binary**
(Law 9 — measured at ~1.3s over 1065 commits / 5025 objects / 295 MB). Exit `0` clean · `1`
findings · `2` could-not-scan. Run it directly, or let CI's `history-secrets` job run it on
every push.

Four properties are the point, and each has a planted-defect test in
`scripts/validate-history-secrets.test.mjs`:

| Property | Why it is the property | Planted defect that proves it |
|---|---|---|
| Reads history, not the tree | The whole reason the ticket exists | A PEM key committed, then deleted and gitignored: `secrets-scan.sh` — first proven to catch that same key while it is in the tree — then reads clean, while this scanner exits 1 and hands over `git log --find-object=<blob>` |
| Reads **commit and tag messages**, not only file contents | `git rev-list --objects` prints commit objects with no path, so a parser keyed on the space separator drops them silently — and a credential pasted into a commit message is published history that no tree edit removes | A token in a commit message, and another in an annotated tag message, are each caught with a spotless working tree |
| Baseline keys on the secret **value**, never the path | A path-scoped allowlist lets a real credential hide inside an already-baselined fixture file, and churns on every edit to one | A second, unbaselined token added to an already-baselined fixture file still fails the gate |
| Fails **closed** | A shallow clone has no history, so reporting clean would make this a gate that cannot fail | A `--depth 1` clone exits 2, not 0; so do an empty repo, a non-repo, and an unparseable baseline |
| Verifies its own **denominator** | The scan is `git rev-list --all`, so it is only as complete as the local ref set — and a single-ref checkout is *not shallow*, so nothing else catches it | A clone fetched with `+refs/heads/main:refs/remotes/origin/main` reports OK over a repo whose other branch carries a token; `--verify-remote-refs` exits 2 naming the missing branch, and finds the token once it is fetched |
| Never prints a secret | A scanner must not become the leak it exists to prevent (Law 8) | Neither stream may contain the planted value — only `ghp_...REDACTED(n chars)` |

Known-benign shapes live in `scripts/history-secrets-baseline.json`, keyed on
`category + sha256(value)[0:16]`. Today: 24 entries, every one a test fixture or documentation
example (including AWS's own published `AKIAIOSFODNN7EXAMPLE` and a false positive on the prose
string `sk-at-most-one-question`). Regenerate with `--update-baseline` — and **read the diff**,
because adding a line to that file is precisely how a real leak would be silenced.

Fixture secrets in that test file are assembled at runtime rather than written as literals. A
literal would be committed once and then gate this repo forever, forcing a permanent baseline
entry for a test's own fixture. The scanner still sees the fully formed shape at runtime.

CI does not trust `fetch-depth: 0` to have fetched every branch: the job fetches
`+refs/heads/*:refs/remotes/origin/*` explicitly and then runs with `--verify-remote-refs`, the
scanner's one network call (opt-in, so local runs stay offline per Law 9).

**Two limits, stated rather than buried.** It covers the same six categories as the tree
scanner, so a credential shape nobody has a pattern for is invisible to both. And `--all` is
*reachable*-only by design: a secret that was force-pushed away and garbage-collected reads
clean locally while it may still be retrievable from the hosting forge's dangling objects —
which is exactly the caveat the 2026-08-02 write-up records about what a history rewrite does
not undo.

A history hit is never fixed by deleting the file. Rotate the credential, then purge and
force-push — the blocker write-up records what a rewrite does *not* undo.

## 7. E2E — Playwright over the Canvas with a fake-model gateway

- **Fake-model gateway**: a scripted provider adapter implementing FR-G1's interface,
  returning deterministic per-role scripts (interview answers, manifests, findings, a
  configurable failure budget for escalation scenes). Latency injectable to test NFR-2's
  never-block rule. No CI job talks to a real provider, ever.
- Seeded stack: real core + temp SQLite + fake gateway + local git fixtures; forge adapter
  faked at the same boundary (recorded GitHub/Gitea fixtures for W6 scenes).
- **Journeys = the use cases**: UC-01 (miniature full program, doubling as the FR-C6 guided
  first-run test), UC-02 (berths=3 overnight → morning queue), UC-03/04/05 (clarification,
  human-edit conflict, breaker), UC-11 (crash/resume — server killed and rebooted mid-scene),
  UC-12 (waiver signing). Each journey asserts through the UI **and** re-asserts the receipt
  chain on disk afterward.
- Board projection lag and interaction timings asserted with timers (NFR-2: <1s, <100ms).
- axe scan per routed page; keyboard-only pass for board verbs and the morning queue.
- **Fixture event payloads are honest, not richer than reality (W10-41)**: a fixture may
  seed a *subset* of a real event's payload (e.g. omitting `escalation.*`'s `receipts`/
  `receiptId`) but never a superset and never a differently-shaped payload — inventing a
  key (`gate.receipt_minted`'s `payload.validators`, `escalation.*`'s `payload.reason` were
  both fixture-only fabrications no real appender ever wrote) creates a false contract that
  outlives the fixture that invented it: a later audit or ticket reads the fixture, assumes
  the data is real, and builds on it. Where a fixture needs richer content than a plain
  envelope, seed it through the real seam (`mintReceipt`, the escalation emitter) rather
  than hand-authoring a payload shape. `apps/web/e2e/fixtures/event-payload-shape.test.ts`
  derives each event type's real allowed key set from its production appender/type at test
  time — never a hand-maintained list — and fails if a seeded payload carries a key its real
  appender doesn't write.

## 8. Model-fitness bench fixtures (FR-G6)

- `e2e/fitness-fixtures/` ships the planted-defect task set per role (path per plan.json W2-08 write_scope — supersedes the earlier `test/fitness/` name): coding (bug with a failing test
  as oracle), challenger (planted contradiction + citation-less claim bait), reviewer (planted
  scope escape), interviewer (must slate, not assume, a founder fork).
- CI tests the **harness**, not real models: a scripted "strong" fake passes, a scripted
  "weak" fake fails, and the fitness card renders the right fit/unfit verdicts per role.
- A manual script (`scripts/fitness-live.mjs`, not in CI) runs the bench against real local
  endpoints; results land in the matrix UI, never in the CI gate.

## 9. Coverage expectations & CI gates per wave

- Core trust packages (ticket engine, receipts, event log, loop engine, coverage tracker,
  budget): **≥90% line / ≥85% branch** — pure logic, no excuse. Gateway/adapters ≥80% via
  contract fixtures. Canvas covered by E2E journeys + targeted component tests (no % gate).
- Thresholds enforced per package in CI; a drop is a failing gate, not a warning.
- Wave gates (mirrors ROADMAP): W0 exits only when §3 invariants + §6 suite are green ("a
  board that cannot lie"); W1 adds conformance (§4); W2 adds fitness-harness + ledger/breaker
  properties; W3 adds crash/chaos matrix; W4 adds E2E journeys + a11y + NFR-2 timers; W5 adds
  pipeline/receipt E2E (UC-01, UC-10, UC-12); W6 adds forge contract + mirror reconciliation
  (UC-08); W7 adds memory/playbook suites (offline BM25 path); **W8 = dogfood**: Dokima
  executes its own pipeline on this repo — threat model, security suite, a11y — and the 1.0
  tag requires that run's receipts committed in-repo.
- Traceability check at every wave gate: each SRS acceptance sketch for the wave maps to a
  named test (grep FR/UC IDs in test titles); a gap is a gate failure, honestly reported as
  SKIPPED — never silent (FR-L4 applies to our own process too).

## Agent sessions (W11, D-023)

Dokima's own tool-using session is tested the same way every other model-facing
path is: **against the fake gateway, with no network and no real model** (law 9,
C-1). A scripted `tool_calls` sequence drives the loop, the loop edits a real
worktree, and the EXISTING close gate judges the result — if the gate needs
loosening to accept our own agent, that is a finding to report rather than a
licence to change it.

Two things the fake gateway cannot prove, and which therefore have to be run by
hand and recorded on the ticket rather than trusted to CI:

1. **That a real model emits a parseable tool call at all.** The fake gateway
   round-trips whatever shape we teach it, so a green suite proves the loop, not
   the wire format. W11-01 requires one hand-run against a local model.
2. **That the loop converges on real output.** A scripted sequence always
   terminates; a real model may loop on a failing edit. T-27's budget cap is
   fixtured, but "does it actually finish a ticket" is measured by running it.

The containment fixtures (SC-17/T-26) are the ones that must never be softened:
each escape shape is asserted refused at the tool boundary **and** refused again
by SC-01 with the pre-check disabled. A pre-check that made SC-01 redundant
would be exactly the self-attestation Law 4 refuses.
