/**
 * Autonomy dial + claim-gate (BLUEPRINT §3.7, SRS FR-N3, US-703). This is the
 * "book" entry for the autonomy dial (CODE_BOOK_PROTOCOL.md): shared types +
 * the frozen NEVER-AUTO pause-site set live in `autonomy-types.ts`, ledger
 * minting/reading in `autonomy-ledger.ts`, ledger runtime validation in
 * `autonomy-ledger-validate.ts`; this file owns the mode-dial policy itself
 * and the runtime gate that blocks progress on an invalid ledger.
 */

import type { EventLog } from '@dokima/events';
import {
  validateAutonomyLedger,
  type LedgerValidationResult,
  type ValidateLedgerOptions,
} from './autonomy-ledger-validate.js';
import {
  isNeverAutoPauseSite,
  type AutonomyMode,
  type PauseSiteKind,
} from './autonomy-types.js';

export type PauseResolution = 'ask_human' | 'take_default';

/**
 * The single enforcement point (SC-10, mirroring `review-queue-classifier.ts`'s
 * `assertExecutionAllowed`) for what happens at a gated pause site, given the
 * project's autonomy mode: `interactive` always asks; `auto` takes the
 * documented default *except* at a NEVER-AUTO site, which always asks
 * regardless of mode (CONSTRAINTS.md C-5 — the dial cannot override it).
 */
export function resolvePauseAction(
  mode: AutonomyMode,
  pauseSite: PauseSiteKind,
): PauseResolution {
  if (mode === 'interactive') return 'ask_human';
  return isNeverAutoPauseSite(pauseSite) ? 'ask_human' : 'take_default';
}

export class AutonomyLedgerInvalidError extends Error {
  constructor(public readonly errors: readonly string[]) {
    super(
      `autonomy ledger is invalid — the next claim is blocked until it is fixed (FR-N3): ${errors.join('; ')}`,
    );
    this.name = 'AutonomyLedgerInvalidError';
  }
}

/**
 * The runtime gate SRS FR-N3 asks for: "a missing/malformed row blocks the
 * next claim." Throws `AutonomyLedgerInvalidError` (carrying every problem
 * found, not just the first) when `validateAutonomyLedger` finds anything
 * wrong; a caller wiring this into `runClaimLoop`'s outer loop (out of this
 * ticket's `packages/harbormaster/src/autonomy*` write_scope — see
 * `loop-claim.ts`'s own `stopSwitch`/`breakerLevel` checks for the
 * equivalent per-iteration hook shape this should join) would call it once
 * per outer-loop iteration, before picking the next ticket, exactly like the
 * existing kill-switch and budget-breaker checks.
 */
export function assertLedgerValidForNextClaim(
  log: EventLog,
  opts: ValidateLedgerOptions = {},
): void {
  const result: LedgerValidationResult = validateAutonomyLedger(log, opts);
  if (!result.valid) {
    throw new AutonomyLedgerInvalidError(result.errors);
  }
}

export * from './autonomy-types.js';
export * from './autonomy-ledger.js';
export * from './autonomy-ledger-validate.js';
