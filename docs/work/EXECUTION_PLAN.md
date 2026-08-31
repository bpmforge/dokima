# Execution Plan — Pipeline Throughput Enhancement, coded to completion

**Date:** 2026-08-31 · **Branch:** `feat/pipeline-throughput-enhancement`
**Design doc:** `docs/work/PIPELINE_THROUGHPUT_ENHANCEMENT.md` (16 sections, twice-challenged)
**Verification trail:** `docs/work/PIPELINE_PLAN_VERIFICATION.md` (self-audit + 2 independent fresh-context passes)
**Executable board:** `docs/work/pipeline-board.json` — **lints clean against `scripts/conductor/lint.mjs` (0 errors, 0 warnings)**

This file is the bridge from plan to running automation: the distilled lessons, the two boards (Dokima +
attest), the launch runbook, and the founder decision list. Nothing here re-argues the design doc; section
references point into it.

---

## 1. The lessons, distilled to laws

Every rule below was paid for — the source is cited so nobody relitigates it from vibes.

| # | Law | Paid for by |
|---|---|---|
| L1 | **The agent never authors its own evidence.** A wrapper runs verify commands and writes the receipt; gates read receipts, never prose. | Marauder failure #1 — false "tsc clean" in 4 of 5 tickets; `CLAUDE.md` Law 4 already mandates it, unimplemented |
| L2 | **Deterministic checks own the gate; LLM review is advisory.** A model verdict may file findings and demand checks, never block a merge alone. | `CONDUCTOR_FIELD_REPORT.md` §5 — review-as-gate failed both directions, 75% false blocks |
| L3 | **No check gates without a red fixture.** Prove it fails on the planted defect before it may block anyone. | Grep validators flagging `AES-256-GCM` in comments; Dokima fixtures currently 0/78 |
| L4 | **Assume it exists and is unwired.** Before scoping a build, grep for the implementation. | Four times in one plan: seam model, findings ledger, loop-policy engine, automation layer — all built, zero callers |
| L5 | **Measure on the honest denominator.** Unique tickets, not events; the window named; never compare an event ratio to an outcome ratio. | My own Defect-B "39.4% block rate" — actually 90.8% completion per unique ticket |
| L6 | **Failure classes get separate budgets.** Infra, provider, baseline, formatter, scope — none consume a feature attempt. One bug was 62% of all fatals. | Incident doc Stage 0–5; Dokima fatal histogram |
| L7 | **Stuck → split, not just escalate.** A PROGRESSED ceiling is a decomposition signal; PARK routes to the decomposer. Shipped constants win over doctrine prose (8, not 6). | `FIX_VERIFY_LOOP.md:156` + `loop-policy-convergence.ts:39` |
| L8 | **The seam is the unit of integration.** Producer, consumers, wiring evidence asserted on the *built* head — and wiring is somebody's ticket. | `mintReceipt` existed and was invisible; 45 scope collisions on one board |
| L9 | **Tickets are the wrong done.** Requirements → e2e on `main` is done; tickets closed is *coded*. Long tail is a planned wave, not leftovers. | Field report A-1 (silent divergence), B-1 (first-run deadlocks, recurring and un-hunted) |
| L10 | **Automation talks to processes, humans get bounded packets.** HANDOFF prose is the fallback; the conductor is the path. Human checkpoint = curated 2–4h packet per wave. | Brad's own words in the Cursor meeting; "copy-paste HANDOFF tax"; AI_PROCESS_REVIEW rec 1 |
| L11 | **Every optimization ships as a project-level setting.** If it only speeds our build, the ticket is incomplete. | §15.2 dogfood symmetry — that is the product |
| L12 | **Maker ≠ verifier, mechanically — including this plan.** Two independent fresh-context passes found what self-audit could not (twice). | This very document's history |

## 2. Board One — Dokima executor (`docs/work/pipeline-board.json`, 19 tickets, 102 pts)

| Wave | Tickets | Theme | Claimable when |
|---|---|---|---|
| **P0 — trust floor** | P0-01 receipts · P0-02 62%-fatal fix · P0-03 honest reporting · P0-04 git hooks · P0-05 nightly payload | L1, L5, L6 groundwork; every later gate depends on receipts existing | **Immediately** |
| **GATE-P1** | founder-flipped marker | The hard ordering constraint: policy before wave-gate executor work | Human only (in `holdTickets`) |
| **P2 — failure accounting + self-heal** | P2-01 baseline preflight · P2-02 fingerprints/differential · P2-03 mechanical remediation · P2-04 six terminal states · P2-05 **wire** `packages/loop` + split-on-stall · P2-06 LLM→advisory · P2-07 risk-tier admission + scope hardening · P2-08 red-fixture harness | L2, L3, L6, L7 | P0 deps done; **does not wait for GATE-P1** |
| **P3 — wave gate + assembler** | P3-01 synthetic wave branch · P3-02 seam union + build-time assertions · P3-03 Tier-A multi-model advisory review · P3-04 merge train + human packet · P3-05 assembler (ledger, assembly tickets, long-tail, assembly gate) | L8, L9, L10 | **GATE-P1 done** |
| **P4 — automations** | P4-01 extend scheduler/board-watcher (zero Decide-tier auto-actions preserved; auto-merge explicitly NOT built) | L10, L11 | P3-04 done |

Every ticket's acceptance embeds its verify commands and demands RED-before-GREEN on new checks — the board
is the enforcement of L1/L3, not just a list.

## 3. Board Two — attest policy wave (file in `~/Code/attest`, run by its own conductor)

These cannot live on the Dokima board (different repo). File as attest tickets; GATE-P1 closes when they merge.

| ID | Ticket | Design ref |
|---|---|---|
| A1 | Rewrite `sdlc-init-phase-4.md` Round 2 → three-level model; per-ticket experts = high-risk only | T1-01 |
| A2 | DoD language: wave-level review legalized (the OPT-09/OPT-12 gate) | T1-02 |
| A3 | `rules/` primitive: `description`/`globs`/`alwaysApply` + loader + validator | T1-03 |
| A4 | Replace `review-triggers.mjs` regexes with path + semantic-risk classification (keep the regexes as *scanner* triggers only) | T1-04 |
| A5 | `wave` skill — compose/run/synthesize a Level-2 gate | T1-05 |
| A6 | `goal` skill — bounded objective loop with measurable exit | T1-06 |
| A7 | Model diversity + consensus weighting added to challenger/gauntlet (not a replacement) | T1-07 |
| A8 | Policy: LLM review advisory, deterministic validators gate (align with field report) | T1-07b |
| A9 | Runtime verdict contract: PASS / FAIL_CANDIDATE / BLOCKED_BASELINE_* / BLOCKED_INFRASTRUCTURE; nonzero verify ⇒ FAIL always | T1-08 |
| A10 | `task-decomposer` emits seam records; interface-contract rule enforced by validator (ends "manual check") | T1-09 |
| A11 | **Conductor-first Phase 4** — board+conductor present ⇒ dispatch through conductor; HANDOFF prose is the interactive fallback | T1-11 |
| A12 | Decomposition emits requirement ledger, assembly tickets, long-tail wave | T1-12 |
| A13 | Wire `delegation-gate.mjs --citations` into review intake (already written, unwired) | T3-10 |
| A14 | Fixture the two unproven HANDOFF gates (`validate-scope.sh`, `validate-tracker-fresh.sh`); teach `check-validator-fixtures.mjs` to parse `run-handoff-gates.sh` | audit #7 |
| A15 | attest CI runs the validator fixture check + a scheduled job | audit #11 |

Then `npm run build:claude`, commit both repos, push both remotes (sync law).

## 4. Runbook — the automation that codes this to completion

**Precondition:** Node 22 on PATH (`.nvmrc`; Node 24 fakes ~50 server-test failures). Clean tree, on `main`
after this branch merges.

```sh
# 0. one-time: point the conductor at this board (FOUNDER STEP — edit conductor.config.json)
#      "boardPath": "docs/work/pipeline-board.json",
#      "holdTickets": ["GATE-P1"],
#    commit that change on a branch with the board.

# 1. sanity: board lints through the real linter
node scripts/conductor.mjs --lint

# 2. supervised first wave (P0) — one ticket per breakpoint while trust is being established
node scripts/conductor.mjs --breakpoint ticket --max-tickets 1

# 3. unattended P0+P2 (overnight; sonnet-only ladder — no --escalate, per D-018)
scripts/autorun.sh start          # caffeinate + supervise + STOP-file semantics
tail -f docs/work/conductor.out   # or: node scripts/conductor-report.mjs (after P0-03)

# 4. stop any time
touch STOP                        # takes effect at the next ticket boundary

# 5. after attest A-wave merges: flip GATE-P1 to done on the board (human), then P3/P4 flow
```

**Progress is graded by the report, not the log:** after P0-03, `node scripts/conductor-report.mjs` prints
the per-unique-ticket numbers (L5). Wave P0's own exit test: the report runs, receipts exist for every landed
ticket, and `nightly.yml`'s payload has executed at least once.

**Self-healing during the run** (§13 ladder, live from P2-05): mechanical fix → infra retry (free) →
baseline block (free) → evidence-carrying retry → tier escalate → **split** → scope-widen-or-file →
`held_for_human` with everything preserved. `touch STOP` and the kill-switch semantics stay boundary-safe.

## 5. Founder decisions (blocking, in order)

1. **Approve this execution plan** — merging `feat/pipeline-throughput-enhancement` is the approval.
2. **Point `boardPath` at the pipeline board** and start P0 (runbook step 0–2). Reversible one-liner.
3. **File the attest A-wave** (I can generate the attest-format tickets on request) and, when merged, **flip GATE-P1**.
4. **Auto-merge policy** (P4): deliberately NOT built. Decide never / low-risk-only later.
5. **Defect-A baselines**: re-measure on the work machine before grading §10 targets (unverifiable here).

## 6. Definition of done — for this program itself (L9 applied to us)

Not "all tickets closed." Done means, asserted by artifacts:

- [ ] Every gating check has a red fixture (`check-validator-fixtures` green with an empty grandfather delta)
- [ ] A full P3 wave has run end-to-end: synthetic branch → Tier-D gates → Tier-A advisory → merge train → human packet — on a real feature wave, not a fixture
- [ ] The assembler blocks a deliberately-broken seam and a deliberately-uncovered requirement (planted, then removed)
- [ ] `conductor-report.mjs` over a current window shows: retries/start ≤ 0.35, gate-failures/start ≤ 0.30, block-cycle tickets ≤ 20%, unique-ticket completion ≥ 90%, zero fatals charged to tickets
- [ ] Acceptance tests 1–32 in the design doc all have executable counterparts
- [ ] Every §15.1 lever names its project-level setting (L11) — verified by reading `conductor.config.json` + product config, not prose
- [ ] The reliability metric is published and trending (M-07)
