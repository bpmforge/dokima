# Shipwright — P2 Domain Interrogations → Recommendation Index

**Date:** 2026-07-14 · **Branch:** `review/design-review-hardening` · companion to `docs/work/DESIGN_REVIEW.md` (P1 gap register)
**Status: AWAITING FOUNDER ADOPTION** — nothing below is threaded into SCOPE/SRS/tickets until Brad adopts or rejects each item (kickoff §3 STOP rule). On adoption this banner is replaced with the threading record (RepoPulse pattern).

Sections mirror the interrogation domains: **A** process/UX · **B** micro-agent & loop architecture · **C** reports→action · **D** false-positive economics · **E** code-health content & extensibility · **F** core-brain/trust. Each rec is `**R-X-n (effort S/M/L, wave)**`. Evidence basis: Shipwright's own conductor telemetry (CONDUCTOR_FIELD_REPORT.md — 70 sessions, 7 harness failures all mapping to source-system mechanisms, 75% pre-fix false-block rate), the bpm-opencode-experts protocol suite (read at v2.9.0, 2026-07-14), and RepoPulse's shipped designs (IMPROVEMENT_PLANS.md, SECURITY_SUITE §3.6 VEX, CODE_HEALTH_SUITE §8). External web research deliberately skipped: every mechanism recommended here has already run in one of the three internal systems — primary evidence beats competitor blog posts (kickoff §5 would mark them UNVERIFIED anyway).

---

## A. Process/UX (persona walks — residuals after the P1 fix pack)

**R-A1 (S, W4)** — **Trust-graduation nudge.** P1's G-10a: "graduates to berths 2–3 once fitness cards and receipts have earned it" has no owner. Add a Record-tier suggestion card (never a pop) emitted when a project crosses an evidence threshold (e.g., ≥10 clean closes, 0 oscillations, 0 unwaived criticals over 7 days, ≥2 lanes available): "Berths 2 is earned — evidence: …". One rule in harbormaster + one card type. No amendment needed.

**R-A2 (M, W4-08 or W8-02 adjunct)** — **Escalation-ROI view.** UC-06/US-303 assert "the weekly report attributes exactly what escalation bought"; no screen renders it. Add a spend view over the existing `GET /spend?group_by=rung` + a weekly Review-tier digest card: per-ticket rung spend vs outcome ("R3 spent $0.41 on W0-02, landed; R1 would not have"). The ledger data already exists (FR-G3). No amendment needed.

## B. Micro-agent & loop architecture (product spec vs the library it productizes, read at v2.9.0)

**R-B1 (S, spec edit)** — **Micro-loop cap: 2, not "2–3".** The library is explicit: MICRO_LOOP revise cap is **≤2**; "3 is a macro-loop budget; a micro-loop that needs 3 should return PARTIAL and let the orchestrator re-scope." BLUEPRINT §3.5 says "cap 2–3 passes" — blurs the micro/macro boundary the discipline depends on. Fix: BLUEPRINT §3.5 + FR-L1 say micro=2 revise passes (evidence actions uncounted), macro coverage/fix-verify=3. **Needs amendment: yes (blueprint wording; recommend adopt).**

**R-B2 (M, W3-08 + W5-06)** — **Gate-scoring asymmetry + "re-ran independently" evidence, productized.** The library's GATE_SCORING_PROTOCOL has two load-bearing rules the product spec lacks: (a) **asymmetric threshold** — subjective score ≥7 accept, 5–6 polish, **1–4 escalate-to-human, never auto-fail** (a low vibe must not override a passing deterministic gate — the 2026-07-07 incident class); Shipwright says "advisory only" but never specs the asymmetry. (b) **A reviewer verdict without a `re-ran independently: <command, counts, exit code>` line is INCOMPLETE** — bounced, not counted. Thread both into FR-L6 (verdicts carry re-run evidence) and the W5-06 challenger/W3-08 ledger acceptance; surface the delegation-log equivalent as a filterable events view (no new table — `loop.escalated`/verdict events already exist). **Needs amendment: SRS row additions (recommend adopt).**

**R-B3 (S, doc note)** — **Tier-ceiling divergence, documented not adopted.** Library fix-verify ceilings are flat **6 metered / 12 local**; Shipwright's are points-scaled `3+points` capped **8 metered / 12+ local**. Points-scaled is strictly smarter (a 5-pt ticket earns more passes than a 1-pt). Keep Shipwright's formula; add a provenance note to FINDING_LOOP_POLICY §5 recording the deliberate divergence so a future sync doesn't "fix" it backwards. No amendment.

**R-B4 (S, resume prep + W3-08 note)** — **SW-R1 must resync against v2.9.0, not v2.1.0.** v2.1.0 shipped 2026-07-13; seven more minors followed; the loop-classifier mechanics (movement-based CLEARED/STALLED/PROGRESSED/OSCILLATING + tier-aware budgets) landed in **v2.4.0**. FINDING_LOOP_POLICY is already movement-based (good — it anticipated v2.4.0), but the resync + W3-08 implementation must conform to the *current* library fixtures, and W6-07 re-signs the re-imported content. Fold into the resume sequence (F3 command unchanged, target release updated). No amendment.

**R-B5 (S, W5-08)** — **Mode-specific macro cap.** Library: Ralph Wiggum coverage cap is 3, but **2 for feature/improve modes**. Thread into W5-08 (modes) acceptance. The byte-identical no-progress early-halt is already covered (FR-L1 gap-checksum kill + macro loop). No amendment.

## C. Reports → action (Shipwright's "improvement plan" equivalent)

**R-C1 (L, W5 — new design doc + 2 tickets)** — **Improvement Plans, productized (the RepoPulse D9 pattern).** Today Shipwright's runs produce receipts, findings, coverage reports, and Improve mode produces "an audit + fix backlog as tickets" (FR-P5) — but nothing composes run outputs into a **ranked, auto-verified action queue**: findings decay into stale markdown unless a human re-reads them. Adopt the proven design: a **deterministic recommendation catalog** (versioned data: condition → recommendation template → machine-checkable verify criterion) evaluated over receipts/coverage/finding-ledger snapshots → ranked `plan_items` → **nightly auto-verify** flips items done/regressed off fresh snapshots → LLM may order/narrate/summarize, **never add/remove/reword** (rules-first, kickoff §2.4). This *is* the product's compounding loop: Improve mode's fix backlog becomes standing, self-verifying, and honest about regressions. Deliverables if adopted: `docs/design/IMPROVEMENT_PLANS.md` (P3/P4), FR-PLAN-1..4 rows, tickets W5-10 (catalog+engine, 5pt) + W5-11 (plan UI + morning-queue integration, 3pt). **Needs amendment: new FR family + SCOPE item (recommend adopt — this is also Shipwright's own dogfood surface at W8-01).**

## D. False-positive economics (the domain Brad will push on — gate findings & review verdicts)

The evidence is Shipwright's own: **75% of pre-fix blocks were false** (field report §5 — one non-deterministic LLM review as authority is unstable in both directions), and the imported grep validators flag "AES-256-GCM" as a magic number (§5 second-order). The conductor's `validators.gate`/`advisory` split is the v0; the product must ship the full funnel.

**R-D1 (L, W3-08 + W5 + W4 — the flagship adoption; candidate D-014)** — **Gate-rule lifecycle + validated-finding funnel.** Four mechanisms, all field-proven elsewhere, composed:
1. **Rule lifecycle with shadow mode** (CODE_HEALTH_SUITE §8): every validator/gate rule carries state `proposed → shadow → advisory → gate → deprecated`. Shadow rules RUN on real diffs, findings stamped `experimental`, **excluded from gates/scores/blocks**. **Promotion is data-gated:** red fixtures required to merge at all; promotion to `gate` requires a measured FP rate below threshold over a minimum finding count + window (RepoPulse: <20% over ≥20 findings/30 days — tune per rule class). **Demotion:** trailing FP >50% auto-flags for demotion. LLM never promotes/demotes; humans confirm on data.
2. **Validation funnel before any finding blocks** (VEX generalization, SECURITY_SUITE §3.6): dedup (fingerprint, FR-L6) → scope (diff-scoped: a ticket answers only for its own diff — already conductor law) → applicability/reachability where computable → effective-severity → **propose-never-auto-dismiss**.
3. **Justification-gated suppression:** suppressing a finding requires a fixed-enum justification + human signature (waiver-receipt machinery reused at finding granularity); suppression is keyed to the finding fingerprint + context and **auto-reopens when the context changes** (file/rule/version bump). No silent kill-lists.
4. **Honest counts everywhere:** every gate/coverage surface shows `raw → deduped → in-scope → effective → suppressed(justified)` — raw never hidden (signals-not-grades, kickoff §4.7).
Wiring: FR-L6/W3-08 already own finding identity; this adds rule-state + FP bookkeeping (per-rule measured FP from suppression/override outcomes), settings surface in W4-06, and a promotion/demotion Review card. **Needs amendment: yes — recommend a new founder decision D-014 ("rules-first gate economics: lifecycle, shadow mode, data-gated promotion, justified suppression, raw counts never hidden") since it constrains every future gate feature.**

**R-D2 (S, W3-08)** — **Infra-failure taxonomy in the ledger schema.** FR-L6 already says infra failures never open findings; make the taxonomy explicit in the finding-ledger design (truncated review / unparseable verdict / limit pause / session watchdog kill / ENOBUFS-class output overflow) with a `free_retry` counter, so FP metrics (R-D1) never count infra noise as rule FPs. No amendment (design detail of an adopted FR).

## E. Code-health content & extensibility

**R-E1 (M, W6-07 acceptance extension)** — **License-gated content intake, deny-by-default.** CODE_HEALTH_SUITE §8: rule provenance carries a REQUIRED license field; only MIT/Apache-2.0/BSD/ours auto-accepted, everything else is a founder slate (this is also where the semgrep-registry no-compete and AGPL-tool concerns get caught for *community* packs). Fold into W6-07 acceptance + NFR-5 wording. **Needs amendment: no (extends an added ticket).**

**R-E2 (S, P4 deliverable)** — **Plug-in contract docs** (G-27): one `docs/design/CONTRACTS.md` covering the four surfaces (provider adapter, forge adapter, validator executable, expert pack) — written in P4 architecture completion, cited by NFR-5. No amendment.

**R-E3 (S, W8-01 note)** — **Anti-slop rule coverage check at dogfood.** Content ships all 30 ANTI_SLOP rules (R-01..R-30, verified present); W8-01's dogfood run should assert the security/code-health clusters actually execute the full rule set against this repo ("ALL of the set" lesson, STATUS 2026-07-12). Acceptance note at P5. No amendment.

## F. Core-brain audit (conductor loop · gate execution · gateway ladder · trust core)

Walked end-to-end against the field reports. Sound: hash chain (post-delimiter-fix), receipt HMAC anchoring, escalation ladder incl. the R3≠R1 frontier-role subtlety (caught by advisor review pre-close), budget monotonicity, symlink containment in packages/git + e2e (loop's lexical-only check is documented-deliberate; W3-09 owns the real one). Findings:

**R-F1 (S, spec edit — the G-1 fix)** — **FR-T3 refinement: territory releases at `done`.** Cross-lane write-scope overlap should be a schema error **among tickets that can still write** (not-done), plus an explicit declared `scaffold` exemption for bootstrap-scope tickets (W0-01-class). Rationale: the current any-status rule makes every completed broad ticket a permanent landmine — proven by the board failing its own validator 66×. The P4 `validate-plan.mjs` implements the amended rule; P5 narrows the 8 substantive live overlaps anyway (defense in depth). **Needs amendment: yes (BLUEPRINT §3.4/FR-T3 wording; recommend adopt).**

**R-F2 (M, board order — the G-4a fix)** — **Pull W8-03 (secrets vault + redaction + close-gate scanner) into W3.** Until it lands, nothing redacts credentials from context packets, event payloads, or receipts — the trust story has a hole exactly while the most autonomous waves run. It has no unmet dependencies (packages/shared + a validator; keychain refs landed W0-07). Cost: +5pts in W3. **Needs amendment: yes (wave reassignment; recommend adopt — same logic as F4's "harden the loop being built").**

**R-F3 (S, P4 mechanical)** — **Failure-modes table completion.** ARCHITECTURE §8 is missing rows the field run actually hit: truncated/unparseable review (free retry, never a finding), provider-limit pause (park + auto-resume, FR-G8), oversized session output/diff (ENOBUFS class — bounded buffers, summarize-and-continue), reviewer-bookkeeping divergence (fresh APPROVE beats stale sticky findings), resume state-drift refusal. P4 adds them with detection/behavior/user-visible columns. No amendment.

**R-F4 (S, P5 fold-in)** — **W3-01b acceptance gains the third HIGH.** The blocked W3-01's unresolved finding — manifest.files never cross-checked against `computeChangedPaths` — becomes an explicit acceptance criterion of W3-01b at the F1 split: *the manifest's claimed files must be a subset of observed changed paths, and the verified commit must touch them.* No amendment (F1 already founder-ordered).

**R-F5 (S, resume prep)** — **Fix the harness Node pin before relaunch.** `supervise.sh` hardcodes fnm v24.14.0; the product pins Node 22 — this ABI-broke better-sqlite3 during this very review (G-25). Resume sequence: point supervise.sh at `.nvmrc` resolution + add a conductor boot assertion `process.version` matches. Not touched now (kickoff §0 forbids). No amendment.

---

## Consolidated index

| ID | What | Effort | Wave | Needs brief amendment? |
|---|---|---|---|---|
| R-A1 | Trust-graduation nudge card | S | W4 | no |
| R-A2 | Escalation-ROI view + weekly digest | M | W4 | no |
| R-B1 | Micro-loop cap = 2 (align to library) | S | spec | **yes — BLUEPRINT §3.5 wording** |
| R-B2 | Score asymmetry (1–4 escalate) + mandatory "re-ran independently" verdict evidence | M | W3-08/W5-06 | **yes — SRS rows** |
| R-B3 | Document tier-ceiling divergence (points-scaled 8/12+ vs library flat 6/12) | S | doc | no |
| R-B4 | SW-R1 resync targets v2.9.0+; W3-08 conforms to v2.4.0 classifier fixtures | S | resume | no |
| R-B5 | Mode-specific macro cap (2 for feature/improve) | S | W5-08 | no |
| R-C1 | Improvement Plans pillar (catalog → ranked plan → nightly auto-verify) | L | W5 (+2 tickets) | **yes — new FR family + SCOPE item** |
| R-D1 | **Rule lifecycle + FP funnel + justified suppression + honest counts** | L | W3-08/W4-06/W5 | **yes — candidate D-014** |
| R-D2 | Infra-failure taxonomy in the finding ledger | S | W3-08 | no |
| R-E1 | License-gated content intake, deny-by-default | M | W6-07 | no |
| R-E2 | Plug-in contract docs (CONTRACTS.md) | S | P4 | no |
| R-E3 | Dogfood asserts full anti-slop rule-set execution | S | W8-01 | no |
| R-F1 | FR-T3: territory releases at done + scaffold exemption | S | spec + P4 validator | **yes — FR-T3 wording** |
| R-F2 | Pull W8-03 secrets redaction into W3 | M | board | **yes — wave reassignment** |
| R-F3 | Failure-modes table completion (5 field rows) | S | P4 | no |
| R-F4 | W3-01b gains manifest⊆changed-paths check | S | P5 | no |
| R-F5 | supervise.sh Node pin fix + boot assertion | S | resume | no |

## Decisions Brad owns at this STOP

| # | Question | Recommendation |
|---|---|---|
| AM-1 | Adopt R-F1 (FR-T3 territory-release + scaffold exemption)? | **Adopt** — the board proved the current rule wrong by failing it 66× |
| AM-2 | Adopt R-F2 (W8-03 secrets redaction → W3)? | **Adopt** — closes the largest open trust-window before autonomous W3 runs |
| AM-3 | Adopt R-D1 as **D-014** (rules-first gate economics)? | **Adopt** — it is the product's answer to the #1 product-killer (FP noise), built from this repo's own 75%-false-block evidence |
| AM-4 | Adopt R-C1 (Improvement Plans pillar, +2 W5 tickets)? | **Adopt** — completes reports→action; without it findings rot in markdown |
| AM-5 | Confirm the tier-aware loop ceiling (8 metered / 12+ local) found uncommitted + committed/threaded in P1 (G-7)? | **Confirm** (or revert cleanly — it is one commit) |
| AM-6 | R-B1/R-B2 spec alignments (micro cap 2; score asymmetry + re-run evidence)? | **Adopt both** — they are the library's two hardest-won rules |
| AM-7 | LICENSE choice (Apache-2.0 vs MIT, HP-7/D-006) | Founder pick; not review-blocking — recommend **Apache-2.0** (patent grant suits a trust product) |
| — | Standing/pending, no action forced: SW-001 stays as signed; P-001 (chat persistence) & P-002 (machine accept) slates remain open with working assumptions | — |

**Rejected during interrogation (recorded so they aren't re-derived):** external web research on competitor insight-to-action mechanics (internal proven designs cover it; anything found would be UNVERIFIED marketing); adopting the library's flat 6-pass ceiling over points-scaled (R-B3 keeps ours); a full plan.json migration to the product ticket schema pre-resume (bootstrap divergence is documented and waived — SW-001/G-30); building teammate write-access surfaces in v1 (D-005/N-4 hold; G-10b documented instead).
