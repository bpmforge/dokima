/**
 * Loop-convergence policy barrel (BLUEPRINT §3.5, FR-L7, docs/design/FINDING_LOOP_POLICY.md
 * §2-4) — book-style split per CODE_BOOK_PROTOCOL (validate-file-size.sh cap):
 * `loop-policy-classify.ts` (iteration classifier + subjective-score asymmetry),
 * `loop-policy-budget.ts` (per-finding stall/escalation/oscillation budgets),
 * `loop-policy-convergence.ts` (progress-loop convergence + tier-aware ceiling),
 * `loop-policy-tracker.ts` (the combined per-pass decision). This file just re-exports the
 * public surface so callers only ever need `from './loop-policy.js'`.
 *
 * The load-bearing distinction (design doc §0): a STALL (same finding surviving fixes) and
 * PROGRESS (new findings as the reviewer sees deeper) are not the same failure and must not
 * share a budget. This module is the pure engine, like findings.ts/coverage.ts/calibration.ts:
 * no event log writes, no model calls — a caller (harbormaster/pipeline) wires it into the
 * actual review/fix loop.
 */

export * from './loop-policy-classify.js';
export * from './loop-policy-budget.js';
export * from './loop-policy-convergence.js';
export * from './loop-policy-tracker.js';
