import type { IterationClass } from './loop-policy-classify.js';

/**
 * Progress-loop convergence + tier-aware ceiling (CODE_BOOK_PROTOCOL chapter of loop-policy.ts
 * — design doc §3).
 */

/** Frontier/metered (tokens cost money) vs local/owned-hardware (tokens ~free) — FINDING_LOOP_POLICY §3. */
export type EconomicTier = 'metered' | 'local';

/** Hard ceiling on a PROGRESSED-classified pass count for metered tiers. */
export const METERED_PROGRESS_CEILING_CAP = 8;
/** Floor (not a hard cap — the wall-clock watchdog is the backstop) on local tiers. */
export const LOCAL_PROGRESS_CEILING_FLOOR = 12;

/**
 * `base(3) + ticket_points`, capped at 8 on frontier/metered tiers; on local/owned-hardware
 * tiers the ceiling instead rises to at least 12 (localFrontier-proven — 12 iterations landed
 * complete SDLCs that a flat cap of 3 hard-escalated). Never below the floor/cap regardless of
 * how small `ticketPoints` is.
 */
export function computeProgressCeiling(ticketPoints: number, tier: EconomicTier): number {
  const base = 3 + ticketPoints;
  return tier === 'metered'
    ? Math.min(base, METERED_PROGRESS_CEILING_CAP)
    : Math.max(base, LOCAL_PROGRESS_CEILING_FLOOR);
}

export type ProgressCeilingAction = 'CONTINUE' | 'PARK';

export interface ProgressCeilingCheck {
  readonly ceiling: number;
  readonly action: ProgressCeilingAction;
}

/**
 * Only meaningful for a pass classified PROGRESSED (other classes are governed by
 * `FindingBudgetTracker`, which strikes well before this ceiling). Hitting the ceiling while
 * still PROGRESSED is a park, not a failure (§3: "the ticket is decomposing badly, split it").
 */
export function checkProgressCeiling(
  passesUsed: number,
  ticketPoints: number,
  tier: EconomicTier,
): ProgressCeilingCheck {
  const ceiling = computeProgressCeiling(ticketPoints, tier);
  return { ceiling, action: passesUsed >= ceiling ? 'PARK' : 'CONTINUE' };
}

export interface PassOpenCount {
  readonly pass: number;
  readonly openCount: number;
  readonly iterationClass: IterationClass;
}

export type ConvergenceStatus = 'CONVERGING' | 'DIVERGED';

/**
 * Sliding 2-pass convergence window (design doc §3): `open_findings` must strictly decrease OR
 * the pass must be PROGRESSED. Two consecutive passes with non-decreasing open count and no
 * prior-resolutions is divergence — stop now. A PROGRESSED pass always satisfies the OR clause
 * by construction, so a loop that is still resolving priors is never killed just because new
 * findings surfaced (§4's mirror rule).
 */
export function checkConvergence(history: readonly PassOpenCount[]): ConvergenceStatus {
  if (history.length < 2) {
    return 'CONVERGING';
  }
  const prev = history[history.length - 2]!;
  const curr = history[history.length - 1]!;
  if (curr.iterationClass === 'PROGRESSED') {
    return 'CONVERGING';
  }
  return curr.openCount < prev.openCount ? 'CONVERGING' : 'DIVERGED';
}
