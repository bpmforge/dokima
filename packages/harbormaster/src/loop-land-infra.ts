/**
 * loop-land-infra.ts — infrastructure failures retry for free (W13-27).
 *
 * Chapter of `loop-land.ts`, split at the 400-line CODE_BOOK_PROTOCOL cap that
 * file sits on. The seam is real: this is "was that failure about the work, or
 * about the plumbing", while `loop-land.ts` is the ladder that decides what to
 * do about a failure that was about the work.
 *
 * `findings-infra.ts` has stated this rule since it was written — an
 * unparseable verdict, a limit pause, a watchdog kill, an endpoint failure
 * "retries for free" — and nothing had ever constructed the tracker. Meanwhile
 * every failure cost an attempt equally, so with the default ceiling of two, a
 * pair of endpoint hiccups parked a ticket whose work was never judged. A park
 * needs a person to clear it, which is the symptom this exists to remove: the
 * run stopping to wait for someone to tell it to continue.
 */
import { appendEvent } from '@dokima/events';
import { createInfraFailureTracker } from '@dokima/loop';
import type { InfraFailureKind, InfraFailureTracker } from '@dokima/loop';
import type { LandLoopOptions } from './loop-land.js';
import {
  LAND_CONVERGENCE_CEILING,
  type LandEscalationPolicy,
} from './loop-land-policy.js';

/**
 * How many times an infrastructure failure may retry without costing an
 * attempt. Three, not unlimited: an endpoint that is genuinely down must still
 * reach a park with evidence rather than spin, and an operator watching a run
 * needs it to end.
 */
export const MAX_FREE_INFRA_RETRIES = 3;

/**
 * The attempt ceiling for `policy`'s mode (D-018: ladder's fixed cap, locked's
 * FR-L7 convergence ceiling, token-gated's climbable R1-R3 range).
 *
 * Moved here beside the free-retry gate (W13-27): "how many passes are
 * allowed" and "which passes are free" are one question asked twice, and the
 * gate's own `limit()` is the sum of them.
 */
export function ceilingFor(
  policy: LandEscalationPolicy,
  maxLadderAttempts: number,
): number {
  switch (policy.mode) {
    case 'ladder':
      return maxLadderAttempts;
    case 'locked':
      return LAND_CONVERGENCE_CEILING[policy.tierKind];
    case 'token-gated':
      return 3; // R1-R3, the full climbable range before R4's terminal park.
  }
}

/**
 * True when this pass should be retried without charging the ladder.
 *
 * Returns false for a `null` kind, which is the important half: a session that
 * ANSWERED but returned no Completion Manifest is not an infrastructure
 * failure, it is the model failing the contract, and it must keep costing an
 * attempt. A catch-all here would turn a real defect into an infinite free
 * retry — the silence this product exists to refuse.
 */
export interface FreeRetryGate {
  /** Ladder ceiling plus the free retries spent so far — the loop's real bound. */
  limit(): number;
  take(kind: InfraFailureKind | null, attempt: number): boolean;
}

export function createFreeRetryGate(
  options: LandLoopOptions,
  ticketId: string,
  ceiling: number,
): FreeRetryGate {
  const infra: InfraFailureTracker = createInfraFailureTracker();
  return {
    limit: () => ceiling + infra.total,
    take: (kind, attempt) => takeFreeInfraRetry(options, infra, kind, ticketId, attempt),
  };
}

function takeFreeInfraRetry(
  options: LandLoopOptions,
  infra: InfraFailureTracker,
  kind: InfraFailureKind | null,
  ticketId: string,
  attempt: number,
): boolean {
  if (!kind || infra.total >= MAX_FREE_INFRA_RETRIES) return false;
  infra.record(kind);
  // Recorded so the run explains itself: a ticket that took four passes to
  // land should say why, rather than looking like a model that needed four
  // tries.
  appendEvent(options.log, {
    eventType: 'session.infra_retry',
    actorId: options.actorId,
    ticketId,
    payload: { kind, freeRetries: infra.total, attempt },
  });
  return true;
}
