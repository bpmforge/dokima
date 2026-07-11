# Shipwright — User Stories

Traces to `docs/SRS.md` (FR/NFR IDs), `docs/BLUEPRINT.md` §1.2 personas, and
`docs/DECISIONS.md` (D-001…D-010). Points: Fibonacci (1/2/3/5/8).

Personas: **P1 Solo builder** (idea, no team) · **P2 Professional dev** (discipline without
ceremony) · **P3 Small team lead** (one surface for humans + agents) · **P4 Local-LLM
enthusiast** (max work from owned hardware, receipts proving the cheap tier is honest).

## Epic E1 — Guided program (interview → blueprint → decisions) [W5]

### US-101 Idea intake interview — 5 pts — FR-P3, FR-P1
As P1, I want to describe my idea in plain English and be interviewed like a good PM, so that VISION/SCOPE/SRS get written with me rather than at me.
- AC-1: Interview adapts question depth to my answers; I can skip and return
- AC-2: Drafted deliverables appear in the artifact viewer as I answer
- AC-3: Phase 0–2 gates mint receipts only after validators actually run

### US-102 Edit any deliverable, honestly — 3 pts — FR-P3, FR-P2
As P2, I want to edit any phase document at any time and see exactly which downstream receipts my edit invalidated, so that the pipeline never runs on silently stale inputs.
- AC-1: Post-gate edit flags the gate receipt stale, naming the changed file
- AC-2: Advancing past a stale receipt is refused until re-validation or a signed waiver
- AC-3: Version history + inline diff available for every deliverable (FR-C3)

### US-103 Decision slates — 5 pts — FR-P6
As P1, I want founder-owned forks presented as 2–4 option cards with trade-offs and a recommendation, so that I decide the product's shape without being an architect.
- AC-1: Slate card shows options, trade-offs, one *Recommended* with reasoning
- AC-2: My choice + rationale lands in `docs/DECISIONS.md` with a stable D-ID
- AC-3: Downstream docs cite D-IDs; an agent hitting an undecided fork slates it, never assumes

### US-104 Blueprint stage with hard lock — 5 pts — FR-P7
As P1, I want a condensed blueprint with an Open Questions section that blocks detailed design until I've answered everything, so that one 20-page review prevents a hundred mis-aimed tickets.
- AC-1: Blueprint synthesized after Phase 2 with slate cards per open question
- AC-2: Phases 3–4 refuse to start while any unresolved founder-decision marker remains
- AC-3: Each answer cycle produces a revised blueprint version with diff

### US-105 Cited research on demand — 5 pts — FR-P8
As P2, I want per-phase research (market, feasibility, design-options, build-vs-adopt) with per-claim citations and selectable depth, so that decisions cite verified facts, not model vibes.
- AC-1: quick/standard/deep depth selectable per research task
- AC-2: HIGH-impact claims carry a Challenger verdict before any slate may cite them
- AC-3: Confirmed findings are retrievable from the R0 fact bank in later phases

### US-106 Four modes — 3 pts — FR-P5
As P2, I want to point Shipwright at an existing repo (Onboard/Feature/Improve) as easily as starting a new product, so that the platform fits my real backlog, not just green fields.
- AC-1: "What are we doing today?" offers all four modes at v1
- AC-2: Feature mode refuses on a repo that was never onboarded, with the fix suggested
- AC-3: Onboard produces landscape/entry-point/component docs as gated artifacts

### US-107 Guided first fifteen minutes — 3 pts — FR-C6
As P1, I want a built-in sample idea that runs the whole program in miniature, so that I see interview → gates → board → morning queue before risking my own idea.
- AC-1: Sample program completes end-to-end on local-or-cheap models from a fresh install
- AC-2: The guided flow visits every major surface and explains each gate as it passes

## Epic E2 — Ticket board & build [W0/W3/W4]

### US-201 A board that cannot lie — 5 pts — FR-C4, FR-T1, NFR-6
As P3, I want the Kanban board to be a live projection of execution state, so that what the team sees is what is actually happening.
- AC-1: Card movement ≤1s after the underlying event; no manual refresh
- AC-2: Stale-blocked badges, claim-now strip, spend meter, active-agents heartbeat strip present
- AC-3: Rebuilding projections from the event log reproduces the board exactly

### US-202 Humans and agents share the same verbs — 3 pts — FR-T4, FR-T1
As P3, I want my drag-and-drop to fire the same lifecycle verbs with the same invariants as agent actions, so that no one — human or agent — can bypass discipline.
- AC-1: Illegal drag (unmet deps, WIP=1 violation, missing receipt) snaps back with the rule shown inline
- AC-2: A legal human close mints the same close receipt an agent close would
- AC-3: WIP=1 per actor enforced on claim for humans and agents alike

### US-203 Editable ticket DAG before build — 5 pts — FR-T1, FR-T3
As P2, I want the decomposed ticket DAG rendered live (Mermaid) and editable — split/merge/re-prioritize — before autorun starts, so that I shape the build without hand-editing JSON.
- AC-1: DAG renders in the artifact viewer; claimable set recomputes on every edit
- AC-2: An edit creating a same-lane write-scope overlap is refused as a schema error
- AC-3: Acceptance criteria and `verify` commands visible and editable per ticket

### US-204 Berths + autorun — 5 pts — FR-H5, D-010
As P3, I want a concurrency dial (berths 1–N) and a single autorun toggle, so that "run the board with 3 workers and show me the morning queue" is one gesture.
- AC-1: N berths never work the same lane; each has its own worktree and identity
- AC-2: Autorun = breakpoint `never` × berths N; landing stays serialized through review
- AC-3: Budget breakers aggregate across berths and halt at ticket boundaries

### US-205 Pause and provably resume — 3 pts — FR-H3, NFR-3
As P1, I want one pause button that finishes the current ticket, checkpoints, and stops — and a resume that re-verifies rather than redoes, so that stopping is never scary.
- AC-1: Pause lands at a ticket boundary with receipts written
- AC-2: Resume after crash re-verifies claimed-unclosed tickets from receipts; zero duplicate work
- AC-3: Resume refuses on state drift (log vs receipts vs disk) and shows the discrepancy

### US-206 Human edits win — 5 pts — FR-T6
As P2, I want to edit a file an agent currently holds and have the platform handle it (human wins, agent re-grounds), so that I never wait for a robot to finish before fixing something myself.
- AC-1: Leased paths show a lock badge before I collide
- AC-2: My edit emits `conflict.detected`; the agent rebases and re-grounds on a clean rebase
- AC-3: A material conflict parks the ticket with a take-mine / take-agent's / merge card
- AC-4: My edit is attributed on the activity feed and credited in coverage

## Epic E3 — Model economics (matrix / ladder / budgets / fitness) [W2]

### US-301 Model-to-role matrix with presets — 5 pts — FR-G2
As P4, I want a role×task-type model matrix with All-local / Hybrid / All-cloud presets, so that wiring my hardware into every role takes minutes, not an evening.
- AC-1: Every (role, task-type) resolves to a model + fallback chain
- AC-2: Maker model ≠ reviewer model by default; overriding is explicit and ledgered
- AC-3: Presets apply atomically and are editable per cell afterward

### US-302 Corporate credentials day one — 5 pts — FR-G1, D-007
As P2 (corporate), I want to sign in with my employer's Copilot subscription or point at our Vertex project during first-run onboarding, so that Shipwright slots into credentials I already have.
- AC-1: Copilot device-auth flow completes in onboarding, not buried in advanced settings
- AC-2: Vertex ADC / service-account JSON + region + project ID accepted and validated
- AC-3: Both providers appear in the matrix with discovered models

### US-303 Local endpoints first-class — 3 pts — FR-G1, NFR-1
As P4, I want LM Studio/Ollama/OpenAI-compatible endpoints with warm-up, queueing, and $0-but-metered accounting, so that owned hardware is a first-class citizen, not a hack.
- AC-1: Cold local model warm-up ping fires before first real call
- AC-2: Single-slot local endpoints queue transparently instead of erroring
- AC-3: Local calls write token-metered $0 ledger rows feeding velocity stats

### US-304 Evidence-triggered escalation ladder — 5 pts — FR-G3
As P4, I want every ticket to start at R0/R1 and climb only on receipted gate failure, so that I can prove which tickets actually needed the frontier and what it cost.
- AC-1: Escalation events carry the triggering failure receipt
- AC-2: A passing ticket can never escalate (no vibes-triggered spend)
- AC-3: Ledger answers per ticket: rungs climbed, cost per rung, where it resolved

### US-305 Budget breakers — 3 pts — FR-G4
As P1, I want 70/85/100% circuit breakers per run and per project, so that an overnight run can never bill past the ceiling I set.
- AC-1: 70% = silent ledger row; 85% = downshift (optional passes stop, cheaper rungs preferred)
- AC-2: 100% = hard stop at a ticket boundary + approval card; no mid-ticket corruption
- AC-3: Breakers apply across all berths in aggregate

### US-306 Model fitness cards — 5 pts — FR-G6
As P4, I want a 10-minute planted-defect bench before a model may hold a role, so that I never assign my local model a role it can't hold and then blame the platform.
- AC-1: Bench mints a fitness card per (model, role) with pass/fail per fixture task
- AC-2: Assigning an unfit model is refused with the fitness card cited
- AC-3: Explicit override possible, ledgered, and flagged in the matrix UI

### US-307 Dry-run cost estimate — 3 pts — FR-G7
As P1, I want a pre-autorun estimate ("this board ≈ $4.10 on your matrix; $0.60 if review drops to Sonnet"), so that cheap-first economics are visible before spend, not after.
- AC-1: Estimate per wave from ticket sizes × matrix × historical actuals, assumptions shown
- AC-2: What-if on a matrix change recomputes deterministically

### US-308 Soft gates for weak models, never on code — 3 pts — FR-G5
As P4, I want doc-phase gaps my small model can't close to be waived-and-recorded so momentum continues, while build gates never soften, so that weak-model runs are honest, not fake-green.
- AC-1: Doc-phase (0–3) waived gaps render ⚠ in the coverage report with attribution
- AC-2: Any soft-waiver attempt on a build/verify gate is rejected at the API level
- AC-3: Weak-model runs get larger iteration budgets and prescriptive gap prompts

## Epic E4 — Trust & review (receipts, morning queue, challenger) [W0/W3/W5]

### US-401 Every claim opens its receipt — 3 pts — FR-C5, NFR-6
As P2, I want every "done"/"passed" element in the UI to click through to a structured receipt, so that trust is inspectable, never asserted.
- AC-1: Gate receipts, coverage reports, challenge reports, ledger rows render as structured views
- AC-2: A UI completion claim with no backing receipt is a test failure (claim-walker)

### US-402 Close is load-bearing — 5 pts — FR-T2, FR-H1
As P2, I want `close` refused unless the manifest exists, `verify` exits 0, and commits are attached — re-checked from outside the agent session, so that "the AI said it's done" is dead.
- AC-1: Fabricated manifest (files don't stat, verify fails) refused with reasons
- AC-2: Agent sessions hold no credential capable of mutating ticket state
- AC-3: The completion signal is never a typable string (no promise-token path exists)

### US-403 Maker ≠ verifier, mechanically — 3 pts — FR-T2, FR-G2
As P3, I want accept to require a different identity (and by default a different model) than the maker, so that self-review is impossible rather than discouraged.
- AC-1: Self-accept refused even for a human owner
- AC-2: With forge mirror on, maker and reviewer act under separate scoped tokens (FR-T5)
- AC-3: Accept refused unless the manifest embeds the close receipt verbatim

### US-404 The morning queue — 5 pts — FR-H4, FR-N4
As P3, I want a night of autonomous work reviewable in ten minutes: one screen, sorted by leverage, each card decision-shaped with receipts inline, so that HITL respects my attention.
- AC-1: Order: merges → approvals → clarifications → FYI digests
- AC-2: Each card: one-line summary, diff-stat/artifact link, receipts, Approve/Reject/Ask
- AC-3: NEVER-AUTO items were prepared (PR opened, release staged) but never executed

### US-405 Challenger veracity gate — 3 pts — FR-P4
As P2, I want HIGH/CRITICAL findings and unverified design claims independently challenged with per-claim verdicts, so that confident nonsense doesn't ship.
- AC-1: CHALLENGE_REPORT shows CONFIRMED / CONTRADICTED / UNVERIFIABLE per claim with citations
- AC-2: A challenge without a citation is discarded, never treated as a contradiction
- AC-3: CONTRADICTED forces a revision HANDOFF to the originating agent

### US-406 Honest coverage — 3 pts — FR-L4
As P2, I want every expected unit of work to end in exactly one visible state (DONE/WAIVED/BLOCKED/FAILED/SKIPPED), so that nothing is ever silently dropped.
- AC-1: COVERAGE_REPORT is a phase-gate input; a SKIPPED row blocks the gate
- AC-2: WAIVED rows carry who waived and why, permanently visible in history

### US-407 Waivers need a human name — 2 pts — FR-P2, FR-N3
As P1, I want gate bypasses to require my signed waiver receipt, so that shortcuts are mine to take and always on the record.
- AC-1: Waiver requires a human name; agent identities rejected via blocklist
- AC-2: Waiver receipt appears in coverage history and the phase receipt chain

## Epic E5 — Integrations (forge / MCP / git) [W0/W6]

### US-501 Worktree + branch + PR per ticket — 3 pts — FR-I1
As P2, I want each ticket built in an isolated worktree on `sw/<id>-<slug>` with explicit-path commits and its own PR, so that agent work never touches my checkout and lands reviewably.
- AC-1: No agent write ever lands outside its ticket worktree/write-scope
- AC-2: Commits staged by explicit path; `add -A` absent by construction (lint gate)
- AC-3: Branch protection on connect: reviewer≠author, no force-push, required checks

### US-502 Forge mirror as audit ledger — 5 pts — FR-T5, D-004
As P3, I want tickets mirrored to GitHub/Gitea issues with maker/reviewer machine identities writing through lifecycle verbs, so that the forge timeline is an append-only audit trail outside every agent's reach.
- AC-1: claim/evidence/close/accept map to assign/comment/state/reviewer-comment under the right identity
- AC-2: The reviewer token never enters an agent session (asserted, not promised)
- AC-3: Offline verbs queue in `history[]` and flush in order; drift report reconciles two-way

### US-503 MCP tools under policy — 5 pts — FR-I3
As P2, I want to register MCP servers per project and control which agent roles may call which tools, so that agents get capabilities without getting my machine.
- AC-1: Per-role allowlists; unlisted tools invisible to the role
- AC-2: Side-effectful tools park a `requiresApproval` card before execution
- AC-3: Every tool call is an audited, costed, replayable event

### US-504 Dual-remote parity — 2 pts — FR-I2
As P4, I want native dual-remote sync (e.g. Gitea origin + GitHub) with a parity validator, so that my self-hosted forge and GitHub never silently diverge.
- AC-1: Push targets both remotes; parity validator flags divergence as a gate gap

### US-505 Sandboxed verify — 3 pts — FR-I4, NFR-4
As P3, I want verify commands and test suites to run in a restricted sandbox (no network by default; container optional), so that receipts attest to controlled runs, not whatever the agent felt like executing.
- AC-1: Default test-run profile blocks network egress (asserted in CI)
- AC-2: Receipts record the sandbox profile used

## Epic E6 — Memory & learning [W7]

### US-601 The playbook pays rung zero — 5 pts — FR-M2, FR-G3
As P4, I want verified lessons distilled into a playbook consulted before any model call, so that problems we've solved stop costing tokens.
- AC-1: Only tool/challenger-confirmed lessons are stored (verified-before-stored)
- AC-2: An R0 playbook hit resolves a repeated task with a $0 ledger row
- AC-3: Playbook entries are delta-edited, never wholesale replaced

### US-602 Error-first recall — 3 pts — FR-M3
As P2, I want prior failures and their fixes injected before an agent retries that task class, so that the crew doesn't re-discover last week's landmine.
- AC-1: Packet for a previously-failed task class leads with the error→fix pair
- AC-2: Recall events are visible in the session provenance

### US-603 Sleep-time consolidation — 3 pts — FR-M3
As P1, I want idle-hours consolidation (dedupe, decay, pre-brief) on by default, so that memory compounds without me operating it.
- AC-1: Scheduled job dedupes/decays and can be toggled off per project
- AC-2: Morning queue includes the pre-brief when the job ran overnight

### US-604 Memory offline — 2 pts — FR-M1, NFR-1
As P4, I want hybrid retrieval that falls back to BM25 when embeddings are unavailable, so that memory works on an air-gapped box.
- AC-1: Full retrieval suite passes with embeddings disabled
- AC-2: Assembled memory context respects the token budget for small local models

## Epic E7 — Notifications & HITL [W3/W4]

### US-701 Clarifications that don't stall the world — 5 pts — FR-N1
As P1, I want an agent's question to suspend only the work that depends on the answer — resumable exactly at the checkpoint even hours later, so that one ambiguity never parks the whole run.
- AC-1: Question card carries context, the specific question, options, and default-if-unanswered
- AC-2: Non-dependent lanes keep working; answer resumes at the recorded checkpoint
- AC-3: Dismissal takes the documented default and writes a ledger row

### US-702 Risk-classed approvals — 3 pts — FR-N2
As P3, I want approval cards classed by rule-first risk (deploy/main-merge/destructive/escalation/budget) that models can raise but never lower, so that the risky stuff always reaches me.
- AC-1: Rule fixtures classify deterministically (branch==main, destructive patterns, prod markers)
- AC-2: Model-suggested downgrade is ignored; upgrade honored

### US-703 Autonomy dial + ledger — 3 pts — FR-N3
As P4, I want an interactive/auto dial where auto takes documented defaults into a machine-parseable ledger, with the NEVER-AUTO list visibly immutable, so that unattended runs are accountable, not reckless.
- AC-1: Every auto-taken default appends a ledger row (pause-site, default, what would've been asked)
- AC-2: NEVER-AUTO list is non-editable in-product; NEVER-AUTO rows require a human signature
- AC-3: The ledger itself is validated at runtime

### US-704 Notifications that respect attention — 3 pts — FR-N4
As P3, I want the Decide/Review/Record taxonomy enforced in code — Record never pops, Review batches, Decide promotes to push only when the run is idle-blocked, so that alert fatigue is a design impossibility.
- AC-1: Emitting an unclassified notification is an API-level error
- AC-2: A full fixture run produces zero pops from Record-tier events
- AC-3: Quiet hours hold push while the run continues under auto policy

## Epic E8 — Fleet, settings & content [W0/W1/W4/W7]

### US-801 Fleet home for many programs — 5 pts — FR-F1, FR-F2, FR-F4, D-013
As P3, I want the app to open on a portfolio of project cards (phase, board stats, berths + heartbeats, pending Decide count, spend today) with one aggregated inbox, so that running several programs at once is the normal case, not a hack.
- AC-1: One live card per project; injected events update the right card ≤1s
- AC-2: Notification center + morning queue aggregate across projects, leverage-sorted, filterable per project
- AC-3: Each project's state lives in `.shipwright/state.db` beside its repo — moving the directory moves the project; archiving is closing a folder
- AC-4: No memory fact, calibration stat, receipt, or budget ever crosses projects (isolation walker)

### US-802 First-run wizard — 3 pts — FR-S4, FR-C6, D-012
As P1, I want first run to be: pick a preset → register one provider (or point at LM Studio) → optionally connect a forge → watch the guided sample project, so that I'm productive in fifteen minutes without reading docs.
- AC-1: All three preset paths (All-local / Hybrid / All-cloud) complete the wizard
- AC-2: Forge step is skippable first-class; wizard exit hands off to the FR-C6 sample program
- AC-3: Wizard-written config lands in the correct scopes (global vs project)

### US-803 Settings I can commit — 3 pts — FR-S1, FR-S2, FR-S3
As P1, I want run > project > global settings with secrets only in the OS keychain, so that I can commit `.shipwright/settings.json` to share my matrix and autonomy policy without leaking keys.
- AC-1: Effective-settings inspector shows the winning scope for any key ("why is this role on this model?")
- AC-2: Secret-scan of both settings files finds refs only, never secrets; a missing keychain entry fails loudly by named ref, never a plaintext fallback
- AC-3: Every settings change is an audited `settings.changed` event (actor, scope, old→new)

### US-804 Promote a lesson to the global playbook — 3 pts — FR-F5, FR-M2
As P4, I want project lessons kept local by default with explicit, provenance-carrying promotion to a global playbook, so that a library trap learned in one project pays R0 everywhere — without one project's conventions silently leaking into another.
- AC-1: Unpromoted lessons are invisible to other projects
- AC-2: Promotion is an explicit human- or reviewer-gated action; never automatic; provenance stamped
- AC-3: A promoted entry hits at R0 in a second project with a $0 ledger row

### US-805 Two autoruns, one LM Studio box — 5 pts — FR-F3, FR-G1
As P4, I want the global gateway pool to schedule fairly across projects and a governor to cap total berths, so that two overnight autoruns share my one inference host instead of thrashing it.
- AC-1: Two autorunning projects on a one-slot endpoint interleave without starvation (request-order assertion)
- AC-2: Global governor at N caps summed active berths across all projects at N
- AC-3: Providers/credentials registered once globally are usable from every project

### US-806 The whole expert crew, extensible — 3 pts — FR-E1, D-011, D-006
As P2, I want the entire expert library (coordinators, specialist clusters + synthesizers, Challenger, 66+ validators, shared protocols) in the box with provenance headers, plus the ability to add my own experts per project, so that nothing is paywalled and my domain specialist is a markdown file away.
- AC-1: Import-manifest test proves every roster entry from the source snapshot exists under `content/`
- AC-2: A project-level custom expert (markdown + frontmatter) loads without core changes and is dispatchable via HANDOFF
- AC-3: Expert overrides resolve through settings scopes (FR-S1)

## Summary

| Epic | Stories | Points |
|------|---------|--------|
| E1 Guided program | 7 | 29 |
| E2 Ticket board & build | 6 | 26 |
| E3 Model economics | 8 | 32 |
| E4 Trust & review | 7 | 24 |
| E5 Integrations | 5 | 18 |
| E6 Memory & learning | 4 | 13 |
| E7 Notifications & HITL | 4 | 14 |
| E8 Fleet, settings & content | 6 | 22 |
| **Total** | **47** | **178** |

Persona coverage: P1 ×12 (101, 103, 104, 107, 205, 305, 307, 407, 603, 701, 802, 803) ·
P2 ×14 · P3 ×10 · P4 ×11.
Every FR family in SRS §2 — including FR-S/FR-F/FR-E — is exercised by ≥1 story; FR→story
mapping is greppable by ID.
