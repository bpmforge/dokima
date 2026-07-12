# Release tracker — Shipwright (SECOND in the release order; PAUSED)

**State 2026-07-12:** 23/65 tickets landed (W0–W2 foundation + E2E complete); W3-01 blocked;
build **deliberately paused** until bpm-opencode-experts v2.1.0 ships (founder decision).
Board = `plan.json` · alignment = `bpm-opencode-experts/docs/ALIGNMENT_MATRIX.md` (SW-* items).

## The process issue — why the build is down (written for the record)

Four distinct causes, none of them "the models can't code":

1. **W3-01 hit the hardest-primitive pattern.** The Harbormaster ticket loop is the third
   trust-core ticket (after W0-02 hash chain, W0-05 receipts) to exhaust the Sonnet→Sonnet→Opus
   ladder. Trust-core primitives reliably need human hands or pairing; the straightforward 80%
   lands autonomously. This is a *known, budgeted* cost, not a failure — but W3-01 is also a
   **dependency chokepoint**: every other W3 ticket depends on it, so its block idle-exits the
   whole run (nothing else claimable).
2. **W3-01 violates our own decomposition policy.** 5 points, orchestrator-core, review kept
   finding one-more-blocker each pass ("ceiling while progressing = the ticket is too big —
   split it", FINDING_LOOP_POLICY §3). It bundles claim-loop + out-of-session gates + land/park
   into one ticket.
3. **Account-level limit contention.** Two conductors (Shipwright + amplifier) share one Claude
   account; running both halves throughput and doubles limit pauses. Serializing programs is
   strictly faster end-to-end.
4. **Upstream content drift.** Shipwright imported the expert library at v2.0.0-day-0; the
   amplifier stream is actively changing it (v2.1.0 pending). Building the product against a
   moving canonical library invites a re-import churn mid-build.

## The fix plan (execute at resume)

- **F1 — split W3-01** into W3-01a (claim loop + fresh-session dispatch), W3-01b (out-of-session
  gate execution vs a fixture manifest), W3-01c (land/park + failure comments) — each ≤3 pts with
  its own verify; keep the existing branch's code as seed material. *(Fixes cause 2 → unblocks 1.)*
- **F2 — human-pair the trust-core lane:** W3-01a/b get hand-review before merge regardless of
  ladder outcome (same treatment that landed W0-02/W0-05 clean).
- **F3 — resume only after opencode v2.1.0** (cause 3+4): then `node scripts/import-content.mjs`
  re-sync (SW-R1) so `content/` matches the released library, commit, and relaunch:
  `nohup caffeinate -dimsu bash scripts/supervise.sh --waves W0,W1,W2,W3 --breakpoint never --escalate >> docs/work/conductor.out 2>&1 &`
- **F4 — W3-08/W3-09 early:** finding ledger + Harbormaster symlink-safety land inside W3 (they
  harden the very loop being built).

## Release milestones

| Tag | Scope | Gate |
|---|---|---|
| **v0.1.0-foundation** | W0–W3 complete (trust core, loop, gateway, Harbormaster) | full pnpm gate + planted-defect harness green; conductor self-hosts a fixture board |
| v0.2.0 | + W4 Canvas/Fleet | Playwright E2E over fake-model gateway |
| v0.3.0 | + W5 Pipeline/PM (interview→blueprint→slates→decompose) | sample idea runs <15 min on a local model |
| v0.9.0 | + W6 integrations, W7 memory | forge-mirror reconciliation + anti-Jarvis-gap recall test |
| **v1.0.0** | W8 dogfood: Shipwright audits itself | its own security cluster passes; receipts published in docs/dogfood/ |

Pre-public checklist (any tag ≥0.3): D-001 naming pass (shipwright.io collision) · LICENSE
(D-006 open — founder picks Apache-2.0/MIT) · README quickstart · history secrets scan.

## Test truth
`pnpm lint && pnpm typecheck && pnpm test` (616+ tests) per ticket (conductor-gated) ·
planted-defect harness (every gate must FAIL when attacked — TESTING.md) · toy-project E2E incl.
symlink-escape regression · fitness bench fixtures W2-08 · Playwright from W4 · dogfood at W8.

## Automation
Already built and field-proven in this repo: `scripts/conductor.mjs` (config-driven, worktree
isolation, plan-lint preflight, diff-scoped validators, sticky-finding review, limit recovery)
+ `scripts/supervise.sh` (crash restart). Resume = F3 command above; control `touch STOP`;
runbook `docs/work/CONDUCTOR_RUNBOOK.md`.

## Status log
- 2026-07-12 — paused pending opencode v2.1.0; process issue + fix plan recorded; W3-01 marked
  for split (F1) at resume.
