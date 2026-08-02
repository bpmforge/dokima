# Dokima — Full-System Design Review (pre-resume hardening)

**Date:** 2026-07-14 · **Branch:** `review/design-review-hardening` · **Reviewer:** Claude Fable 5 session (kickoff: REVIEW_KICKOFF_PROMPT.md, the RepoPulse method)
**Inputs:** all 29 docs + plan.json (65 tickets / 268 pts, 23 done) + landed code (packages/, apps/, content/, scripts/) + conductor telemetry (CONDUCTOR_FIELD_REPORT.md, conductor-log.jsonl) + RepoPulse exemplar artifacts.

**Verdict:** the design package is unusually strong on trust-core mechanics and honesty invariants — but it is **not yet ready for cheap-agent resume**. Three blocker-class findings gate the resume: the board fails the product's *own* lane/write-scope law (verified by execution), the module-boundary enforcement the architecture claims is lint-enforced does not exist, and every landed wave systematically deferred the "make this package importable" work that W3 will need on day one (the exact W0-08/W1-02 failure class, about to recur). All three are fixable on this branch; the fix pack below is applied in the accompanying commits.

Because Dokima's build already ran (23 tickets landed by the bootstrap conductor), this review adds a section RepoPulse never needed: **§6 spec-vs-built drift** — where the docs claim things the code doesn't do, and where the code learned things the docs don't say yet.

---

## 1. Modularity assessment — PARTIAL PASS (aspirational, not machine-enforced)

| Property | Evidence | Verdict |
|---|---|---|
| Module map matches reality | 12 packages + 2 apps exist exactly per ARCHITECTURE §4 | ✅ pass |
| No package imports `apps/*` (law 1) | grep clean across packages/*/src | ✅ pass |
| Live imports respect the §4 matrix | tickets→events, validators→events, server→events/tickets — all legal; loop/gateway import nothing cross-package | ✅ pass (but see next row) |
| Boundaries machine-enforced | **NO.** eslint.config.js is 25 lines, no eslint-plugin-boundaries / dependency-cruiser anywhere; `content/validators/validate-module-boundaries.sh` exists but is wired into no gate. ARCHITECTURE.md:1/§4/:142 claims "lint-enforced" — **false today** | ❌ **G-2** |
| Compliance is structural, not coincidental | loop/gateway comply by *duplicating* logic (glob dialect ×3, three-scope resolution ×2) instead of importing — matrix-legal `shared` homes exist but nobody scoped them | ⚠️ **G-20** |
| Packages are importable by their consumers | shared/loop/gateway barrels are placeholders; lanes/reflow exported nowhere; gateway package.json declares zero deps | ❌ **G-3** |
| Single writer / event-log discipline | events triggers + single-writer test-proven (W0-02); receipts re-export fixed 2026-07-12 | ✅ pass |

**The compounding risk:** the matrix says `harbormaster` may import almost everything — it is exactly the wave where an illegal import becomes possible, and it starts with no lint fence (G-2) against a set of packages it cannot even import yet (G-3). W3 resume without fixing both re-runs the W0-08/W1-02 seam failures at higher stakes.

## 2. Persona journeys walked as processes

Full inventory: 4 personas, 47 stories (E1–E8, 178 pts), 12 use cases. Journey dead-ends (a number/status without an owned action):

### 2.1 P1 Solo builder
Day-0 (wizard → sample project) and daily loop (morning queue) are owned end-to-end. **[GAP G-10a]** the *trust-graduation* moment — "graduates to berths=2–3 + `wave` once fitness cards and receipts have earned it" (USER_PERSONAS) — has no surface, trigger, or nudge anywhere. Nothing ever tells the user they've earned it.

### 2.2 P2 Professional dev
Closed: morning queue as PR inbox, CLI verbs, explain-this-refusal. **[GAP G-17]** CLI parity ("UI and CLI drive the same verbs") still has no FR — known since SRS §4.3.2, now fixed (FR-C7).

### 2.3 P3 Small team lead
**[GAP G-10b]** teammates' only surface is *reading the forge mirror* — acting (claim/approve/comment) is v2 by decision D-005. The journey is honest but the docs never say what a teammate should *do* when they spot a problem on the mirror (answer: tell the operator; the mirror comment thread is the channel). Documented now in USER_PERSONAS; real fix is v2/S-40.

### 2.4 P4 Local-LLM enthusiast
Daily loop (escalation events in the queue) owned. **[GAP G-10c]** the signature weekly ritual — file a field report → playbook — had a build ticket (W7-05, whose write_scope already includes `apps/web/src/lessons/**`) but **no UX_SPEC surface**; spec amended. **[GAP G-10d]** "the weekly report attributes exactly what escalation bought" (UC-06) — asserted, but no screen renders it; `GET /spend?group_by=rung` exists in API_DESIGN. Recommendation R-track (P2), not silently specced.

### 2.5 Cross-persona
**[G-10e]** `blocked-with-evidence` limbo: by design, Decide promotion waits for idle-block — but the only surface meanwhile is a board badge. Documented as intended behavior + notification-center visibility clarified. **[G-10f]** archive has no reopen flow in the docs (FR-F2 implies `POST /projects` re-registers; UX_SPEC now says so). **[G-10g]** `STALE — claimable?` badge: reflow auto-resolves blocked⇄ready by construction (W0-04), so the badge is informational for *stored* blocked states only; semantics now stated in UX_SPEC.

## 3. Customization surfaces

| Knob | Where | Status |
|---|---|---|
| Model matrix + presets + fitness gate | FR-G2/G6, W2-05/08 landed | ✅ built |
| Model adapters (new provider) | Provider interface in code; NFR-5 claims "documented contracts" | ⚠️ contract doc unwritten, unowned → **G-27** (P4 deliverable) |
| Validators (user-authored) | executable 0/1+JSON contract; per-project pack selection (FR-S1) | ⚠️ no red-fixture calibration requirement for user rules; no lifecycle (shadow→gate) → **P2 FP-economics domain** |
| Expert library (add/override) | FR-E1 data-not-code; per-project overrides | ⚠️ no management UI in any W4 ticket → W4-06 acceptance amended (**G-19**) |
| Forge adapters (plug-in API) | FR-I2 "generic + adapter plug-in API" | ⚠️ contract doc unwritten → **G-27** |
| MCP servers | FR-I3 + SC-12 | ⚠️ registration UI missing from W4-06 → amended (**G-19**) |
| Content pack signing | SC-09, D-006 flywheel | ❌ no ticket anywhere; SC-09 claims W1 signing that never happened → **G-4d** |

## 4. Licensing ledger

TECH_STACK.md had **no license information for any dependency** (G-13). Verified from installed node_modules 2026-07-14 (remainder UNVERIFIED until their wave installs them):

| Component | License | Constraint | Action |
|---|---|---|---|
| fastify 5.10, better-sqlite3 12.11, zod 4.4, execa 9.6, react 19.2, vite 6.4, vitest 3.2, eslint 9.39, fast-check 4.9, tsx 4.23, prettier 3.9 | MIT (verified) | none | column added to TECH_STACK |
| typescript 5.9, google-auth-library 10.9 | Apache-2.0 (verified) | NOTICE preservation on redistribution | note in TECH_STACK |
| ws, mermaid, @codemirror/*, tailwindcss 4, @tanstack/react-query, @fastify/websocket, fastify-type-provider-zod, @anthropic-ai/sdk, openai | UNVERIFIED (not yet installed) | expected MIT/Apache-2.0 | verify at installing wave — rule added to TECH_STACK |
| playwright | Apache-2.0 (upstream, UNVERIFIED locally) | none | verify at W4 |
| content/ (85 experts, 70 validators, 26 protocols, 3 refs) | Brad's own (bpm-opencode-experts), imported with provenance | **repo has no LICENSE file**; D-006 says open, license unchosen | founder slate: Apache-2.0 vs MIT — pre-0.3 gate (RELEASE_TRACKER) |
| LM Studio / provider ToS | n/a (services) | RISKS/kickoff law: verify at the wave that uses them | W2 landed against LM Studio **without a ToS check** — do at resume |

No copyleft, no RSAL/SSPL, no registry-rule exposure in the runtime deps. The semgrep/TruffleHog/AGPL concerns from the RepoPulse ledger apply here only if imported validators shell out to them — audit of the 66 validator scripts is a P2 item (they are grep/bash-native per the field report; confirm).

## 5. Gap register

Severity: **B** blocker (agents/product break), **H** high, **M** medium, **L** low.
Status: `fixed` = corrected in this branch's commits; `ticketed` = added to plan.json; `open` = needs Brad's decision (listed again at the P2 STOP).

| ID | Sev | Gap | Resolution | Status |
|---|---|---|---|---|
| G-1 | B | **The board fails the product's own law.** Ran plan.json through `packages/tickets` `findLaneScopeViolations` (FR-T3, W0-04): **66 cross-lane write-scope violations** — 58 from W0-01's scaffold territory (`apps/**`,`packages/**`), 8 substantive: W1-01(content)×{W5-02,W5-09,W6-05,W8-03}, W4-01(ui)×{W5-03,W5-09,W7-05,W8-04} | Two-part: (a) propose **FR-T3 refinement — territory releases at `done`** (cross-lane overlap is a schema error only among tickets that can still write) + an explicit `scaffold` exemption class — this is R-1, Brad adopts at STOP; (b) board scope surgery for the 8 substantive pairs lands in P5 with the F1 splits (one bulk edit, not two) | open → R-1 / P5 |
| G-2 | B | ARCHITECTURE.md claims module boundaries are "ESLint-enforced" (×3). No boundary plugin exists; `validate-module-boundaries.sh` wired into no gate. False today, unowned | Added ticket **W3-10** (eslint-plugin-boundaries + red fixtures + wire validator into conductor gate); ARCHITECTURE annotated with enforcement status + ticket ref | ticketed + fixed (doc) |
| G-3 | B | Un-ticketed "public surface" backlog: shared/loop/gateway barrels are placeholders, lanes/reflow unexported (zero consumers), shared `./config` subpath, gateway package.json zero deps (google-auth in root), settings.changed sink is a fake. W3-01 *cannot* fix these (scope too narrow) — the W0-08/W1-02 seam class will recur immediately at resume | Added ticket **W3-11** "package public surfaces + dependency declarations" (pre-req for W3-01a); W5-07's seam-linter acceptance already covers the *future* | ticketed |
| G-4 | H | SECURITY_CONTROLS landing waves contradict the board: (a) SC-06 secrets vault/redaction "W0" vs actual W8-03; (b) SC-07 sandbox "W1" vs W6-06 (SRS §4.1 also said W1); (c) SC-08 auth middleware "W0" vs W4-01 (D-005 "from W0" pre-commitment unmet — apps/server is a /health stub); (d) SC-09 "signed at import (W1)" — import was *not* signed, no ticket anywhere | Docs fixed to actual waves with explicit risk-window notes; SC-09 → ticket **W6-07** (pack signing + first-party re-sign). **Open question for Brad: pull W8-03 (secrets redaction) forward to W3** — until it lands, receipts/events can carry leaked keys, and the trust story is incomplete for every wave built before it | fixed (docs) + ticketed + open (W8-03 timing → R-2) |
| G-5 | H | DEPLOYMENT.md promises with zero owning tickets: /healthz, `dokima doctor`, `service install` (launchd/systemd), `backup` + retention-7, `providers refresh`, restore drill | /healthz + SC-08 tests → W4-01 acceptance amended; rest → new ticket **W8-06** ops lifecycle (doctor, backup+retention, restore drill EXECUTED as a test, service install, providers refresh) | fixed (board) + ticketed |
| G-6 | H | **CI does not exist and no ticket creates it.** TESTING.md references CI gates throughout; SC-16 requires CI assertions (.npmrc, frozen lockfile, audit); planted-defect suite "runs every commit" — nothing runs anywhere | Added ticket **W0-09** CI pipeline (full gate + planted-defect + conformance + frozen-lockfile + `pnpm audit` + nightly e2e schedule). Claimable immediately at resume (W0 infra exception) | ticketed |
| G-7 | H | Tier-aware loop ceiling (local tiers 12+ vs metered 8) committed in BLUEPRINT FR-L7 + FINDING_LOOP_POLICY §3 but unthreaded: SRS FR-L7 row, POLICY §4 budget table, W3-08 acceptance all still say flat cap 8 | Threaded everywhere; **flagged at STOP for confirmation** since it amends a field-validated budget policy (it was found uncommitted in the tree — presumed founder-intended) | fixed (flagged) |
| G-8 | H | W3-01 is a 5-pt dependency chokepoint, blocked with a real unresolved HIGH (manifest.files never cross-checked against `computeChangedPaths`), and the F1 split (a/b/c) exists only as prose in RELEASE_TRACKER | P5 board completion applies F1–F4 (split, human-pair lane flag, v2.1.0 precondition, W3-08/09 early); the manifest-files cross-check is written into W3-01b's acceptance then | open → P5 |
| G-9 | H | `~/.dokima/global.db` (DATABASE §7: projects/providers/global_playbook/model_fitness) has **no owning ticket**; FitnessCardStore is in-memory; `guardFitAssignment` never wired into routing | Added ticket **W4-09** global registry DB + fitness persistence + fit-guard wiring into `route()` | ticketed |
| G-10 | H | Persona dead-ends (a–g, §2 above): trust-graduation unowned; teammate journey; field-report UI unspecced; escalation-spend view missing; blocked-limbo; archive reopen; STALE badge semantics | UX_SPEC amended for c/e/f/g (mechanical); a (graduation nudge) and d (escalation ROI view) are **R-3/R-4 recommendations** — new design, not silent spec edits | fixed (spec) + open → R-3/R-4 |
| G-11 | M | TESTING.md says `npm test`/`npm run e2e`/`npm run lint`; everything else says pnpm | Canonical **pnpm** everywhere | fixed |
| G-12 | M | TESTING §8 names `test/fitness/`; reality + plan = `e2e/fitness-fixtures/` (W2-08 deviation note) | TESTING.md updated to actual path | fixed |
| G-13 | M | TECH_STACK has no license column (100% of deps unstated); anthropic/openai SDKs + tsx + playwright unpinned | License column + verified values + UNVERIFIED-at-wave rule added; pin-at-wave rule already present, reiterated | fixed |
| G-14 | M | Vocabulary drift: coverage-state ordering differs across docs; board "Done" vs coverage "DONE" (two axes, no glossary); `in_review` vs "In Review" vs `blocked-with-evidence` casing; "Phase 2.5" only in plan.json; constraint IDs written both `C-6` and `C6`; five severity scales never reconciled | Canonical ordering DONE/WAIVED/BLOCKED/FAILED/SKIPPED everywhere; glossary block added to BLUEPRINT §10 (status axes, scales, casing rules, C-x canonical) | fixed |
| G-15 | M | DATABASE §3 `notifications.kind` enum ends in a literal `…` — open enum, cheap-agent trap | Enum closed (8 kinds) + extension rule stated | fixed |
| G-16 | M | SRS §4.1 traceability table: malformed row (FR-L6/L7 row swallows the NFR row); FR-I4 wave wrong (W1) | Table repaired; FR-I4 → W6 | fixed |
| G-17 | M | CLI parity (BLUEPRINT §5.3) has no FR (SRS §4.3.2 admitted it) | **FR-C7** added (SRS + BLUEPRINT §6.1 backfill, same pattern as FR-C6/T6/G6/G7/L5) | fixed |
| G-18 | M | UX elements with no FR/ticket: empty states (nowhere in any doc), ⌘K palette, shipped ticker, quiet hours | Empty-states inventory added to UX_SPEC + W4-02/03/05/07 acceptance amended; palette/ticker/quiet-hours annotated to their owning tickets | fixed |
| G-19 | M | W4-06 settings UI omits MCP registration, validator-pack selection, expert overrides (all FR-S1 project-scope items) | W4-06 acceptance amended | fixed (board) |
| G-20 | M | Glob dialect implemented 3× (git+loop identical matchers, tickets overlap-DP) — silent-divergence hazard on security-sensitive scope logic; matrix-legal `shared` home exists | Added ticket **W3-12** shared glob module + migration of all three | ticketed |
| G-21 | M | No human-prerequisite tickets exist (forge machine accounts + tokens ×2, Copilot/Vertex credential setup, LM Studio install) — RepoPulse's "the ONLY human steps" class | **docs/PREREQUISITES.md** added (per-wave human checklist); W6-03 acceptance now cites it; wizard (W4-06/FR-S4) covers provider paths | fixed |
| G-22 | M | SC-11 extras unowned: audit-verify on boot, high-water seq mirror to `~/.dokima/` | W8-05 acceptance amended (boot sequence + high-water mirror); forge comment-anchor already in W6-03 | fixed (board) |
| G-23 | M | `Provider` has no streaming method — deferred by W2-01/02, no ticket adds it; W4-04 chat needs it | Added ticket **W2-09** provider streaming (chatStream + SSE aggregation, both cloud adapters + oai-compat); W4-04 deps updated | ticketed |
| G-24 | M | Pending slates stale: P-005 says "zod 4 vs 3, pnpm 10 vs 9, revisit free at W0-01" — W0-01 landed zod 4.4.3 + pnpm 11.11.0; P-003 implemented as assumed (W0-07 vault) | DECISIONS pending-slates table updated with landed actuals (bookkeeping, not re-litigation) | fixed |
| G-25 | M | `scripts/supervise.sh` hardcodes fnm Node **v24.14.0**; product pins Node 22 (.nvmrc). This is the likely cause of the better-sqlite3 ABI break found (and fixed) during this review — the harness builds/tests under a different Node than the product | **Not touched** (kickoff §0 forbids touching supervise.sh). Flagged for the resume sequence: fix the path to respect .nvmrc before relaunch | open (resume prep) |
| G-26 | M | Conductor gate uses 2 hard + 2 advisory of 70 shipped validators; 66 unwired incl. module-boundaries, scope, close-receipt, security-controls. No promotion path exists | This *is* the FP-economics domain (P2): rule lifecycle shadow→advisory→gate with measured FP + red-fixture calibration. Register here; designed in P2 | open → P2/R-5 |
| G-27 | M | NFR-5 "documented contracts" per plug-in surface (experts/validators/adapters/providers) — none written, unowned | P4 architecture-completion writes the contract docs (validator contract exists in fragments; consolidate) | open → P4 |
| G-28 | L | SECURITY_CONTROLS defines SC-09 before SC-08; SRS lists FR-H5 before FR-H4 (noted, IDs stable) | Left as-is (IDs are stable; renumbering is worse) | fixed (no-op, recorded) |
| G-29 | L | content/index.json descriptions are lossy first-line truncations | Cosmetic; regenerate via `import-content.mjs --manifest-only` at v2.1.0 resync (F3) | open (resume prep) |
| G-30 | L | plan.json bootstrap schema lacks product-ticket fields (`verify`, `type`, `interface`, `stories`) — bootstrap-vs-product divergence is deliberate (SW-001 territory) but nowhere stated | Schema note added at top of plan.json ($schema_note); `stories` added board-wide in P5 | fixed (note) + P5 |

**Also verified — no action needed:** hash chain + receipts (post-fix) match ARCHITECTURE §3; all 25 threats carry ≥1 SC control (weakest: T-8, T-17 — single-control but L-rated and accepted); event envelope/DATABASE/API_DESIGN shapes agree; escalation rungs, morning-queue ordering, notification tiers, challenger verdicts consistent across all docs; symlink containment real in packages/git and the e2e harness (loop's lexical-only check is a *documented* deliberate gap with W3-09 correctly owning the real fix); F1–F4 fix plan is coherent with the field data; content counts reconcile exactly (85/70(66)/26/3).

## 6. Spec-vs-built drift appendix (what the code knows that the docs don't, and vice versa)

1. **Docs ahead of code (claims not yet true):** boundary lint (G-2); SC-06/07/08/09 landing waves (G-4); DEPLOYMENT ops surface (G-5); CI (G-6); "documented contracts" (G-27).
2. **Code ahead of docs (learned in the field, now canonized):** validator gate/advisory split + red-fixture calibration requirement (field report §5 → P2 rule-lifecycle design); seam-ownership lesson (→ W5-07 acceptance, already amended 2026-07-12); infra-failures-never-charge-the-coder (→ FINDING_LOOP_POLICY, FR-L6); tier-aware ceilings (G-7).
3. **Deliberate divergences now documented:** fitness fixtures path (G-12); loop's lexical-only scope check (session-scope.ts header, W3-09 owns realpath); gateway packages reimplementing three-scope resolution locally (write-scope constraint, consolidation candidate after W3-11).
4. **Test truth:** 610 passing / 1 opt-in skip across 83 files; per-package: gateway 26, loop 12, events 9, tickets 7, server 7, shared 6, git 5, validators 5, e2e 1. Placeholder-only (unstarted waves): forge, mcp, memory, pipeline, apps/web — and **harbormaster** (attempted, blocked, nothing on main).

## 7. What happens next (the arc)

- **P2 (next):** domain interrogations → R-x recommendation index → **STOP for Brad** (adoption of R-1 territory-release, R-2 secrets pull-forward, R-3 graduation nudge, R-4 escalation-ROI view, R-5 rule lifecycle, + whatever the interrogations add).
- **P3–P5:** thread adopted amendments; sequence diagrams/ADRs/failure rows; `validate-plan.mjs` + `validate-traceability.mjs` (crib RepoPulse, extend for this board's schema); stories[] linkage; F1–F4 fold-in; challenger completeness pass.
- **P6:** STATUS gate entry with independent re-run evidence + readiness report + exact resume sequence (including G-25 supervise.sh Node fix and F3's v2.1.0 re-import).
