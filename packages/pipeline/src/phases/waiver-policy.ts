/**
 * FR-G5: soft-gate waivers permitted on phases 0–3 only; build/verify gates
 * (phase 4–5) never soften, regardless of model tier or who signs. This is a
 * *policy* check — is a waiver even eligible for this phase at all — layered
 * in front of `@dokima/events`' `mintReceipt`/`verifyReceipt`, which
 * already enforces the orthogonal FR-P2 concern (the signer must be human,
 * not agent-blocklisted). Neither primitive substitutes for the other:
 * a validly human-signed waiver receipt for phase 4 must still be rejected
 * here (docs/TESTING.md §6 "Soft-gate on build" red fixture).
 */
import type { PhaseDefinition } from './types.js';

export class SoftGateNotEligibleError extends Error {
  constructor(phase: PhaseDefinition) {
    super(
      `soft-gate waivers are not permitted on phase ${phase.id} (${phase.name}) — ` +
        'build/verify gates never soften regardless of model tier or signer (FR-G5)',
    );
    this.name = 'SoftGateNotEligibleError';
  }
}

/** Throws `SoftGateNotEligibleError` when `phase.waiverEligible` is false. */
export function assertWaiverEligible(phase: PhaseDefinition): void {
  if (!phase.waiverEligible) {
    throw new SoftGateNotEligibleError(phase);
  }
}
