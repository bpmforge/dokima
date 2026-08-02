# Source study — Jarvis / Foreman (autonomous loop runtime)

**Question:** How does a 24/7 autonomous SDLC loop runtime actually behave — micro-loops, anchors, coverage honesty, budgets, HITL, memory — and what did it get wrong?
**Method:** primary-source exploration of `~/Code/ai-assistant-agent` (2026-07-10), incl. branches `feat/coverage-tracker` and `feat/local-frontier-loop` and `docs/foreman/`. TypeScript/Node/Fastify, ~3600 tests.
**Feeds:** Loop Engine, Coverage Tracker, Budget Service, HITL services, Memory Service (BLUEPRINT §3.5–3.8).

## 1. Runtime shape — and the consolidation warning

Two overlapping SDLC drivers coexist in the source: **AutonomousSdlcRunner** (autonomous goal→software; five runtime phases research→requirements→design→implement→verify, each wrapped in a gate loop, plus a fix-verify loop after implement) and the older **WorkflowEngine** (chat-path phases; the engine Foreman v2 targets). This duplication is an accident of history, not a design: **Dokima's Pipeline Engine consolidates them** (D-008) — the runner's loop mechanics under the engine's phase machine. Runtime host: 24/7 Fastify server, dashboard APIs (goals, workflows, approvals, clarifications, costs, traces), multi-channel adapters. LLM layer: provider chain with task-based routing (`reasoning`/`code`/`verification`/`embed`), local providers (LM Studio/Ollama) via an OpenAI-compatible adapter, model discovery/warm-up/queueing — the direct ancestor of Dokima's Model Gateway.

## 2. Micro-loop architecture (the Loop Engine's ancestor)

`runItemMicroLoop` (`src/orchestration/specialist-loop.ts`): lumped one-shot phase judgments were re-architected into **one micro-loop per expected unit** — focused call → self-grade → re-validate with gap feedback, until `gateConf >= minConfidence` or maxPasses (default 3).

**The anchored-loop thesis** (`docs/coverage-tracker/ANCHORED_LOOP_DESIGN.md`): a weak model's one-shot judgment is noisy *and self-miscalibrated*; **loops close the gap only when given an external anchor.** Observed: un-anchored reasoning-only phases drifted run-to-run (codeHealth 3→1→2 findings) while tool-anchored phases lifted deterministically (security 5→12/14). Four anchors compose on one loop:

| Anchor | Supplies |
|---|---|
| A Tool ground-truth | semgrep/jscpd/perf-scanner facts fed into the prompt |
| B Memory | prior confirmed findings + cross-run calibration |
| C Challenger | second skeptical judgment, fired on *borderline* confidence only |
| D Adaptive budget | spend passes where they demonstrably help |

**Coverage tracker** (`src/orchestration/coverage-tracker.ts`): every expected unit ends DONE / BLOCKED / FAILED / **SKIPPED** (required-but-never-executed = a missed gate, loudly visible) / **WAIVED** (intentional, recorded, never silent). Emits COVERAGE_REPORT.md + .json. This is the honesty mechanism Dokima adopts verbatim (FR-L4).

**Calibration (bias clamp):** per-(model, phase) gap between self-confidence and *verified* outcomes adjusts the gate, not the model's number — rescue-only, clamped [0,3], ≥5 samples, applied **only when an anchor is present**. History: the first implementation had an inverted-bias bug (high tool-backed confidence produced *negative* bias, flipping DONE→BLOCKED) — fixed by the rescue-only clamp. Lesson carried into FR-L3: calibration can rescue, never manufacture.

## 3. Local-frontier mode (soft gates + hardened code gates)

`localFrontier` run option (branch `feat/local-frontier-loop`):
- **Soft upstream gates:** on document phases (research/requirements/design), if the completeness gate can't be met within budget, remaining gaps are **waived-and-recorded** (`⚠ Soft-gate waiver after N iterations — X gaps waived`) and the run proceeds. **Deliverable gates (implement/verify) are never softened** — the honest boundary.
- **Bigger iteration budgets** for weak models (12 vs 3 — tokens are cheap on owned hardware) and prescriptive gap prompts (imperative, itemized, with exact ID formats) because weak models under-produce against frontier-calibrated gates.
- **Coder-expert hardening:** large maxTokens so reasoning models aren't truncated mid-thought; `stripThinking` removes chain-of-thought from history *and* artifacts (never lands on disk); layered JSON parsing; **compile gate** (tsc/py_compile) then **hardened test gate** that actually runs the written tests — "compiling ≠ correct." Only passing tests break the loop.
- **The honest boundary (research-backed, recurring across all design docs):** this stack raises a bounded local model toward frontier *only on bounded tasks with a checkable oracle*. Memory buys token-economy and consistency; **verification buys correctness**; the few frontier-judgment moments escalate and the answer is recorded so the local tier learns it. This is BLUEPRINT honesty invariant #3/#4 and the basis of FR-G5.

## 4. Foreman v2 (the approval-queue operating model)

`docs/foreman/VISION.md + ARCHITECTURE.md`: the expert-system's discipline executing inside the 24/7 runtime; the human stops being the scheduler and becomes **reviewer of an approval queue**. Principles adopted by Dokima: *validators own gates, not vibes* (LLM scoring only after objective gates pass); *disk is source of truth* (append-only work logs); *every human dead-end gets an autonomous policy* (never park silently); *budgets are circuit breakers*; *learning on a leash* (exemplars auto-editable; agent prompts human-gated).

Proven in build (waves W0–W1 shipped): global failure handlers, **persist-before-execute + orphan sweep** (no phase stuck `running` after crash), persistent project locks, backoff + loop caps, dead-letter escalation, workflow cost ledger, **budget enforcement with 70/85/100% circuit breakers**, cost dashboard. Dogfooding data point: the independent Challenger caught **two real, test-passing HIGH bugs** in the budget/ledger work (cost keyed on the wrong ID; per-phase budget check when a phase fires 10+ calls) — maker≠verifier catches what self-verification cannot. Designed (W2–W6): ApprovalQueue with risk-classed cards (`deploy|main-merge|destructive|escalation|budget`; risk classification rule-first, LLM may raise but never lower), typed HANDOFF objects with write-scope enforced via git diff, ValidatorRunner, GateScorer (binary gates first, rubric second, best-of-3 median on small tiers), expert performance ledger, heartbeat watchdog.

## 5. Memory — the cautionary tale

Two tiers by design: T1 working memory (flat local JSON, always-on: findings + calibration) and T2 long-term (a full memory engine: SQLite+FTS5+vectors, hybrid retrieval, token-budgeted assembly, consolidation, fact store, goal anchors, checkpoints).

**The documented failure:** the mature T2 engine was **never wired into the loop** — the recall anchor fired 0 times across a full A/B run; fact/checkpoint APIs had zero loop call sites; context was packed by naive `code.slice()` truncation; consolidation was manual-only. An engine without a consumer is worth nothing. Consequences in Dokima: Memory Service is **in-process and wired from W1** (FR-M1), context packing is relevance-ranked under an explicit token budget (§7.2), consolidation is scheduled by default (FR-M3), and the loop's memory hooks are part of the Loop Engine's contract, not an integration afterthought.

Governing rules adopted: **distill-never-replay** (history never replayed into prompts), **delta-edit only** (ACE-style playbook edits), **verified-before-stored** (only tool/challenger-confirmed outcomes enter long-term memory).

## 6. HITL surfaces

- **Clarification service:** pending questions exposed via API; answer resumes the flow at its checkpoint; dismiss takes the default. → FR-N1.
- **Span-level approvals:** tools declare `requiresApproval` (email, browser, agent-creation; shell dynamic). → MCP permission matrix (FR-I3).
- **ApprovalQueue:** risk-classed cards; suspension modeled as a typed error → checkpoint + suspend → resolution resumes. → FR-N2 and the morning queue.
- **Escalation-policy table:** every formerly-human branch mapped to a policy (auto-pass thresholds, park-with-card, retry-one-tier-up, hard-stop on budget, `possible-broken-validator` flag on stuck gaps). → the Harbormaster's autonomous-policy catalogue.

## Dokima takeaways

1. Per-item micro-loops with external anchors are the unit of execution; one-shot phase judgments are banned (FR-L1/L2).
2. Coverage honesty (SKIPPED/WAIVED visible forever) ports verbatim (FR-L4).
3. Soft gates for weak models on document phases only; code gates never soften (FR-G5).
4. Crash-safety patterns (persist-before-execute, orphan sweep, watchdog, dead-letter) are W0 requirements, not hardening afterthoughts (NFR-3).
5. Budget breakers 70/85/100% port verbatim (FR-G4).
6. Memory must be wired the day it exists; the loop's memory hooks are part of its contract (FR-M1–M3).
7. Consolidate the two SDLC drivers into one Pipeline Engine — do not port both (D-008).
