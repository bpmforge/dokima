# Verification of PIPELINE_THROUGHPUT_ENHANCEMENT.md

**Date:** 2026-08-31 · **Subject:** `docs/work/PIPELINE_THROUGHPUT_ENHANCEMENT.md` @ `f299588b`
**Protocols:** `attest/agents/shared/RALPH_WIGGUM_LOOP.md` (coverage) + `attest/agents/shared/CHALLENGER_PROTOCOL.md` (veracity)

**Honesty note:** the plan's author ran both passes. Per `CONDUCTOR_FIELD_REPORT.md` §6 and the
maker≠verifier rule this is *not* an independent verification, and the challenge verdicts below should
be read as self-audit with citations, not as a second identity's judgment. Every `CONTRADICTED` carries
a `file:line`; no verdict rests on recall.

---

# Part 1 — Ralph Wiggum coverage loop

**Denominator:** every source of information bearing on the enhancement.
**Artifact per row:** the source is read *and* its material is either reflected in a named plan section
or recorded here as "no new material." Checkable by reading the row's cited section.

## Inventory

| ID | Source | Iter | Status | Material |
|---|---|---|---|---|
| S-01 | `~/Documents/02_Work_Notes/cursormeeting.md` | 1 | DONE | §3 primitive mapping; Grokbot → T5 |
| S-02 | `~/Documents/02_Work_Notes/LOCAL_EXHAUSTION_INCIDENT_LESSONS.md` | 1 | DONE | §1, §5, §6, §8, §9 |
| S-03 | cursor/plugins `pstack/skills/interrogate/SKILL.md` | 1 | DONE | §3, §5 Level 2 synthesis |
| S-04 | `attest/CHANGELOG.md` 3.4.0–3.5.4 | 2 | DONE | **Gauntlet loop already ships (v3.5.0)**; file-size accretion (3.5.1); `[PARTIAL]` return contract (3.5.4) |
| S-05 | `attest/scripts/conductor/` (1,159 + 212 lines, `supervise.sh`) | 2 | DONE | **attest has its own conductor** — the lineage the incident doc describes |
| S-06 | `attest/scripts/lib/review-triggers.mjs` | 2 | DONE | The literal OPT-08 anchor |
| S-07 | `attest/agents/sdlc/PARALLEL_WAVE_PROTOCOL.md` | 2 | DONE | Trigger prose; must change with S-06 |
| S-08 | `attest/agents/shared/GAUNTLET_LOOP.md` | 2 | DONE | Blind-critic loop exists; explicitly *not* the challenger |
| S-09 | `attest/agents/task-decomposer.md` | 2 | DONE | **Interface-contract module already specified, explicitly unenforced** |
| S-10 | `attest/agents/sdlc-init-phase-4.md` | 1 | DONE | Round 1/2/3 policy — T1-01 target |
| S-11 | `attest/IMPROVEMENT_BACKLOG.md` | 2 | DONE | Groups A–F closed 2026-06-11; no open row covers this program |
| S-12 | `attest/issues/field-report-mode1-sdlc-run-2026-07.md` | 2 | DONE | A-1 tracking-layer gap (module completion ≠ requirement completion) |
| S-13 | `attest/issues/field-report-local-model-eval-2026-07.md` | 2 | **BLOCKED: out of scope** | Local-model ranking; no bearing on gate architecture |
| S-14 | `shipwright/scripts/conductor*.mjs` + `conductor-lib/` | 1 | DONE | §2 seeds; single sequential reviewer |
| S-15 | `shipwright/docs/work/conductor-log.jsonl` (3,610 rows, 07-11→08-07) | 2 | DONE | **Independent local telemetry — see Part 3** |
| S-16 | `shipwright/plan.json` | 2 | DONE | 497 tickets, 495 done, 2 blocked |
| S-17 | `shipwright/docs/CONDUCTOR_FIELD_REPORT.md` | 2 | DONE | **§5 governing principle on LLM-review-as-gate** |
| S-18 | `~/Documents/dokima-field-reports/ISSUE12.md` (2,371 lines) | 2 | DONE (sampled) | Gate timed out at 120s traversing a worktree with 64,540 untracked paths |
| S-19 | `~/Documents/02_Work_Notes/CONDUCTOR_PILOT_REPORT_REDACTED_2026-08-03.md` | 2 | DONE | §3 lesson 8 — risk-tier admission; 6/6 landed under that filter |
| S-20 | `~/Documents/private-field-reports/field-report-marauder-delegation-2026-07-27.md` | 2 | DONE | **P1 untrusted verify receipts; failure 4 fabricated REJECT** |
| S-21 | `~/Documents/02_Work_Notes/AI_PROCESS_REVIEW_2026-07-27.md` | 2 | DONE | §4b wave size vs reviewability; §5 bounded human review HANDOFF |
| S-22 | `shipwright/packages/pipeline/src/decompose/` | 2 | DONE | **The seam model already exists in code** |
| S-23 | `shipwright/packages/loop/src/findings-ledger.ts` | 2 | DONE | **Stable finding IDs + fingerprints already exist** |
| S-24 | `bpm-agent-amplifier/packages/night-shift` | 2 | DONE | Scaffold only (`src/index.ts:1-4`) — no material |
| S-25 | `attest-claude` | 2 | **BLOCKED: generated** | Regenerated from attest; carries no independent decision |
| S-26 | `shipwright/CLAUDE.md` | 2 | DONE | Carries maker≠verifier (C-4); **no per-ticket review DoD text here** — that policy lives in attest |

**Iteration 1:** 3 of 26 covered → 23 gaps.
**Iteration 2:** 24 of 26 covered. Two rows closed as `BLOCKED` with reasons (S-13 out of scope, S-25 generated).
**Loop exit:** coverage complete at iteration 2, under the 3-iteration cap. No escalation block required.

---

# Part 2 — Challenger: veracity of the plan's claims

| # | Claim (plan §) | Verdict | Evidence |
|---|---|---|---|
| C-01 | "OPT-01..05 are NOT on this machine" (§2) | **CONFIRMED, evidence corrected** | Conclusion holds, but I checked only Dokima's conductor. attest has its own at `attest/scripts/conductor/conductor.mjs`. Re-verified there: `runReviewRound` is a `for` loop over reviewers (`conductor.mjs:554-556`) — sequential, so OPT-01 absent; `grep -n "baseline\|fingerprint\|blocked_on"` returns only a formatter-baseline string at `:489`. Neither conductor has Stage 0–5. |
| C-02 | "**Net-new:** the Interaction Map" (§4) | **CONTRADICTED** | The seam model already exists in Dokima. `packages/pipeline/src/decompose/types.ts:20-56` defines `InterfaceRef`, `providesInterfaces`, `consumesInterfaces`, `importsWorkspacePackages`; `linter.ts:45-65` implements `findUnownedInterfaces` — *"consumes X but no ticket in the DAG owns its public re-export"* — named "the seam lesson" and derived from this repo's own field report §10. attest states the same idea at `task-decomposer.md:137-145`, and `:218` concedes it "**is a manual check — nothing in `tickets.mjs` enforces it today**." |
| C-03 | Broad triggers live as prose in attest's phase-4 file (§1) | **CONFIRMED and sharpened** | They are *executable code*: `attest/scripts/lib/review-triggers.mjs:29-45` contains literally `\.map\(|\.filter\(|\.reduce\(` (perf) and `validate|escape` (security), regex-tested against the diff text — so the word `validate` in a comment recruits a security expert. `PARALLEL_WAVE_PROTOCOL.md:58-62` is the prose twin. |
| C-04 | OPT-10 stable finding IDs "proposed; not implemented" (§8 T3-04) | **CONTRADICTED for Dokima** | `packages/loop/src/findings-ledger.ts:100` mints `F-${ticketId}-${counter}`, carries `fingerprint` (`:154`), signed suppressions (`:278-305`), and `computeFindingFunnel` (`:363`). |
| C-05 | Per-ticket expert fan-out is *the* throughput defect (§1) | **CONTRADICTED as a uniform diagnosis** | True for the attest/Marauder conductor (4.8 expert sessions per coding attempt). False for Dokima: its own log gives **0.93 review sessions per ticket start**. Dokima's dominant defect is a **39.4% block rate** with infrastructure fatals, not fan-out. See Part 3. |
| C-06 | Level 2 runs multi-model reviewers whose findings block (§5) | **CONTRADICTED** | `CONDUCTOR_FIELD_REPORT.md:76-88`: LLM-review-as-a-hard-gate failed **in both directions** in one session — false negative (hash-forgery merged) and false positive (**75% of the last four blocks were false**). The resolution already adopted and wired into `conductor.config.json`: *"deterministic validators own the gate; the LLM review is advisory and grounded by validator findings."* The plan must not re-introduce blocking LLM verdicts. |
| C-07 | More reviewers improve assurance (§3, T1-07) | **CONTRADICTED as stated** | `field-report-marauder-delegation-2026-07-27.md:103-107`, "Deliberately not proposed: **More AI review layers.** Failure 4 is the direct counter-argument" — a reviewer fabricated a REJECT citing a wiring omission independently confirmed present at every commit (`:31`). Model diversity within *one* pass is compatible with this; *more passes* is not. Requires P4 (reviewer-citation gate) alongside. |
| C-08 | Deterministic anti-slop checks can hard-gate Level 1 (§5) | **CONTRADICTED without a precondition** | `CONDUCTOR_FIELD_REPORT.md:86`: imported grep validators flag `256` inside "AES-256-GCM" in a comment, HTTP `429`, and model-ID strings as magic numbers, plus 20 bogus "unreachable" hits on passing code. *"Validators need red-fixture calibration before they can hard-gate."* |
| C-09 | attest's review synthesis needs an interrogate-shaped rewrite (T1-07) | **PARTIALLY CONTRADICTED** | attest v3.5.0 already ships `/gauntlet` + `gauntlet-lead` + `GAUNTLET_LOOP.md` — blind fresh-context critics, exemplar bar, builders never grade their own work (`CHANGELOG.md:53-59`). `GAUNTLET_LOOP.md:115` draws the boundary: for "are these claims true," use the challenger. The genuine gap is **model diversity and consensus weighting**, not blindness. |
| C-10 | 861 sessions / 1,900.8 min / 8.8 min median (§1) | **CONFIRMED as sourced, UNVERIFIABLE locally** | Faithful to `LOCAL_EXHAUSTION_INCIDENT_LESSONS.md`. The underlying event log is on the work machine and cannot be re-derived here. Dokima's own log now supplies independent local figures (Part 3). |
| C-11 | `build:claude` is still the generation command (§11) | **CONFIRMED** | `attest/package.json` scripts: `build:claude = node scripts/build-target-claude.mjs --write`. |
| C-12 | Wave budget 4–8 tickets / ~1,000 lines (§5) | **CONFIRMED, independently corroborated** | `AI_PROCESS_REVIEW_2026-07-27.md:215-223` argues the same direction from reviewability: large per-wave change before external human review is the objection; narrower waves shrink correction blast radius. |

## Material the plan is missing entirely (Ralph gaps, not challenges)

| # | Missing | Source | Why it matters |
|---|---|---|---|
| M-01 | **P1 — untrusted verify receipts.** A wrapper (never the agent) runs the declared verify commands and writes `docs/work/receipts/<ticket>-<sha>.json` with each command, exit code, captured tail, and the `git rev-parse HEAD` it ran at. The manifest *cites* the receipt; the validator asserts the SHA matches the pushed commit and every exit code is 0. | `field-report-marauder-delegation-2026-07-27.md:52-68` | The most-repeated failure — false "tsc/biome/tests clean" in 4 of 5 named tickets. Ranked **P1, ship first if only one ships**. It is also what makes Level 1 trustworthy at all. |
| M-02 | **Risk-tier admission filter.** Not every `ready` ticket is safe for unattended automation; bounded, evidence-based, known-acceptance work is admitted, ambiguous/large/judgment work is held for a human pass. | `CONDUCTOR_PILOT_REPORT…:325-333` (lesson 8) | Under this filter the pilot landed **6/6**. Dokima unfiltered lands 45.4%. This is the empirical answer to "automate through without getting stuck." |
| M-03 | **Bounded periodic human review HANDOFF per wave** — a curated diff + delegation-log slice sized for 2–4 hours, not "read the repo." | `AI_PROCESS_REVIEW_2026-07-27.md:227-234` | The plan drew the machine-start line but never the machine-stop line. |
| M-04 | **Validator red-fixture calibration** as a precondition for promoting any check from advisory to gate. | `CONDUCTOR_FIELD_REPORT.md:86` | Without it Level 1 inherits the false-block problem it exists to remove. |
| M-05 | **P4 reviewer-citation gate** — a reviewer finding must cite evidence that resolves, or it is discarded. | `field-report-marauder-delegation…:86-95` | The only proposed control on fabricated REJECTs; required before any multi-model fan-out. |
| M-06 | **Scope-gate scalability.** Scope validation must not traverse untracked trees. | `ISSUE12.md:1-30` — gate timed out at 120s against 482 missing tracked / 64,540 untracked paths | An `blocked_on_infrastructure` class the plan named but did not instrument. |
| M-08 | **Evidence writes must leave the target repo clean.** `attest/scripts/conductor/conductor.mjs:508` runs `git add -f` + commit on scope-violation evidence from the target checkout. | `LOCAL_EXHAUSTION_INCIDENT_LESSONS.md` "Runtime Evidence Dirtied the Target Repository" — names the force-add-and-commit fallback as the defect | Can commit runtime evidence into a PR-only repo and leave the main checkout dirty, which then refuses the next conductor start. Same family as `[[feedback-blanket-delete-tracked-files]]`. |
| M-07 | **Publish the reliability metric** (76% / 24% correction rate) as a running, trending tally. | `field-report-marauder-delegation…:96-101` (P5); `AI_PROCESS_REVIEW…:235-239` (rec 2) | Turns trust from a vibe into a tracked number; belongs in §10 targets. |

---

# Part 3 — Independent local telemetry (new evidence)

`shipwright/docs/work/conductor-log.jsonl` — 3,610 rows, 2026-07-11 → 2026-08-07. Computed, not recalled:

| Measure | Dokima (local) | Marauder (incident doc) |
|---|---:|---:|
| Ticket starts | 282 | 181 coding attempts |
| **Review sessions per ticket start** | **0.93** | **4.76** |
| Retries per ticket start | 0.72 | — |
| Deterministic gate failures per ticket start | 0.63 | — |
| Review approve rate | 48.3% | 18.7% (25 of 134) |
| Block rate | **39.4%** | — |
| Done rate | 45.4% | — |

Distinct `conductor.fatal` causes observed: `spawnSync git ENOBUFS`, `ENOSPC: no space left on device`,
`row.notes.push is not a function`, `testSiblingWarning is not defined`, `git merge --no-ff` failure.
Four of five are infrastructure or executor defects — precisely the class the incident doc says must not
consume a feature attempt.

`gates.fail` messages are visibly **truncated mid-stream** (`"pnpm test failed: eout\"."`), which is the
terminal-reporting truncation defect from the incident doc, live in Dokima today.

**Conclusion:** the two conductors have *different* dominant defects. The plan's uniform fan-out diagnosis
is wrong for Dokima and right for Marauder. §1 must be split accordingly, and Dokima's wave (T2) should be
ordered ahead of the fan-out work (T3) because its failure-accounting problems are the ones actually
costing this repo throughput.


---

# Part 4 — Independent challenge (fresh context, 2026-08-31)

Two agents with no prior context were run against the plan: an adversarial **challenger** (33 claims) and a
**mechanism coverage auditor**. Both were told to find what is wrong. Both did. Every finding below was
re-verified by the author before being applied.

## The self-audit over-corrected twice

| Self-audit verdict | What the independent pass found | Re-verified |
|---|---|---|
| **C-06** — "LLM review is advisory; already wired in `conductor.config.json`; this plan does not re-open that" | **Half true, and the half that matters is false.** That config splits *grep validators* only (its own `$note` says so). The LLM reviewer still gates: `scripts/conductor/ticket.mjs:51-73` turns `reviewDecision(verdict).blockers` into `gaps`, which drive the retry ladder and `markBlocked`. So the change the field report calls most important was recorded as done and filed as **no ticket at all** | Confirmed by reading `ticket.mjs:51-73` and `conductor.config.json`. Now **T2-16** |
| **C-05** — "Dokima block rate 39.4%, done rate 45.4%" | **A measurement defect.** Those are event ratios. Per unique ticket: 141 started, **128 done (90.8%)**, 64 ever blocked of which **51 later completed**, 13 still blocked. Board: 495/497. Worse, the log covers **W0–W11 only** — 141 of 497 tickets — and was compared against a pilot's *outcome* ratio | Recomputed: `unique started 141 / done 128 = 90.8%`; `waves in log: W0-W11`; board waves W0–W22. §1 rewritten, §10 targets replaced |

Both are the same failure my own memory already names — a conclusion built on the wrong denominator, and a
partial wiring fact promoted to "solved." A self-challenge cannot catch what it would verify the same wrong
way twice; these took a second reader.

## The largest single finding — and the plan's recurring error

**§13's self-healing ladder is implemented, tested, and wired to nothing.** `packages/loop/src/loop-policy-*.ts`
exports `classifyIteration`, `createFindingBudgetTracker`, `checkConvergence`, `checkProgressCeiling` —
**zero callers outside `packages/loop`**, verified by grep across `apps/`, `packages/`, `scripts/`. The
correct ticket is *call it*, not *build it*.

That is now the **fourth** time this plan proposed building something that already exists:

1. the seam model (`packages/pipeline/src/decompose/`) — C-02
2. the findings ledger (`packages/loop/src/findings-ledger.ts`) — C-04
3. the loop-policy engine (`packages/loop/src/loop-policy-*.ts`) — this pass
4. the trigger-driven automation layer (`apps/server/src/scheduler/`, `packages/harbormaster/`) — this pass

Plus `delegation-gate.mjs --citations`, which is M-05 already written. **Standing rule adopted into the plan
(§16): the default assumption for any new ticket is that the implementation already exists and is unwired.**

## Other confirmed corrections

| Finding | Evidence | Action |
|---|---|---|
| attest has **no model ladder**; `CODER_MODEL` is fixed (`conductor.mjs:143`, `:606`, `:737`). Dokima is the one with the ladder (`ticket.mjs:16`) | §2's table justification had the two conductors inverted | Table corrected |
| §4b said "five conditions"; the table has six | plan `:199`, `:217` vs the table | Corrected to six |
| §1 "two conductors" vs §2 "three conductors" | plan `:20` vs `:79` | Reconciled |
| Concurrency is **already attest policy** — `sdlc-init-phase-4.md:129`: *"Round 2 — Review (always parallel… open N sessions concurrently)"* | The gap is executor-only, not policy | T1-01 scope narrowed |
| `docs/work/receipts/` does not exist; no conductor mentions receipts outside two prompt strings | T2-00 is greenfield, not wiring | §5 note added |
| 15 of 24 `conductor.fatal` rows are one bug (`row.notes.push`); `STOP file present` (3) is an operator action, not a defect | Recomputed from the log | T2-17 replaces the four-equal-causes framing |
| `findMissingPackageJsonScope` (`linter.ts:16-36`) already implements write-scope reachability for the package.json seam | §4's table omitted it | Added |
| Ceiling constant: doctrine says 6 (`FIX_VERIFY_LOOP.md:156`), shipped code says 8 (`loop-policy-convergence.ts:12`) | Landing the prose would silently regress a tested constant | Flagged in §13; shipped constant wins |
| No git hooks in either repo; Dokima red fixtures 0/78; Dokima's `gate[]` is 2 checks wide; `nightly.yml` has never run its payload (root `scripts.e2e` is `undefined`) | Verified live | §16.2, tickets T2-18…T2-22 |
| `expert-hooks.ts` can never fire for a Dokima conductor session — it spawns `claude`, not `opencode` (`session.mjs:31`) | §7's "extend hooks to Level 1" is unimplementable there | §16.3, §7 row corrected |

## Standing on the numbers

The Defect-A figures (4.76 sessions/attempt, 1,900.8 min, 8.8 min median) remain **UNVERIFIABLE from this
machine** and are now explicitly caveated in §10. The Defect-B figures are re-derived per unique ticket and
carry their window (W0–W11, 28% of the board). Any target keyed to `ticket.start` events is gameable by
emitting fewer of them; the unique-ticket denominator governs acceptance.
