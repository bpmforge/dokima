/**
 * FR-P3: "user can edit any deliverable at any time; edits invalidate
 * downstream receipts (hash change) and the UI states which receipts became
 * stale and why." A single phase's own staleness (input-hash mismatch or
 * validator-set drift) is `verifyReceipt`'s job (`@dokima/events`,
 * injected here — see advance.ts). What that primitive does *not* know is
 * the cross-phase consequence: phase N+1 was only ever advanced-into because
 * phase N's receipt verified clean *at that time* — if phase N's receipt is
 * later found stale, everything gated on top of it is no longer provably
 * valid either, even though its own hash still checks out. This module
 * computes that cascade so the caller can show it, not just the one flipped
 * receipt.
 */
import type {
  PhaseId,
  PhaseStalenessResult,
  ReceiptVerificationResult,
} from './types.js';

export interface PhaseReceiptRef {
  readonly phaseId: PhaseId;
  readonly receiptId: string;
}

/**
 * `receipts` need not cover every phase (a phase that hasn't gated yet has
 * no receipt to check) — sparse input is fine, evaluated in phase order.
 * Once one phase is found stale (directly or inherited), every later phase
 * in `receipts` is reported stale-by-inheritance regardless of its own
 * verification result, even if that phase's own hash still matches.
 */
export function computeDownstreamStaleness(
  receipts: readonly PhaseReceiptRef[],
  verifyReceipt: (ref: PhaseReceiptRef) => ReceiptVerificationResult,
): PhaseStalenessResult[] {
  const sorted = [...receipts].sort((a, b) => a.phaseId - b.phaseId);
  const results: PhaseStalenessResult[] = [];
  let upstreamStalePhase: PhaseId | null = null;

  for (const ref of sorted) {
    if (upstreamStalePhase !== null) {
      results.push({
        phaseId: ref.phaseId,
        stale: true,
        reasons: [
          `downstream of phase ${upstreamStalePhase}, which is stale — its own receipt is no longer trustworthy as this phase's prerequisite (FR-P3)`,
        ],
      });
      continue;
    }
    const verification = verifyReceipt(ref);
    if (verification.valid) {
      results.push({ phaseId: ref.phaseId, stale: false, reasons: [] });
    } else {
      upstreamStalePhase = ref.phaseId;
      results.push({
        phaseId: ref.phaseId,
        stale: true,
        reasons: [...verification.reasons],
      });
    }
  }

  return results;
}
