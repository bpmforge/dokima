/**
 * Advance-to-next-phase decision (FR-P1/P2, BLUEPRINT §3.2 "Gate mechanism").
 *
 * FR-P1 (receipts): a clean phase-validator run mints a gate receipt
 * (`@shipwright/events` `mintReceipt`/`mintValidatorRunReceipt` — out of
 * reach from this write_scope, see types.ts header) keyed by this module's
 * `PHASES[n].validators` as the required set.
 *
 * FR-P2 (two-way prereq re-verification): advancing from phase N re-verifies
 * phase N's gate receipt two ways — recomputed input-tree hash (catches
 * silently edited docs) and validator-set currency (catches gate-definition
 * drift, i.e. `PHASES[n].validators` growing since the receipt was minted).
 * Both checks already live in `@shipwright/events`' `verifyReceipt`; this
 * module does not re-implement them — `deps.verifyReceipt` is the injected
 * seam the wiring ticket binds to the real function (called with
 * `requiredValidators: PHASES[n].validators`, per FR-P2's "currently
 * required" wording — always read live from this topology, never frozen at
 * mint time).
 *
 * The only bypass is a waiver receipt, itself independently re-verified
 * (same `deps.verifyReceipt` seam — waiver receipts get the FR-P2 human/
 * agent-blocklist re-check on top of the anchor MAC, per receipts.ts) *and*
 * gated by `assertWaiverEligible` (FR-G5): a waiver that verifies clean is
 * still refused on phases 4–5.
 */
import { assertWaiverEligible, SoftGateNotEligibleError } from './waiver-policy.js';
import { getPhase, isLastPhase, nextPhase } from './topology.js';
import type { PhaseId, ReceiptVerificationResult } from './types.js';

export interface AdvanceInput {
  readonly fromPhaseId: PhaseId;
  /** The phase's own gate receipt id, if a validator run has ever completed for it. */
  readonly gateReceiptId: string | null;
  /** An explicit waiver receipt id for this phase, if one was minted. */
  readonly waiverReceiptId: string | null;
}

export interface AdvanceDeps {
  /** Re-verifies a receipt (gate or waiver) against current input files + the
   * currently-required validator set — the real implementation is
   * `@shipwright/events`' `verifyReceipt`. */
  readonly verifyReceipt: (receiptId: string) => ReceiptVerificationResult;
}

export interface AdvanceResult {
  readonly allowed: boolean;
  readonly fromPhaseId: PhaseId;
  readonly toPhaseId: PhaseId;
  readonly waived: boolean;
  readonly reasons: readonly string[];
}

function refused(
  fromPhaseId: PhaseId,
  toPhaseId: PhaseId,
  reasons: readonly string[],
): AdvanceResult {
  return { allowed: false, fromPhaseId, toPhaseId, waived: false, reasons };
}

/**
 * Decides whether `fromPhaseId` may advance to the next phase. Never throws
 * on a refused advance (the reasons are the point — FR-P3 "the UI states
 * which receipts became stale and why" applies equally here); throws only on
 * an impossible request (unknown phase, or phase 5 has no next phase).
 */
export function decideAdvance(input: AdvanceInput, deps: AdvanceDeps): AdvanceResult {
  const fromPhase = getPhase(input.fromPhaseId);
  if (isLastPhase(fromPhase.id)) {
    throw new Error(
      `phase ${fromPhase.id} (${fromPhase.name}) is the last phase — no advance`,
    );
  }
  const toPhase = nextPhase(fromPhase.id);

  if (!input.gateReceiptId) {
    return refused(fromPhase.id, toPhase.id, [
      `phase ${fromPhase.id} (${fromPhase.name}) has no gate receipt — run its validator set first`,
    ]);
  }

  const gate = deps.verifyReceipt(input.gateReceiptId);
  if (gate.valid) {
    return {
      allowed: true,
      fromPhaseId: fromPhase.id,
      toPhaseId: toPhase.id,
      waived: false,
      reasons: [],
    };
  }

  if (!input.waiverReceiptId) {
    return refused(fromPhase.id, toPhase.id, gate.reasons);
  }

  try {
    assertWaiverEligible(fromPhase);
  } catch (err) {
    if (err instanceof SoftGateNotEligibleError) {
      return refused(fromPhase.id, toPhase.id, [...gate.reasons, err.message]);
    }
    throw err;
  }

  const waiver = deps.verifyReceipt(input.waiverReceiptId);
  if (!waiver.valid) {
    return refused(fromPhase.id, toPhase.id, waiver.reasons);
  }

  return {
    allowed: true,
    fromPhaseId: fromPhase.id,
    toPhaseId: toPhase.id,
    waived: true,
    reasons: [],
  };
}
