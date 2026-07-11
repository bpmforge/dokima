# Source study — bpm-agent-amplifier (gate integrity, Conductor, economics)

**Question:** What integrity holes exist in honor-system agent pipelines, and what fixes were designed?
**Method:** primary-source exploration of `~/Code/bpm-agent-amplifier` (2026-07-10). Key docs: `docs/research/GATE_INTEGRITY_DESIGN.md`, `CONDUCTOR_DESIGN.md`, `TICKET_HYGIENE_DESIGN.md`, `RESEARCH_TICKET_TRACKER_BUILD_VS_ADOPT_2026-07-09.md`, `docs/research/GAP_ANALYSIS.md`.
**Feeds:** Trust & Receipts layer, Harbormaster, Forge Mirror (D-004), escalation ladder + R0 advisor (BLUEPRINT §2.2/3.3/3.6).

## 1. Program context

The amplifier program's goal: turn three separately-built agent stacks over shared local hardware + rationed frontier into one pipeline with a shared cognitive substrate (memory, playbook, nightly consolidation) and an escalation ledger proving week-over-week that local models need the frontier less. Headline gap findings:

1. **"The engine and the loop were built in separate rooms."** A full memory engine existed (hybrid retrieval, consolidation, decay, provenance) with **zero consumers** — the loop's recall anchor fired 0 times in A/B validation. *Wiring beats building.* → Shipwright's Memory Service is in-process and wired from W1 (BLUEPRINT §3.8).
2. **"Verification ahead, learning behind."** Anchored loops, challenger gates, 60+ validators matched 2026 harness-scaling practice, but every run started from the same priors — no playbook curation, no consolidation feeding the next run. → Shipwright ships the ACE playbook + sleep consolidation as W7 core, not add-ons.
3. **Sleep-time compute owned but never flipped on.** → on by default in Shipwright.

## 2. Gate-integrity audit (M27) — the twelve holes

Three parallel audits with file:line evidence, independently re-verified by a fresh-context agent (14/17 claims fully verified, zero fabricated citations). The holes, generalized:

**Layer 1 — spoofable gate machinery:**
1. Content-free gate locks (phase passes if a lock *file exists*; a `touch`ed lock is indistinguishable from a real one).
2. Retroactive lock minting (resume manufactures "passed" locks from doc-file existence).
3. Approve/bypass verbs with no scripts (approval == lock existence; waivers are prose).
4. Always-on gates that are actually opt-in ("cannot be faked" ≠ "cannot be skipped").
5. Promise-token loop completion (the loop ends when the agent *types* `<promise>COMPLETE</promise>` — self-termination by string).

**Layer 2 — self-attestation:**
6. Maker == verifier unenforced (the exact mechanism of a real incident); gate scores are printed numbers nothing reads.
7. Manifest gate schema-only (checks section headings exist; never stats claimed files, never re-runs the verify).
8. Challenger on HIGH/CRITICAL 100% prose (no script requires the report artifact).
9. Approvals ledger never verified at runtime.
10. Fix-verify closure self-asserted.

**Layer 3 — forge level:**
11. Dual-remote push unverified (CI checks one remote; fabricated evidence survives on the other).
12. No branch protection / self-merge possible (no reviewer≠author check anywhere).

**Design principles that answer them (adopted wholesale in BLUEPRINT §2.2):** *receipts not flags* (every gate emits an evidence-bearing receipt: what ran, exit codes, gap counts, input tree-hash; consumers verify receipts, not file existence); *only real runs mint receipts*; *mandatory means wired*; *truth checks over presence checks* (stat the claimed files, re-run the verify, require the artifact); *red fixtures for every gate* (a planted-defect suite proving each gate actually fails when it should — Shipwright TESTING.md carries this). Threat model: a sloppy/eager agent skipping steps, not a cryptographic adversary — receipts are tamper-evident (content+hash), which is sufficient for single-operator v1.

## 3. Conductor design (M28) → Harbormaster

**Core invariant: the conductor holds the gates, not the agents.** The agent session is untrusted; it produces work + a Completion Manifest; the conductor verifies from outside the session and flips ticket state. The graded entity never grades itself.

Loop: claim (WIP=1) → execute (fresh session per ticket, model chosen per role) → gate (scope + manifest truth + close, which re-runs the ticket's verify) → checkpoint (receipt + commit) → repeat until nothing claimable or all-blocked. Hard guards: per-ticket session counter (~2 → auto-blocked), spend ceiling halting at ticket boundary, kill-file between tickets.

**Per-role model routing** (models.json): cheap models do bulk coding/tests; frontier only reviews/challenges. Cross-model review is an *integrity feature* — coder-model ≠ reviewer-model mechanically enforces maker≠verifier.

**Escalation ladder:** cheap model's revise attempts → same ticket re-runs once on the frontier → blocked-with-evidence. Frontier spend goes only to tickets the cheap tier provably can't land; escalations recorded in receipts.

**Morning-review queue:** NEVER-AUTO items never execute in-loop; the conductor opens the PR, parks the ticket, keeps working other lanes — a morning queue instead of a stalled run. Branch protection makes self-merge physically impossible.

**Breakpoints:** ticket / wave / never. **Resume:** idempotent from receipts; refuses when state records and disk disagree.

All of the above is the Harbormaster's specification (BLUEPRINT §3.6), plus Shipwright's D-010 extension: N parallel berths, one per lane.

## 4. Ticket lifecycle integrity (M26)

Born from a real incident: an executor skipped claim/comment/close on a run and the audit trail was lost — root cause, honor-system lifecycle. Fixes: enforced six-verb transition graph, schema v2 (history[], evidence, claimed_at), WIP=1, close-before-next-claim, and a **reconciliation tool** grading every ticket VERIFIED / UNVERIFIED / ORPHAN-CODE against manifests, gate results, and git history. Shipwright inherits the verbs natively (FR-T1/T2) and the reconciliation audit for the forge mirror (FR-T5).

## 5. Forge-as-ledger research (build vs adopt)

Weighted comparison (Gitea-ledger 8.6, beads 7.8, plan.json-only 7.5, build-own 7.4, Plane/OpenProject 6.8). Core insight: tracing failures are a **trust-boundary problem, not a tracker-feature problem** — any store inside the executing agent's write scope is honor-system *by construction*; the scribe is the suspect. What Jira actually sells is a server-side ledger with enforced transitions behind per-identity credentials — and a self-hosted forge already provides it.

Adopted architecture (BLUEPRINT §3.4 Forge Mirror): planning/contract layer stays native (plan-style schema — no surveyed tool has write-scope/lane semantics); lifecycle mirrors to forge issues under **per-identity machine tokens** (executor token cannot impersonate reviewer; reviewer token held only by the conductor); enforcement checks the forge API, not repo files (WIP=1 = "executor identity has ≤1 assigned open issue"; maker≠verifier = closing identity ≠ accepting identity). Offline: verbs queue locally, flush when reachable. Alternatives rejected: beads (its own docs say "no workflow enforcement, relies on agent discipline" — the failure class being fixed), heavyweight PM suites (ops weight, no enforcement gain), building a ledger (rebuilding a forge's API with fewer eyes).

## 6. Advisor economics (M30, on branch)

Cheapest-model-by-default with the frontier as a rationed advisor; **memory as the first-line advisor** (consult playbook/facts before any model call); a rung ladder for spend. Productized as escalation rung R0 and the role-matrix guards (BLUEPRINT §3.3).

## Shipwright takeaways

1. Every M27 hole maps to a Shipwright control: receipts (SC: no flags), out-of-session gates, manifest truth-checks, challenger artifact requirement, runtime ledger validation, branch protection + reviewer≠author, remote-parity validator, and a red-fixture test suite proving gates fail when attacked.
2. The Harbormaster is the M28 Conductor, generalized with berths (D-010).
3. The Forge Mirror is the Gitea-ledger design, forge-agnostic (D-004).
4. The economics (R0 advisor, cheap-first ladder, escalation ledger) are first-class product features with UI, not scripts.
