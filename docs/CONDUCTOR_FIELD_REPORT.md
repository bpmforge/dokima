# Conductor Field Report — bootstrap build of Shipwright

**Window:** 2026-07-11 13:06 → 2026-07-12 02:29 (UTC), ~13.4h wall-clock
**Subject:** Building Shipwright (the product) using a throwaway conductor harness that is itself a thin approximation of Shipwright's design.
**Author:** Claude Fable 5 session, with Brad Matthews.

> This is a live field report, not a retrospective written after the fact. Every stat is pulled from `docs/work/conductor-log.jsonl` and `plan.json`. The headline: the bootstrap harness kept failing in exactly the ways the source systems (bpm-opencode-experts + Jarvis/Foreman) already solve — which is the strongest evidence available that productizing them (Shipwright) is aimed at the right problems.

---

## 1. The thesis under test

**Claim:** Taking bpm-opencode-experts (the SDLC discipline + guardrails) and Jarvis/Foreman (the autonomous loop runtime) and formalizing them into a product (Shipwright) is the right thing to build.

**Test:** We built a deliberately thin executor — `scripts/conductor.mjs`, one Node script — to drive the Shipwright plan.json board unattended with cheap models (Sonnet/Haiku, escalating to Opus). Each defect the thin harness hit is a natural experiment: does it map to a mechanism the real systems already have?

**Result so far:** Every single failure mapped. The thin harness re-derived, the hard way, the receipts layer, the Challenger, deterministic validators, the watchdog, sticky findings, and the calibration problem — all pre-existing in the source designs. See §4.

---

## 2. Run statistics (from the log)

| Metric | Value |
|---|---|
| Wall-clock window | ~13.4 hours |
| Total agent sessions spawned (`claude -p`) | **70** |
| Tickets landed on `main` | **11 / 63** (17%) |
| — landed autonomously by the conductor | 8 |
| — landed by hand after a false block | 3 |
| Tickets blocked (events) | 6 across 5 unique tickets |
| — confirmed **false** blocks (code was actually done) | **3** (W0-05, W1-01, W1-03) |
| — real block, later self-resolved by model ladder | 1 (W0-02) |
| — reset & re-running under fixed gate | 1 (W2-03) |
| Ticket retries (ladder escalations) | 17 |
| Conductor process crashes (`conductor.fatal`) | 1 (ENOBUFS) |
| Provider-limit pauses | 0 |
| Session timeouts / hangs | 0 |
| Security passes that halted the run (`security.critical`) | 1 |
| Conductor (re)starts | 12 |

**Read the "12 restarts / 13 hours" honestly:** this was *not* a clean autonomous overnight run. Most restarts were me stopping the harness to fix a defect I'd just watched it hit and to add the next capability. The throughput number (11 landed) is entangled with heavy harness development. Steady-state autonomous throughput is unmeasured; this window measured *how a thin harness fails and what fixes those failures demand.*

**Tickets landed:** W0-01, W0-02, W0-03, W0-04, W0-05, W0-06, W0-07 (full trust core), W1-01 (expert library import: 85 experts + 70 validators + 8 protocols), W1-03 (micro-loop), W2-01, W2-02 (provider framework + Anthropic/OpenAI adapters).

---

## 3. What the guardrails caught that would otherwise have shipped

Two real, security-relevant defects were caught by the review/validator layers — bugs that passed tests and would have merged silently:

1. **Hash-chain forgery gap (W0-02).** The event-log hash concatenated `prev_hash|seq|type|actor|payload` with **no delimiters**, so distinct events could produce identical hashes (field-boundary collision) — defeating the tamper-evidence that is the log's entire purpose. Compiled, 28 tests passed. Caught by review; fixed with a length-prefixed (injective) preimage + a regression test that fails on the old code.
2. **Receipt-binding gap (W0-05).** `verifyReceipt` correlated a receipt to its minting event by `receiptId` only, not by content (kind/validators/inputTreeHash/signedBy) — a forgeable anchor. The model ladder fixed it *and* hardened it with a keyed-HMAC tag before landing.

Both are exactly the "compiles and tests pass ≠ correct" class the guardrails exist for.

---

## 4. Incident log — every harness failure mapped to a source-system mechanism

Each row: a defect the thin conductor hit, and the mechanism the real systems already have that prevents it.

| # | Conductor failure (observed) | Fix applied here | Mechanism it re-derived |
|---|---|---|---|
| 1 | Write-scope gate blocked legit shared-file edits (pnpm-lock, TECH_STACK); W0-05's own scope excluded its deliverable dir | Shared-infra allowlist + plan-linter | Ticket schema + plan discipline |
| 2 | `git diff` on a huge import overflowed the 1 MB buffer → `conductor.fatal`, dead 5h | 512 MB buffer + **supervisor** (crash restart) | Foreman heartbeat watchdog / crash-safety |
| 3 | A session that self-marked `blocked` poisoned later retries | Reset status before each retry | Loop state hygiene |
| 4 | Hash forgery bug **merged** (finding vanished between stateless reviews) | Sticky findings across attempts | Challenger + coverage tracking (findings tracked to CONFIRMED) |
| 5 | 3 tickets **false-blocked** (findings became immortal; reviewer said APPROVE but bookkeeping held them) | Trust informed APPROVE; block only on freshly-raised / still-PRESENT | Validators own gates; LLM scoring advisory |
| 6 | Security pass flagged the conductor hand-editing plan.json status without receipts (CRITICAL) | Human-signed waiver ledger (SW-001) | Receipt/event-sourced state as source of truth |
| 7 | Naively wiring the real validators would re-introduce false blocks (grep heuristics noisy on TS) | Reliable validators gate (diff-scoped); heuristic ones anchor the review | "Script floor + agent verified pass" (their own words) |

**Seven distinct harness defects. Seven pre-existing mechanisms.** None was a coincidence forced onto the design after the fact — each was root-caused from evidence (a crash trace, an `APPROVE sticky=2 unresolved=2` log line, a noisy validator run) *before* being mapped.

---

## 5. The standout finding: LLM-review-as-a-hard-gate fails in both directions

The single review-as-gate mechanism failed **twice, oppositely**, in one session:

- **Too lenient (finding 4):** stateless review let the hash forgery bug merge — a false *negative*.
- **Too strict (finding 5):** after I added stickiness, the bookkeeping made findings un-clearable, false-blocking 3 *completed* tickets — a false *positive*. Confirmed by the log: `verdict=APPROVE sticky=2 unresolved=2` → blocked an approved ticket.

**False-block rate before the fix: 3 of the last 4 blocks were false (75%).** A single non-deterministic LLM review used as the authority is unstable at both ends. The resolution — which is exactly the source-system architecture — is: **deterministic validators own the gate; the LLM review is advisory and grounded by validator findings.** That is now wired (§ validators.gate / validators.advisory in `conductor.config.json`).

A second-order finding: even *deterministic* validators aren't a silver bullet. The imported grep-heuristic validators flag `256` inside "AES-256-GCM" (in a comment), HTTP `429`, and model-ID strings as "magic numbers," and report 20 bogus "unreachable" hits on passing code. Validators need **red-fixture calibration** before they can hard-gate — which is precisely the validator-contract layer the product provides. The bootstrap re-derived the need for it.

---

## 6. What is and isn't proven

**Proven (well-supported by this run):** the *design principles* of bpm-opencode-experts + Jarvis are necessary and correctly shaped. Every thin-harness failure mapped to one of their mechanisms; the guardrails caught real defects; the economics held (cheap models landed the straightforward ~80% — adapters, scaffolding, config — while the trust-core primitives needed escalation or human hands).

**Not yet proven:** that the *integrated product* works end-to-end, is completable, or gets adopted. Those are different claims. This run validates the parts and their necessity, not the assembled whole.

**Guard against circularity:** I both built the flawed harness and diagnosed it against the source design, so there's a temptation to pattern-match. The check that it isn't circular: the failures were genuinely surprising (an ENOBUFS crash, an APPROVE-but-blocked line) and root-caused from primary evidence before being mapped — not reverse-engineered to fit.

**Tightest single proof of the thesis:** ticket W1-01 landed the real validator library into `content/`, and within the same session those validators were wired into the conductor to fix its own biggest weakness. The product started building the parts that repair its own scaffold.

---

## 7. Will it run through the night?

**Mechanically, yes** — and this is by design:
- `caffeinate` prevents the Mac from sleeping.
- The **supervisor** restarts the conductor across process crashes (cap 30).
- Provider limits trigger sleep-to-reset (0 hit so far, so headroom is unknown but the machinery is proven in code).

**But it will likely not finish all 52 remaining tickets, and may halt cleanly before morning**, because:
- **Wave-boundary security passes halt on any *unwaived* CRITICAL** (§6 waiver only covers the plan.json-status issue). Crossing W0→W1→W2 boundaries re-runs security over the whole wave; a new critical parks the run for human review.
- **Genuinely hard tickets can still block** (the fixed gate + validators cut false blocks, but real blocks on foundational primitives remain a human-in-the-loop event).
- If every remaining claimable ticket blocks, the conductor idle-exits cleanly.

**Also:** live *notifications* to this chat are session-scoped — if the session ends, I stop reporting, but the detached build keeps running. Check progress any time with `tail -f docs/work/conductor.out` or the Monday checklist in `docs/work/CONDUCTOR_RUNBOOK.md`.

**Honest forecast:** it will keep grinding overnight and land more of the straightforward W1/W2 tickets, then most likely **park at a wave-boundary security critical or a hard block and sit idle until you review it** — which is the correct behavior, not a failure.

---

## 8. Recommendations

1. **The bootstrap has served its purpose as a probe.** Its remaining value is finishing the straightforward tickets. Don't keep hardening the shell script; let the product's real layers (deterministic validators + Challenger + receipt-backed state) supersede it as they land.
2. **Calibrate validators with red fixtures** before promoting any from `advisory[]` to `gate[]` — the run proved raw grep heuristics false-block.
3. **The trust-core primitives want human authoring or pairing**, not one-shot autonomous generation — they are where the guardrails earn their keep and where the models most often need escalation.
4. **Fold this report into the product's lessons/field-report intake** (the M29 pattern) — it is a real field report of the exact kind Shipwright is designed to consume.

---

## 9. Overnight addendum (2026-07-12, 02:29 → 07:58 UTC)

The run continued unattended after the validator wiring and ended cleanly on scope exhaustion.

| Metric (overnight) | Value |
|---|---|
| Tickets landed autonomously | **8** (W1-04/05/06, W2-04/05/06/07/08) |
| Board after | **19 done / 3 blocked / 41 to go** |
| Provider-limit pauses | **1** — hit at 05:20, slept 22m, **resumed on its own** |
| Crashes | 0 |
| How it ended | `conductor.idle` → clean exit: exhausted all claimable W0–W2 tickets |

**Two things validated in production:**
1. **Limit recovery works unattended.** The sleep-to-reset machinery fired for the first time (05:20) and the run resumed without intervention — the overnight-survival design is no longer just theoretical.
2. **The gate fix holds.** The 3 remaining blocks are *not* false blocks (the failure mode that plagued the pre-fix gate). They are **real**: W0-08 and W1-02 fail `typecheck` on genuine errors (`'err' is of type 'unknown'`; a missing `mintReceipt` export — a real cross-package integration mismatch), and W2-03 is a review-output parse hiccup, not a code finding. The fixed gate now blocks real failures and passes good work — exactly the intended behavior.

**Net across the whole session: 19/63 landed** (30%), the entire trust core + loop engine + full model gateway (all 8 provider/gateway tickets) on `main`, with the harness itself debugged into a working state along the way. The 3 blocks are small, real fixes (type narrowing, an export rename, one review re-run) awaiting a human — the correct place to stop.

*— Board at addendum: 19 done, 3 blocked (real), 41 to go. Run idle-exited on W0–W2 scope completion.*

---

## 10. Morning fixes — three more lessons (the 3 overnight blocks)

All 3 were fixed by hand and landed (board → **22 done, 0 blocked**; full W0–W2 foundation complete). Each taught something the earlier incidents hadn't:

1. **Cascading errors mask a single root cause (W0-08).** The visible failure was `'err' is of type 'unknown'` — which reads like a code defect. It wasn't. The CLI imported `@shipwright/tickets`, that module wouldn't resolve (missing dependency), so `TicketError` was `any`, so the `instanceof` narrowing silently failed, so `err` stayed `unknown`. **One missing dep produced a dozen errors, and the most prominent one pointed away from the cause.** A harness that just feeds the top error back to the model chases the symptom. The fix was one line — add the workspace deps.

2. **The write-scope-too-narrow pattern recurred, at the package boundary (W0-08).** The CLI needed `@shipwright/events/tickets/shared` as dependencies in `apps/server/package.json`, but its write_scope was only `apps/server/src/cli/**` — it *could not add its own dependencies*. This is the exact class that blocked W0-01 (lockfile) and W0-05 (migrations dir). **Recommendation for the plan-linter: when a ticket's code imports a workspace sibling, its write_scope must include that package's `package.json`.** Static, checkable, would have caught this before the run.

3. **The seam between two correct tickets is nobody's job (W1-02).** W0-05 built `mintReceipt`; W1-02 consumed it. Neither was wrong in isolation — but W0-05 never re-exported receipts from the package's public `index.ts`, so the function existed and was invisible. **Interface contracts between tickets need an explicit owner.** The ticket schema's `interface`/`module` fields exist for exactly this; the bootstrap conductor doesn't enforce them, so the seam fell through. The product's module-design layer does.

4. **Transient infra failures must not be counted as findings (W2-03).** W2-03's code was correct. It blocked because a provider-limit pause hit *mid-review*, the review session's output came back truncated/unparseable, and the conductor's fallback treated "unparseable" as a HIGH finding → 3 attempts → block. **A parse failure or an interrupted session is an infrastructure event, not a defect.** Fix owed to the harness: retry an unparseable review rather than scoring it as a finding.

**Meta:** none of these three were the models failing to write good code — they were **integration seams and harness robustness**. As the build moves from isolated primitives (W0) into wiring them together (W1/W2), the failure mode shifts from "is this unit correct" to "do the units compose" — which is precisely where the product's module-design + interface-contract layer earns its place, and where a single LLM per-ticket review is weakest.

*— Board: 22 done, 0 blocked, 41 to go. Releasing W3 (Harbormaster).*
