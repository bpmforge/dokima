# Shipwright — Use Cases

End-to-end scenarios validating SRS FRs in combination. Traces to `docs/SRS.md`,
`docs/USER_STORIES.md`, `docs/DECISIONS.md`. Format: actor · preconditions · main flow ·
alternate/error flows · FRs exercised. Personas P1–P4 per SRS §1.2.

## UC-01 — Idea to launched product (full program)

**Actor:** P1 solo builder. **Preconditions:** fresh install (NFR-1), any model matrix preset applied (FR-G2).
**Main flow:**
1. P1 selects New Product mode (FR-P5) and types the idea in plain English.
2. PM interview runs phases 0–2 (FR-P3); slate cards decide founder forks into DECISIONS.md (FR-P6); P1 approves Gate A on receipted validators (FR-P1/P2).
3. Blueprint stage synthesizes SRS+architecture with open questions; revision loop until decision-complete; lock lifts (FR-P7).
4. Design fan-out → Challenger on HIGH claims (FR-P4) → Gate B.
5. Decomposition produces the ticket DAG (FR-T1/T3); P1 reviews/edits it on the board (US-203).
6. Harbormaster builds the board: cheapest-first micro-loops (FR-L1, FR-G3), out-of-session gates (FR-H1), receipts on every close (FR-T2).
7. Morning queue: P1 merges PRs (NEVER-AUTO, FR-H4); release-readiness gates pass; P1 gives launch approval → tag + release.
**Alternates:** A1 — P1 edits SRS after Gate A: receipt goes stale, advance refused until re-validation (FR-P2/P3). A2 — a ticket exhausts the ladder: parks blocked-with-evidence; P1 gets a Decide card only when no other work remains (FR-G3, FR-N4).
**Postcondition:** shipped product with a complete receipt chain from idea to tag (NFR-6).

## UC-02 — Autorun overnight, berths=3 → morning queue

**Actor:** P3 team lead. **Preconditions:** board decomposed with ≥3 lanes; budgets set (FR-G4); dry-run estimate reviewed (FR-G7).
**Main flow:**
1. P3 sets berths=3 + autorun (breakpoint `never`) — one toggle + slider (FR-H5, D-010).
2. Three worker identities claim across distinct lanes; per-berth worktrees; WIP=1 each (FR-T1, FR-I1).
3. NEVER-AUTO actions are prepared (PRs opened, migration drafted) and parked `in_review`; unblocked lanes continue (FR-H4).
4. Auto-mode defaults append ledger rows silently — Record tier, zero pops (FR-N3/N4).
5. Morning: P3 opens the queue — merges first, then approvals, clarifications, digest — reviews the night in ten minutes (US-404).
**Alternates:** A1 — two claimable tickets share a lane: second waits; berths never collide (FR-T3/H5). A2 — a berth's session stalls: watchdog terminates, dead-letter escalation, card blocked-with-evidence within seconds (FR-H2, NFR-3). A3 — local gateway serves one request at a time: berths queue transparently (FR-G1).

## UC-03 — Clarification mid-loop

**Actor:** agent (coding role) + P1. **Preconditions:** build running; a ticket hits genuine ambiguity with no decidable criterion.
**Main flow:**
1. Micro-loop refuses to proceed on an undecidable criterion (FR-L1) and emits a question card: context, question, options, default-if-unanswered (FR-N1).
2. The affected loop checkpoints and suspends; only dependent tickets pause; other lanes continue.
3. P1 answers four hours later; the loop resumes exactly at the checkpoint and completes.
**Alternates:** A1 — P1 dismisses: documented default taken + ledger row (FR-N3). A2 — the question blocks all remaining lanes: card promotes to push (idle-blocked rule, FR-N4). A3 — answer invalidates already-produced work in the same ticket: loop re-grounds (criterion + evidence re-evaluated) before continuing (FR-L1).

## UC-04 — Human edits a file the agent holds

**Actor:** P2 dev + agent. **Preconditions:** ticket in progress; its `write_scope` leases `src/auth/*`; P2 edits `src/auth/session.ts` in their own checkout.
**Main flow:**
1. UI already showed a lock badge on leased paths (FR-T6).
2. File watcher emits `conflict.detected`; the agent's loop checkpoints at its next pass boundary.
3. Agent worktree rebases onto the human edit; rebase is clean; micro-loop re-grounds and continues — **human wins** (FR-T6, Blueprint §7.3).
4. P2's edit is attributed on the activity feed and credited in coverage (FR-L4).
**Alternates:** A1 — material rebase conflict: ticket parks `blocked: human-edit conflict` with a Decide card — take mine / take agent's / merge view (FR-N2 tier Decide). A2 — P2 edits outside any lease: ordinary event, no interruption.
**Postcondition:** no lost human work, ever; agent work re-grounded or parked with evidence.

## UC-05 — Budget breaker trips at 100%

**Actor:** system + P1. **Preconditions:** per-run budget set; autorun active across 2 berths.
**Main flow:**
1. 70%: `budget.threshold_crossed` — Record tier, ledger only (FR-G4, FR-N4).
2. 85%: downshift — optional passes stop, cheaper rungs preferred; ledgered.
3. 100%: hard stop. Both berths complete or checkpoint their current ticket — never mid-ticket corruption — then no further claims; approval card raised (Decide tier).
4. P1 raises the budget or ends the run; approval resumes claiming or closes out cleanly.
**Alternates:** A1 — 100% hit while a NEVER-AUTO item is parked: item stays parked; no spend implied. A2 — P1 rejects: run ends; board shows honest remaining state (FR-L4); resume later is idempotent (FR-H3).

## UC-06 — Escalation ladder R1→R3 on a failing ticket

**Actor:** system. **Preconditions:** ticket claimed; role's chain = local-qwen → sonnet-class → opus-class.
**Main flow:**
1. R0: playbook consulted — no prior lesson (FR-M2).
2. R1: cheapest model runs the micro-loop; verify fails twice with the same gap checksum → no-progress kill (FR-L1).
3. R2: automatic, one rung up, failure receipts attached to the escalation event (FR-G3); gates fail again.
4. R3: frontier single re-run — same context-packet discipline, larger budget (FR-L5); verify exits 0; close receipt minted (FR-T2).
5. Ledger shows cost per rung; weekly report attributes exactly what escalation bought.
**Alternates:** A1 — R3 also fails: R4 blocked-with-evidence; human Decide card only when no other work (FR-G3). A2 — escalation would cross the 85% breaker: downshift policy defers R3 until human raises budget (FR-G4).
**Error:** any attempt to escalate without a failure receipt is refused (evidence-triggered only, property-tested).

## UC-07 — Onboard an existing repo

**Actor:** P2 dev. **Preconditions:** existing codebase on disk; Onboard mode (FR-P5).
**Main flow:**
1. Shipwright maps the repo: landscape, entry points, components, health assessment — each a gated, receipted artifact (FR-P1).
2. Coverage tracker enumerates the inventory (routes/tables/services); every row lands DONE or is flagged (FR-L4).
3. P2 reviews the map in the artifact viewer (FR-C3), then starts a Feature-mode mini-program on top.
**Alternates:** A1 — repo has no tests: health assessment flags it; Feature mode's decomposition adds a test-baseline ticket before feature tickets (dependency-ordered). A2 — Feature mode requested on a never-onboarded repo: refused with the fix suggested (US-106).

## UC-08 — Forge mirror reconciliation after an offline period

**Actor:** system + P3. **Preconditions:** forge mirror enabled (FR-T5, D-004); Gitea unreachable for a day while the board kept moving.
**Main flow:**
1. During the outage, lifecycle verbs queue locally in ticket `history[]` (offline-tolerant).
2. Forge returns; queued verbs flush in order under the correct identities (maker/reviewer tokens).
3. Reconciliation audit runs two-way: local→forge (unflushed verbs) and forge→local (issue edits made directly on the forge).
4. Drift report renders in the receipt inspector (FR-C5); P3 resolves any forge-side manual edits.
**Alternates:** A1 — someone closed a mirrored issue on the forge by hand: drift report flags it; the platform state is source of truth — the forge issue is re-opened with an explanatory comment (never silent adoption). A2 — token revoked mid-flush: verbs re-queue; Decide card for credential repair (FR-N2).

## UC-09 — Model fitness check rejects a model for the challenger role

**Actor:** P4 local-LLM enthusiast. **Preconditions:** LM Studio endpoint registered (FR-G1); P4 tries to set `challenger → local-qwen-8b`.
**Main flow:**
1. No fitness card exists for (local-qwen-8b, challenger); the matrix triggers the bench (FR-G6).
2. Planted-defect bench runs ~10 min of fixed tasks with known oracles (e.g. must find the planted contradiction, must refuse the citation-less claim).
3. Model confirms fabricated claims / misses planted defects → fitness card: **unfit for challenger** (fit for coding-agent noted from a prior bench).
4. Assignment refused with the fitness card cited; P4 assigns a frontier model to challenger, keeps local models on code/test roles (Hybrid preset).
**Alternates:** A1 — P4 overrides anyway: allowed but ledgered and permanently flagged in the matrix UI (FR-N3). A2 — model updated (new version string): fitness card invalidated; re-bench required before the role resumes.

## UC-10 — Decision slate + blueprint revision cycle

**Actor:** P1 founder. **Preconditions:** Phase 2 complete; blueprint synthesized with 3 open-question markers (FR-P7).
**Main flow:**
1. Three slate cards render: each 2–4 options, trade-offs, one *Recommended* (FR-P6).
2. P1 decides two, adds free-text rationale; D-IDs append to DECISIONS.md; blueprint revises (version diff visible, FR-C3).
3. Third question: P1 asks a follow-up; PM answers with a design-options research report (FR-P8) whose HIGH claims carry Challenger verdicts.
4. P1 decides; blueprint is decision-complete; the Phase 3/4 lock lifts.
**Alternates:** A1 — an agent later hits an undecided fork mid-design: it must slate, never assume — a new slate card appears and dependent design work suspends (FR-P6, FR-N1). A2 — P1 reverses a decision later: a superseding D-ID is appended (ledger is append-only); downstream docs citing the old ID are flagged stale (FR-P2 hash logic).

## UC-11 — Resume after crash (receipts / state-drift)

**Actor:** system + P2. **Preconditions:** autorun mid-build; host loses power with 2 tickets claimed, 1 mid-verify.
**Main flow:**
1. Boot runs the orphan sweep (NFR-3): no ticket may remain `running`/claimed without a live session.
2. Ticket A (close receipt already minted): re-verified from receipts, confirmed done — not redone (FR-H3).
3. Ticket B (claimed, no receipt): checkpointed pass found; loop resumes at the checkpoint; worktree intact.
4. Board projections rebuild from the event log and match pre-crash state (NFR-6).
**Alternates:** A1 — disk and receipts disagree (someone edited `gates/…receipt.json` or deleted an artifact): resume **refuses**, state-drift validator shows the human the exact discrepancy; P2 chooses re-run or repair (FR-H3, NFR-4 hash chain). A2 — worktree corrupted: ticket returns to `ready`; a fresh session rebuilds it from the HANDOFF (FR-H2).

## UC-12 — Waiver with human signature

**Actor:** P1 founder. **Preconditions:** Phase 3 gate red — one validator reports a gap P1 explicitly accepts for v1 (e.g. UX spec section deferred).
**Main flow:**
1. Advance is refused with the gap named (FR-P2).
2. P1 opens the waiver flow: gap, justification, and signature (typed human name) required.
3. Waiver receipt written; gate passes as WAIVED — visible ⚠ in the coverage report and phase receipt chain forever (FR-L4, NFR-6).
4. Downstream: the waived item stays in coverage history; W8 hardening re-surfaces open waivers before 1.0.
**Alternates:** A1 — signature is an agent identity ("coding-agent"): rejected via blocklist (FR-N3). A2 — auto mode encounters the same gate: waiver is NEVER-AUTO-adjacent — auto cannot sign; run parks the item and continues elsewhere (FR-N3, FR-H4). A3 — the underlying doc later changes: input hash changes; the waiver is scoped to the hashed input and must be re-affirmed (FR-P2).

## Coverage matrix

| UC | Primary FRs | Stories |
|----|-------------|---------|
| UC-01 | FR-P1–P7, FR-T1/T2, FR-G3, FR-H1/H4 | US-101…104, 203, 404 |
| UC-02 | FR-H4/H5, FR-N3/N4, FR-G4/G7 | US-204, 404, 703, 704 |
| UC-03 | FR-N1, FR-L1, FR-N4 | US-701 |
| UC-04 | FR-T6, FR-L4 | US-206 |
| UC-05 | FR-G4, FR-H3, FR-N4 | US-305 |
| UC-06 | FR-G3, FR-L1/L5, FR-M2, FR-T2 | US-304, 601 |
| UC-07 | FR-P5, FR-L4, FR-C3 | US-106 |
| UC-08 | FR-T5, FR-C5, FR-N2 | US-502 |
| UC-09 | FR-G6, FR-G1, FR-N3 | US-306, 301 |
| UC-10 | FR-P6/P7/P8, FR-C3 | US-103, 104, 105 |
| UC-11 | FR-H3, NFR-3/6, FR-H2 | US-205 |
| UC-12 | FR-P2, FR-L4, FR-N3 | US-407, 406 |
