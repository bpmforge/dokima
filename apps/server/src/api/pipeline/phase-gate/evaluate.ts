/**
 * Pure pass/fail decision over a set of real validator run results (W9-06, FR-P1 "no
 * receipt without a real run"). Split out from `runner.ts` so both branches — "a
 * genuinely failing validator mints no receipt" and "no validator run at all mints no
 * receipt" — are unit-testable directly against contrived `ValidatorRunResult[]`
 * without needing a live topology phase to reach an empty-results case (the six real
 * `PHASES` entries all declare at least `validate-mermaid`, R-H3).
 */
import type { ValidatorRunResult } from '@shipwright/validators';

export interface PhaseGateEvaluation {
  readonly ok: boolean;
  readonly reasons: readonly string[];
}

/**
 * `exitCode` is `runValidator`'s 0/1/2 contract: 0 = clean, 1 = gaps found, 2 = verdict
 * untrustworthy (timeout, spawn error, malformed output, or a self-reported contract
 * violation). ALL THREE non-zero-or-any-nonzero values refuse the mint identically —
 * `exitCode !== 0` never distinguishes "didn't fail" from "passed", and 2 is never
 * coerced to 0 or read as a pass (`packages/harbormaster/src/loop-gates.ts:203-212`'s
 * fail-closed precedent for exactly this contract).
 */
export function evaluatePhaseGateResults(
  results: readonly ValidatorRunResult[],
): PhaseGateEvaluation {
  if (results.length === 0) {
    return { ok: false, reasons: ['no validator run to attest — no receipt minted'] };
  }

  const failed = results.filter((r) => r.exitCode !== 0);
  if (failed.length > 0) {
    return {
      ok: false,
      reasons: failed.map(
        (r) => `${r.name} exited ${r.exitCode} (${r.gapCount} gap(s)) — not a clean run`,
      ),
    };
  }

  return { ok: true, reasons: [] };
}
