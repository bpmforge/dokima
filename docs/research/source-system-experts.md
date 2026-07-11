# Source study — bpm-opencode-experts (expert-system SDLC pipeline)

**Question:** What is the operational logic Shipwright must productize from the expert-system pipeline?
**Method:** primary-source exploration of `~/Code/bpm-opencode-experts` (2026-07-10), file-path citations throughout.
**Feeds:** Pipeline Engine, Ticket Engine, Validator Packs, Expert Registry (BLUEPRINT §3.2/3.4/3.5; D-011).

Canonical index in source: `docs/AGENT_REFERENCE.md`, `docs/AGENT_PROCESS_FLOW.md`. Shared protocols: `agents/shared/`; machinery: `scripts/`, `scripts/validators/`.

## 1. Agent roster

Two structural tiers: **primary agents** (top-level `agents/*.md`, usually skill-backed) and **micro-agents** (cluster subdirectories, skill-less, dispatched inline). Coordinators own loops/coverage; specialists own one artifact.

- **Coordinators/orchestrators:** guide (front-door router), sdlc-lead (program manager, runs gates, issues HANDOFFs), task-decomposer (request → typed DAG in plan.json), four mode engines (init/onboard/feature/improve), cluster synthesizers (code-health-synthesizer, perf-synthesizer).
- **SDLC-phase specialists:** researcher, architecture-designer, api-designer, db-architect, ux-engineer/ux-researcher/design-system-lead/frontend-design/content-designer, coding-agent, test-engineer, sre-engineer, container-ops, release-manager, changelog-writer, git-expert, migration-planner, documentation-gap-finder, ui-verifier, end-user-simulator.
- **Health/security/perf clusters** (micro-agents, inline dispatch): code-review 7 (anti-slop, complexity, dead-code, duplication, error-handling, pattern-consistency, type-safety) + synthesizer; performance 5 (bundle, concurrency, db-query, profiler, static-perf) + synthesizer; security 9 (attack-chainer, cloud, dependency, iac, owasp-llm, owasp-web, secrets, semgrep, threat-modeler) coordinated by security-auditor, with methodology docs per domain.
- **Cross-cutting:** analytics-architect, cost-engineer, a11y-compliance, data-steward, reliability-engineer, llm-integration-engineer.
- **Veracity:** challenger (second quality gate).
- **Game-dev cluster** (`agents/game/`): game-designer, gameplay-engineer, game-balance-designer, playtest-evaluator, game-asset-pipeline.

~70 agents total; `dist/compact-agents/` holds token-reduced copies. Every specialist runs the Ralph Wiggum loop (3 iterations, then escalate).

## 2. SDLC pipeline

Six phases; deliverables and gate validators hard-coded in `scripts/validators/validate-phase-gate.sh`:

| Phase | Deliverables |
|---|---|
| 0 Ideation | VISION, COMPETITIVE_ANALYSIS |
| 1 Planning | SCOPE, RISKS, CONSTRAINTS, USER_PERSONAS |
| 2 Requirements | SRS, USER_STORIES, USE_CASES (+TEST_PLAN) |
| 3 Design | MODULE_DESIGN, ARCHITECTURE, API_DESIGN+openapi.yaml, TECH_STACK, THREAT_MODEL, SECURITY_CONTROLS, INFRASTRUCTURE |
| 3.5 Test design | test-design gate (non-blocking) |
| 4 Implementation | per-module runtime reports, wave-based |
| 5 Release | FIX_BACKLOG closed, all reviews READY |

**Gate mechanism (post-T27.1, receipts):** a clean gate writes `docs/work/gates/<phase>-receipt.json` recording every validator name/exit/gap-count, the phase file list, and a content hash — not a bare timestamp lock. Phase-N prereq re-verifies phase-(N−1)'s receipt two ways: recompute input-file hash (catches edited docs) AND confirm every currently-required validator appears with exit 0 (catches gate-definition drift). Only escape: explicit visible waiver via `scripts/waive-gate.sh` (non-generic `signedBy` required). Human gates: Gate A (2→3), Gate B (3.5→4).

**Challenger gate** (`agents/shared/CHALLENGER_PROTOCOL.md` + `validate-challenger-gate.sh`): veracity layer after coverage passes. Every HIGH/CRITICAL finding and any doc carrying the marker `**External rationale (needs verification):**` requires a `CHALLENGE_REPORT_*.md` whose `**Artifact:**` field is parsed by the validator. Per-claim verdicts CONFIRMED / CONTRADICTED / UNVERIFIABLE; a challenge with no file:line/URL/validator citation is deleted (downgrades to UNVERIFIABLE, never CONTRADICTED). Hard cap 4 tool calls per claim. CONTRADICTED → mandatory revision HANDOFF.

**Two-track verification:** coverage loop (default, deterministic "is every inventory row covered?") vs confidence loop (rare, subjective 1–10). Post-T27.2 the confidence score is advisory only — it can never override a passing deterministic gate.

## 3. Loop machinery

Nested: micro-agents in macro-loops, each running its own bounded micro-loop (`agents/shared/MICRO_LOOP.md`).

- **Macro:** RALPH_WIGGUM_LOOP (cap 3, owns coverage) and FIX_VERIFY_LOOP (cap 3, owns "all CRITICAL/HIGH closed").
- **Micro (cap 2):** 1 CRITERION (restate ONE checkable success criterion; refuse-to-loop if none) → 1b PLAN-SHAPE → 2 PRODUCE → 2a EVIDENCE (≤4 look actions) → 3 SELF-VERIFY (failable; deterministic/tool-offloaded first, else verifier_model) → 4 REVISE (re-ground then fix; no-progress kill) → 4b TRACK → 5 EXIT (Completion Manifest + phrase, or `[PARTIAL]` + loop-learn).
- **Refuse-to-loop / refuse-to-select-next-work:** no checkable criterion → BLOCKED to human; red hygiene validator or open ticket blocks claiming next work in code.
- **HANDOFF protocol** (`HANDOFF_TEMPLATES.md`): identical `════`-delimited block across all executors — ROLE, CONTEXT (a context packet written before dispatch), WRITE-SCOPE, PRODUCE, VERIFY, Completion Manifest, completion phrase. `run-handoff-gates.sh` runs scope/manifest/coverage/tracker gates on return.
- **Gate scoring** (`GATE_SCORING_PROTOCOL.md`): 1–10 by an independent verifier (maker≠verifier). Asymmetric: ≥7 accept; 5–6 request polish (≤3×); 1–4 escalate to user (never auto-reject — deterministic gates already passed).
- **Runners:** `run-until-done.sh` (outer loop across session restarts; resumes from STATE.md; per-session watchdog with max-seconds + heartbeat, SIGTERM→SIGKILL, breaches to `watchdog-events.jsonl`); `run-plan.mjs` (deterministic DAG runner, journal, per-node checkpoint-retry, `--parallel`, `--auto-replan`, exit codes done/bad-plan/replan/escalated); `run-coverage-loop.sh` (gap-checksum no-progress kill, iteration caps, archives stale loop files).
- **Checkpoint/resume:** `docs/work/STATE.md` (Done / In flight / Next) rehydrated by `/sdlc resume`; distinct from git-rollback checkpointing.

## 4. Executor dispatch vs model routing (two separate axes)

- **Executors A–D** (`EXECUTOR_SELECTION.md`) are *dispatch mechanisms*: A native task tool; B subprocess (`opencode run --agent`); C manual HANDOFF paste (forbidden in autonomy=auto); D inline (coordinator runs the specialist's methodology in-conversation — how skill-less micro-agents run). Selection A→B→C, →D for skill-less; two failures drop to next executor, logged.
- **Model routing** (`MODEL_ADAPTER.md`): tier=small|medium|large adapts behavior. Core rule **"plan strong, execute cheap"**: planning/decomposition on the strong tier, bounded leaf jobs cheap; re-planning routes back to strong. **Maker/verifier split:** maker_model produces, a different/cheaper verifier_model scores; single-model fallback records maker==verifier. Escalation-on-failure is expressed through loop caps → named specialist/waiver, not a per-call auto-bump.
- Note: "localFrontier soft-gates" is a Jarvis-side concept, not present in this repo (naming reconciled in the Foreman study).

## 5. Autonomy protocol

`agents/shared/AUTONOMY_PROTOCOL.md`. Source of truth `autonomy:` in `docs/work/.model-context`. Two levels: `interactive` (default) and `auto` (each gated pause takes its documented default → one line appended to APPROVALS.md → continue). Ledger row: `| timestamp | pause_site_id | default_taken | signed_by | what would have been asked |`, validated by `validate-autonomy-ledger.sh`. Gated sites G-1…G-8 each with a documented auto-default. **NEVER-AUTO NA-1…NA-7** (always pause even in auto): interviews, destructive DB ops, merges/releases/deploys, tech-stack additions, auth/crypto fixes, scope-boundary blocks, no-safe-default escalations. NA rows must be human-signed (agent-name blocklist). Known residual gap (their own admission): the ledger is self-written — a deterrent, not proof — closing it requires an out-of-process conductor. **Shipwright's Harbormaster is exactly that closure.**

## 6. Ticket contract

`docs/TICKET_SCHEMA.md` + `scripts/lib/tickets.mjs`. plan.json gains `modules[]`: id, kind, title, lane, owner, status (`blocked|ready|claimed|in_progress|in_review|done`), interface, **write_scope[]** (non-empty exclusive globs), **depends_on[]**, **acceptance[]**, verify, plus machine-managed manifest/history[]/evidence/claimed_at.

- **Lifecycle:** six verbs only (claim/start/close/accept/release/comment), never hand-edited. WIP=1 per actor. `close` refused unless manifest exists on disk, `verify` exits 0, and branch+≥1 commit supplied. `accept` (reviewer ≠ owner) refused unless the manifest embeds the close receipt verbatim — the code-enforced end of self-asserted "done".
- **Lanes:** same-lane active modules must have disjoint write_scope; cross-lane overlap at any status is a schema error. This makes "different lane = parallel-safe" a provable property.
- **Reflow:** claimable = ready ∧ unowned; blocked⇄ready auto-resolve only; board generated as a derived view (`gen-tickets-board.mjs`) with a mermaid dependency DAG.

## 7. Validators

66 `validate-*.sh` scripts + orchestrators (`validate-phase-gate.sh`, `run-coverage-loop.sh`, `run-handoff-gates.sh`). Categories: phase-artifact/requirements; architecture/design (module boundaries, circular deps, C3 coverage, ADRs, observability, resilience, data governance); API/DB (api-coverage/consistency, contract conformance, ERD, sequences, migrations); implementation/code-health (build, lint, tests, tests-mapping, e2e-setup, dead code, file size, smoke, deps, no-reinvent); security (owasp, security-controls, iac); UX/a11y (ux-spec, design-system, wcag); doc quality (catalog, counts, render health, mermaid); process/gate integrity (phase-gate, challenger-gate, completion-manifest, scope, handoff-discipline, tracker-fresh, state-drift, loop-readiness, persistence); tickets/autonomy (tickets, ticket-hygiene, close-receipt, autonomy-ledger, autonomy-wiring); mode-scoped coverage. A parallel `scripts/test-*.ts` suite (~30 files) unit-tests the validators themselves — that suite is the seed of Shipwright's conformance tests (D-008).

## Shipwright takeaways

1. Import the whole roster + validator library as content (D-011); the validator *contract* (exit 0/1 + JSON gaps) is the plug-in API.
2. Receipts (T27.1 pattern) are the gate primitive — Shipwright generalizes them to every state transition (C3).
3. The micro-loop contract and the HANDOFF block port as-is; executor dispatch collapses to one mechanism (child-process sessions) since Shipwright owns its runtime.
4. The autonomy protocol's admitted gap (self-written ledger) is closed structurally by the Harbormaster.
5. The ticket schema is adopted nearly verbatim; Shipwright adds event-sourcing underneath it.
