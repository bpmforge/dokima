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
import { redactString } from '@dokima/shared';
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
 * W23-50: how long a free retry waits before it re-runs. LIVE 2026-09-23: LM
 * Studio evicted the maker to load another client's model, answered "Failed
 * to load model ... Operation canceled" for about a second, and Dokima's three
 * free retries all ran inside 200 ms of each other — the whole budget spent
 * inside the reload window, and the ticket parked as "attempted nothing".
 *
 * Exponential with a cap: 5 s, 15 s, 45 s for an endpoint that failed, and a
 * longer start (15 s, 45 s, 60 s) when the provider's own words say a model is
 * loading or was unloaded — a 27B reload takes seconds, not milliseconds. The
 * count of free retries is unchanged; only their spacing is new.
 */
export const INFRA_RETRY_BACKOFF = Object.freeze({
  baseMs: 5_000,
  modelLoadBaseMs: 15_000,
  factor: 3,
  capMs: 60_000,
});

/** LM Studio / MTPLX / Ollama phrasings for "the model is not resident right now". */
const MODEL_RELOAD =
  /failed to load model|model unloaded|model_not_loaded|model is (?:loading|not loaded)|operation canceled|channel error/i;

/** The wait before free retry number `retry` (1-based). */
export function infraRetryDelayMs(retry: number, detail?: string): number {
  const base =
    detail && MODEL_RELOAD.test(detail)
      ? INFRA_RETRY_BACKOFF.modelLoadBaseMs
      : INFRA_RETRY_BACKOFF.baseMs;
  const delay = base * INFRA_RETRY_BACKOFF.factor ** Math.max(0, retry - 1);
  return Math.min(delay, INFRA_RETRY_BACKOFF.capMs);
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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
  /**
   * W21-13: `detail` is the provider's own words. The category alone left an
   * operator unable to tell a timeout from a refused connection from a 500,
   * which point at completely different fixes — and cost real misdiagnoses
   * during the live UAT before this was threaded through.
   */
  take(kind: InfraFailureKind | null, attempt: number, detail?: string): Promise<boolean>;
  /** How many retries were absorbed — evidence, not a counter the cap uses (W21-15). */
  absorbed(): number;
}

/** The ledger is not a log: enough of the provider's words to act on, no more. */
const MAX_REASON_CHARS = 500;

function trimReason(text: string): string {
  const line = text.trim();
  return line.length > MAX_REASON_CHARS ? `${line.slice(0, MAX_REASON_CHARS)}…` : line;
}

export function createFreeRetryGate(
  options: LandLoopOptions,
  ticketId: string,
  ceiling: number,
): FreeRetryGate {
  const infra: InfraFailureTracker = createInfraFailureTracker();
  return {
    limit: () => ceiling + infra.total,
    take: (kind, attempt, detail) =>
      takeFreeInfraRetry(options, infra, kind, ticketId, attempt, detail),
    absorbed: () => infra.total,
  };
}

async function takeFreeInfraRetry(
  options: LandLoopOptions,
  infra: InfraFailureTracker,
  kind: InfraFailureKind | null,
  ticketId: string,
  attempt: number,
  detail?: string,
): Promise<boolean> {
  if (!kind || infra.total >= MAX_FREE_INFRA_RETRIES) return false;
  infra.record(kind);
  const waitMs = infraRetryDelayMs(infra.total, detail);
  // Recorded so the run explains itself: a ticket that took four passes to
  // land should say why, rather than looking like a model that needed four
  // tries.
  appendEvent(options.log, {
    eventType: 'session.infra_retry',
    actorId: options.actorId,
    ticketId,
    // The reason goes through the same redaction layer the report and the
    // handoff use: a provider error happily echoes back a URL or a key.
    payload: {
      kind,
      freeRetries: infra.total,
      attempt,
      waitMs,
      ...(detail ? { reason: trimReason(redactString(detail)) } : {}),
    },
  });
  // W23-50: the wait happens AFTER the ledger row, so a run someone is watching
  // says why it is idle before it goes quiet.
  await (options.sleep ?? realSleep)(waitMs);
  return true;
}

/**
 * True when two attempts produced the same gaps — order-insensitive, because
 * a gate that lists the same two reasons in the other order has still told the
 * maker nothing new (W13-29).
 */
export function sameGaps(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, i) => value === right[i]);
}
