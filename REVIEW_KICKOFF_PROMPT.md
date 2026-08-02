# Dokima — Full-System Review & Hardening Kickoff (the RepoPulse Method)

**For: a fresh Claude Code session opened in `~/Code/dokima`.**
Written 2026-07-14, immediately after completing this exact arc on `~/Code/repopulse`
(branch `review/design-review-preflight` — that branch is your exemplar; crib its
artifacts, don't reinvent them). Brad will say "read REVIEW_KICKOFF_PROMPT.md and go" —
this file is your complete instruction set.

---

## 0. What you are doing, and what you are NOT doing

You are running a **multi-domain design review and hardening pass** over Dokima's
existing design package and ticket board, ending with a board so complete, contradiction-
free, and machine-validated that inexpensive coding agents can execute it wave-by-wave
with quality gates. On RepoPulse this arc took a 44-ticket board to 89 tickets / 415 pts
with 122/122 requirements and 65/65 stories machine-traced and zero dangling references.

You are **NOT**:
- Resuming the build. Dokima's build is **deliberately paused** (docs/RELEASE_TRACKER.md)
  until bpm-opencode-experts v2.1.0 ships. Do not run the conductor, do not claim/code
  tickets, do not touch `scripts/supervise.sh`. This is docs + board work only.
- Re-litigating founder decisions. `docs/DECISIONS.md` (D-001…D-013) is locked, like
  RepoPulse's D1–D8. Changes to locked decisions are **amendments Brad approves** — you
  propose, you never silently adopt.
- Launching a second conductor or heavy parallel work. One Claude account; the
  RELEASE_TRACKER records that parallel conductors halved throughput. Max 3 parallel
  research/explore agents, and only for reading/research.

## 1. Load order (before anything else)

1. `CLAUDE.md` (this repo's laws) → `MASTER_PROMPT.md` → `PLAYBOOK.md`
2. `docs/BLUEPRINT.md` + `docs/DECISIONS.md` — the locked foundation
3. `docs/RELEASE_TRACKER.md` — the pause rationale + fix plan F1–F4 (you will fold
   these into the board)
4. `docs/STATUS.md` end-to-end + `docs/CONDUCTOR_FIELD_REPORT.md` +
   `docs/design/FINDING_LOOP_POLICY.md` — **Dokima has real build telemetry that
   RepoPulse never had. Mine its own field lessons first; they outrank generic advice.**
5. The full docs/ tree (SRS, ARCHITECTURE, DATABASE, API_DESIGN, SCOPE, NON_GOALS,
   RISKS, ROADMAP, SECURITY_CONTROLS, TECH_STACK, design/*, research/*) + `plan.json`
6. The exemplar artifacts in `~/Code/repopulse` (read-only — formats to crib):
   - `docs/work/DESIGN_REVIEW.md` — the gap-register format (G-x: severity, evidence,
     resolution, status fixed/ticketed/open)
   - `docs/work/UX_AGENTS_IMPROVEMENT_PLANS.md` — recommendation-index format (R-x-n,
     effort, wave, needs-amendment column) + the adoption banner pattern
   - `scripts/validate-traceability.mjs` + `scripts/validate-plan.mjs` (stories field)
   - `PLAYBOOK.md` §"Wave-gate coverage loop (Ralph Wiggum) + challenger"
   - `docs/ARCHITECTURE.md` §4f–4i sequences + ADR-8..12; `docs/design/SECURITY_SUITE.md`
     §3.6 (the VEX pattern); `docs/design/IMPROVEMENT_PLANS.md`; `CODE_HEALTH_SUITE.md`
     §8 (rule lifecycle/shadow mode)

## 2. The end state (long-tail vision — keep this in view the whole time)

Brad's target across all bpmforge products is the same compounding system:

1. **Design packages so decision-complete that cheap models execute them.** Every doc
   written for an inexpensive agent: IDs everywhere, tables over prose, worked examples
   with hand-computed arithmetic, canonical JSON shapes to copy, a known-traps list,
   no decision left to the executor.
2. **Traceability as a machine property, not a spreadsheet.** Decision → scope → FR/NFR
   → story → ticket → design-doc section → commit, validated BOTH directions in CI;
   dangling references hard-fail; coverage gaps print as GAP-step input.
3. **Quality loops in the process AND in the product.** Process: wave gates run
   INVENTORY→VERIFY→GAP (cap 3, no-progress halt) then a CHALLENGER (fresh agent,
   maker≠verifier, "re-ran independently: command/counts/exit-code" evidence,
   CONTRADICTED reopens tickets). Product: Dokima literally *is* this loop
   productized — its v1.0.0 milestone is auditing itself. Every hardening you make to
   the process is a candidate product feature and vice versa.
4. **Rules-first, LLM-second.** Deterministic catalogs/validators are the source of
   truth; LLMs order, narrate, draft, propose — never invent, activate, or dismiss.
   Every surface must work with zero LLM calls; LLM output is data, never executed.
5. **Trust economics.** False-positive noise is the #1 product killer (RepoPulse RISKS
   R-4; Dokima's finding-loop policy is the same insight). Every detector/gate
   gets: measured FP rates, shadow modes for new rules, justification-gated suppression
   (the VEX pattern), maker≠verifier passes, and honest raw-vs-effective counts.

## 3. The arc — run these passes IN ORDER (STOP = ask Brad before continuing)

Work on a feature branch (`review/design-review-hardening`), commit per pass, push both
remotes (`git push origin <branch> && git push github <branch>` — origin/Gitea may be
unreachable off-LAN; GitHub always; note unsynced state in STATUS.md if so).

**P1 — Full design review → gap register + pre-flight fix pack.**
Read everything (~all docs + plan.json). Produce `docs/work/DESIGN_REVIEW.md` with:
modularity assessment (are boundaries machine-enforced or aspirational?), persona/user
journeys walked as *processes* (gaps live BETWEEN screens/steps: day-0 setup, daily
loop, weekly ritual, the paused-build resume journey), customization surfaces
(model adapters, gate configs, expert-library import, forge integrations), licensing
ledger (§5 burn list), and the gap register. Then APPLY the fix pack: contradictions
fixed in docs, missing tickets added, validators green. RepoPulse found 18 gaps at this
pass; expect a different mix here because the build already ran — Dokima's gaps
will skew toward spec-vs-built drift (compare code in apps//packages/ against docs
claims for the 23 landed tickets).

**P2 — Domain interrogations.** Run each of these as its own focused pass (research
agents where noted). These are the questions Brad asked on RepoPulse, generalized —
ask ALL of them of Dokima and add domain-specific ones:
- *Process/UX*: does the UX hold up walked persona-by-persona? Where does a number/
  status dead-end without an action? What brings the user back daily?
- *Micro-agent & loop architecture*: mine `~/Code/bpm-opencode-experts`
  (agents/shared/{MICRO_LOOP,RALPH_WIGGUM_LOOP,GATE_SCORING_PROTOCOL,FIX_VERIFY_LOOP,
  CHALLENGER_PROTOCOL}.md) — Dokima productizes these, so check the PRODUCT spec
  implements what the library preaches: hard caps, no-progress halts, maker≠verifier,
  oscillation zero-tolerance, decomposition-on-ceiling. FINDING_LOOP_POLICY.md already
  started this — verify it's threaded into SRS/tickets, not just a doc.
- *Reports → action*: what is Dokima's "improvement plan" equivalent? (Runs produce
  receipts/findings — do they compose into ranked, auto-verified action queues?)
  Web-research competitors' insight-to-action mechanics if useful (cite everything;
  mark UNVERIFIED).
- *False-positive economics* (Brad WILL push on this — RepoPulse's was SBOM CVEs):
  Dokima's FP surface is **gate findings and review verdicts**. Design the
  validation funnel + justification-gated suppression + measured-FP-rate promotion/
  demotion for gate rules. The VEX pattern (SECURITY_SUITE.md §3.6) generalizes:
  dedup → scope → reachability/applicability → effective-risk → propose-never-auto-
  dismiss → justified suppression that reopens when evidence changes.
- *Code health/anti-slop*: the 30-rule taxonomy + lifecycle already exists in the
  expert library and in RepoPulse's CODE_HEALTH_SUITE. Dokima SHIPS these as
  product content (`content/`) — verify content coverage (the "name ALL of the set,
  not four examples" lesson in STATUS.md 2026-07-12), rule provenance/licensing, and
  whether the product exposes the rule lifecycle (shadow mode, FP-gated promotion).
- *Extensibility*: can users add rules/experts/gates/model-adapters without core
  changes? Registry + adapter contracts + license-gated intake, deny-by-default.
- *Core-brain audit*: RepoPulse's was forge intake; Dokima's is the
  **conductor loop + gate execution + model gateway/ladder + trust core (hash chain,
  receipts, Harbormaster write-scope enforcement)**. Walk it end-to-end against the
  field reports: is every failure mode in the docs' failure table? Is the W1-07
  symlink-escape class (lexical vs realpath containment) systematically closed
  everywhere paths are trusted?
**STOP after P2**: present recommendations (R-x index with effort/wave/needs-amendment)
and the proposed decision amendments. Brad adopts/rejects; only then thread.

**P3 — Adoption threading.** For each adopted amendment: DECISIONS/BLUEPRINT row →
SCOPE items → SRS FR/NFR rows (with acceptance sketches) → design doc (new or §) →
DATABASE deltas → stories/epics → ROADMAP wave + exit criteria → plan.json tickets.
Never skip a link; the validator will catch you.

**P4 — Architecture completion (Part 1).** Sequence diagrams for every adopted
subsystem (RepoPulse pattern: one mermaid per flow — quality loop, plan lifecycle,
validation funnel, dispatch+shadow), ADRs for every load-bearing decision with a
"Rejected:" line, failure-modes table rows for every new moving part, lifecycle
stateDiagrams in the design docs. Then build/adapt `scripts/validate-traceability.mjs`
(hard-fail dangling refs: ticket→doc, ticket→FR, ticket→story, story→FR, SRS→S,
SCOPE→D; write_scope deliverables exempt; slash-compound citations like FR-X-5/6
expand). Run the Ralph Wiggum loop over the design package itself until it converges
(cap 3). Codify the wave-gate loop + challenger protocol in PLAYBOOK.md if the current
one lacks them (Dokima's may already — verify rather than duplicate;
FINDING_LOOP_POLICY may supersede parts).

**P5 — Board completion (Part 2).** Add validated `stories: []` linkage to every
ticket (bulk-edit via one node script, never N hand-edits; FR-intersection derivation
+ manual overrides where intersection lies). Then run a **CHALLENGER completeness
pass**: a fresh agent (never you summarizing yourself) mandated to REFUTE the board —
find doc-mandated deliverables no ticket owns. Close every confirmed gap. Also fold in
**RELEASE_TRACKER F1–F4** as board changes: split W3-01 → a/b/c (≤3 pts each, per the
decomposition policy), mark the trust-core lane human-pair-required, add the
v2.1.0-resync precondition as a ticket/gate note, pull W3-08/09 early.

**P6 — Gate entry + readiness report.** STATUS.md gate section with "re-ran
independently" evidence for every validator; final chat report: what changed, open
decisions for Brad, and the exact resume sequence for the build.

## 4. Method laws (non-negotiable)

1. **Contradiction hunt before anything else.** Cross-doc mismatches burn cheap agents
   first: module placement, enum vocabularies, severity/confidence scales, table names,
   status-lifecycle words, queue names. Pick ONE canonical value, fix every doc, note
   supersessions inline.
2. **Every security control needs a ticket home.** Walk SECURITY_CONTROLS (or
   equivalent): each SC that says "lands in wave X" must appear in some ticket's
   acceptance. RepoPulse had four orphaned controls; the challenger found more.
3. **The missing-ticket classes** (check every one): human prerequisites (app/API
   registrations — the ONLY human steps, make them explicit tickets); settings/admin
   UI for every config the docs mention; ops lifecycle (retention sweeps, healthz +
   metrics registry, backups + EXECUTED restore drill, container hardening, DB grants,
   nightly CI schedules); test harness + seed tooling; share/permalink endpoints
   (RepoPulse rate-limited routes nobody built); identity/attribution edge cases.
4. **Acceptance criteria that NAME examples get the examples, not the set.** Say "ALL
   of X" (Dokima learned this the hard way — STATUS 2026-07-12 content gap-fill).
5. **No dependency chokepoints.** No single ticket that everything in a wave depends
   on (W3-01 idle-exited the whole run). Ceiling-while-progressing = split the ticket.
6. **Licensing ledger per dependency**, with actions not vibes: Redis ≥7.4 is
   RSAL/SSPL (pin 7.2/Valkey); AGPL tools (TruffleHog) = format-compatible, never
   vendored; semgrep registry rules have a no-compete clause (own rules or Opengrep
   for SaaS); GPL tools fine as subprocesses (distribution-triggered); attribution
   lines for CC-BY data; verify LM Studio/API terms at the wave that uses them.
7. **Signals, not grades.** No per-person leaderboards, exception lists over scores,
   raw counts never hidden, every heuristic number carries its basis label, honest
   states (in-progress ≠ empty ≠ error).
8. **Machine-checkable verify criteria** on anything called done — plans, gates, rules.
   If the criterion isn't checkable, refuse to loop on it.

## 5. Research protocol

- Explore agents for repo mining (≤15 files, conclusions not dumps); general-purpose
  agents with WebSearch for external research — **every claim carries a source URL,
  anything unconfirmed marked UNVERIFIED**, primary sources over blogs.
- Max 3 parallel agents. Launch independent agents in one message. Never re-do an
  agent's sweep yourself.
- Evidence goes in the design docs (a "Why (evidence basis)" table with numbers +
  sources) so report footnotes can defend themselves later.

## 6. Validators & board standards (crib from repopulse/scripts/)

- `validate-plan.mjs`: schema (fixed key set incl. `stories`), dep graph, no forward-
  wave deps, cycle detection, wave gating, points ∈ {1,2,3,5,8}, acceptance 2–5 items.
- `validate-traceability.mjs`: the two-way chain (see P4). Runs in CI.
- Existing Dokima validators (`scripts/`): inventory them first; extend, don't
  duplicate. Definition of done for the review: **all validators green, N/N FRs and
  N/N stories ticket-covered, zero dangling references, challenger pass recorded.**

## 7. Operating rules

- Feature branch; commit per pass with detailed bodies; push BOTH remotes every commit.
- Keep chat responses concise; checkpoint via commits (Brad's global rule).
- STOP-and-ask points: adoption of any amendment (P2→P3), anything touching a locked
  decision or NON_GOAL, anything that would resume the build, and the final merge.
- Save a project memory at the end: branch name, adopted/rejected decisions, open
  items, the resume sequence.
- If a mid-review question from Brad opens a new domain (this WILL happen — RepoPulse
  gained D10 from one sentence about SBOM false positives): treat it as a first-class
  domain interrogation — research it properly, design it fully, thread it completely.
  The best decisions in the RepoPulse run came from Brad's follow-up questions.

## 8. Definition of done (the bar RepoPulse hit)

- [ ] Gap register produced; every gap fixed, ticketed, or explicitly open-with-owner.
- [ ] All adopted amendments threaded brief→scope→SRS→stories→design→DB→roadmap→tickets.
- [ ] Diagrams: every adopted flow has a sequence/state diagram; every load-bearing
      choice has an ADR with a rejection; every moving part has a failure-mode row.
- [ ] plan.json: stories linkage on every ticket; F1–F4 fix plan folded in; no
      chokepoint tickets; validators green.
- [ ] Traceability: 100% FR and story coverage both directions, zero dangling refs,
      validator in CI.
- [ ] Challenger completeness pass run by a fresh agent; all confirmed gaps closed;
      gate entry in STATUS.md with independent-re-run evidence.
- [ ] Readiness report to Brad: what changed, what he must decide, exact build-resume
      sequence (including the v2.1.0 upstream precondition).

Now go: start with §1 load order, then P1. Brad is not watching in real time — work
autonomously between the STOP checkpoints, and put everything he needs in commits and
the final report.
