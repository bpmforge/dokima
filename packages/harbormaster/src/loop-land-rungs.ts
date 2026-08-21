/**
 * loop-land-rungs.ts — the ladder's climb, per attempt (W16-01).
 *
 * Chapter of `loop-land.ts`, split under the 400-line CODE_BOOK_PROTOCOL cap
 * when the rung->session seam pushed that file to 484. The seam is real: the
 * land loop owns WHEN another attempt happens; this chapter owns WHICH rung
 * that attempt runs at, the session swap, and the canonical FR-G3 escalation
 * event a climb appends. The loop stays model-agnostic throughout — a rung is
 * an attempt tier, and what runs at each tier is the composing seam's
 * business (`LandRungSessions`, wired in apps/server).
 */
import { appendEvent } from '@dokima/events';
import type { SpawnSession } from '@dokima/loop';
import type { LandAttempt, LandLoopOptions } from './loop-land.js';
import { runAttemptOutcomeHook } from './loop-land-outcome.js';
import {
  isHigherRung,
  rungForAttempt,
  type LandEscalationPolicy,
  type LandFailureReceipt,
} from './loop-land-policy.js';

/**
 * W16-01: the failed attempt's evidence, in the gateway ladder's own
 * `FailureReceipt` shape (FR-G3: a climb always carries what triggered it).
 * A failed close gate contributes its reasons; a session that never produced
 * a manifest is itself the evidence.
 */
export function failureReceiptsFor(previous: LandAttempt): readonly LandFailureReceipt[] {
  if (previous.closeGate && !previous.closeGate.ok) {
    return [
      {
        name: 'close-gate',
        exitCode: 1,
        gapCount: previous.closeGate.reasons.length,
        gaps: previous.closeGate.reasons.slice(0, 8),
      },
    ];
  }
  return [
    {
      name: 'session',
      exitCode: previous.session.exitCode ?? 1,
      gapCount: 1,
      gaps: ['the session produced no completion manifest, so the close gate never ran'],
    },
  ];
}

export interface RungAttemptStart {
  /** The options `attemptOnce` should run with — `spawn` swapped to the rung's session when a seam is present. */
  readonly options: LandLoopOptions;
  /** The seam's label for what runs this attempt (a model name where the seam knows one); absent without a seam. */
  readonly sessionLabel?: string;
}

/**
 * Decides the rung for the next REAL attempt (infra-failure retries are free
 * and never climb — FR-G3: escalation is evidence-triggered, and a crashed
 * sandbox is not evidence about the model), swaps in that rung's session,
 * and — on a climb — appends the canonical `escalation.rung_advanced` event
 * (same payload shape as the gateway ladder's own emit) before firing the
 * seam's optional notice hook. Without a seam this returns the options
 * untouched: byte-identical to the pre-W16-01 loop.
 */
export async function beginRungAttempt(
  options: LandLoopOptions,
  policy: LandEscalationPolicy,
  ticketId: string,
  attempts: readonly LandAttempt[],
): Promise<RungAttemptStart> {
  if (!options.rungSessions) return { options };

  const realAttempt = attempts.length + 1;
  const rung = rungForAttempt(policy, realAttempt);
  const rungSession = options.rungSessions.sessionForRung(rung);

  if (attempts.length > 0) {
    const previousRung = rungForAttempt(policy, attempts.length);
    if (isHigherRung(previousRung, rung)) {
      const receipts = failureReceiptsFor(attempts[attempts.length - 1]!);
      appendEvent(options.log, {
        eventType: 'escalation.rung_advanced',
        actorId: options.actorId,
        ticketId,
        payload: { fromRung: previousRung, toRung: rung, receipts },
      });
      await runAttemptOutcomeHook(options, () =>
        options.rungSessions?.onRungAdvance?.({
          ticketId,
          attempt: realAttempt,
          fromRung: previousRung,
          toRung: rung,
          sessionLabel: rungSession.label,
          receipts,
        }),
      );
    }
  }

  const spawn: SpawnSession = rungSession.spawn;
  return { options: { ...options, spawn }, sessionLabel: rungSession.label };
}
