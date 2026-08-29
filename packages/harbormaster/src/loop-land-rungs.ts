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
import { appendEvent, listEvents } from '@dokima/events';
import { latestRejectionReason } from '@dokima/tickets';
import type { SpawnSession } from '@dokima/loop';
import type { LandAttempt, LandLoopOptions } from './loop-land.js';
import { runAttemptOutcomeHook } from './loop-land-outcome.js';
import { commentTicket } from '@dokima/tickets';
import {
  cannotActAgentically,
  isHigherRung,
  modelToolProfiles,
  rungForAttempt,
  unfitRungNotice,
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
  /**
   * W21-55: rungs already known to have failed this ticket (W21-46). Shifts
   * which RUNG runs without consuming an ATTEMPT — the two are deliberately
   * separate numbers. W21-15 made `realAttempt` count only JUDGED attempts so
   * the park evidence can never read "attempt 5/2"; the first version of the
   * rung-memory fix moved the loop counter instead and so moved neither, which
   * a live run caught: the skip said "starts above R1" and R1's model ran.
   */
  rungOffset = 0,
): Promise<RungAttemptStart> {
  if (!options.rungSessions) return { options };

  const realAttempt = attempts.length + 1;
  let rung = rungForAttempt(policy, realAttempt + rungOffset);
  let rungSession = options.rungSessions.sessionForRung(rung);

  /**
   * W21-66: do not climb to a rung that browses instead of acting.
   *
   * The ladder assumed a higher rung is BETTER, because D-018 frames
   * escalation as cheapest-first. Measured on this machine's real ledgers,
   * that is not always true: one model made 106 tool calls on a project and
   * changed nothing — `read x66, list x40` — while the cheaper coding model
   * mutated on a third of its calls. Escalating there traded a model that
   * edits for one that reads.
   *
   * NEVER SKIPS THE LAST RUNG, and that guard is the whole lesson of W21-63,
   * which fixed the mirror image an hour earlier: a ladder that skipped to an
   * unreachable rung and parked with NO session at all. Condemn every rung and
   * there is nothing left to run, which is worse than running an imperfect
   * model. So the skip only ever applies while a different rung remains.
   */
  const profiles = modelToolProfiles(options.log);
  // Three rungs at most, so three tries at most — a bound, not a while-true.
  for (let guard = 0; guard < 3; guard += 1) {
    if (!cannotActAgentically(profiles.get(rungSession.label ?? ''))) break;
    const nextRung = rungForAttempt(policy, realAttempt + rungOffset + guard + 1);
    const nextSession = options.rungSessions.sessionForRung(nextRung);
    // The last rung, or a chain that clamps to one session: stop and use it.
    if (nextSession.label === rungSession.label) break;
    commentTicket(
      options.log,
      {
        ticketId,
        actorId: options.actorId,
        body: unfitRungNotice(rungSession.label ?? rung, profiles.get(rungSession.label ?? '')!),
      },
      { runId: options.runId ?? null },
    );
    rung = nextRung;
    rungSession = nextSession;
  }

  if (attempts.length > 0) {
    const previousRung = rungForAttempt(policy, attempts.length + rungOffset);
    // W17-04: a tier advance is only an ESCALATION when the session actually
    // changes. A one-model chain (fallback: []) clamps every rung to the same
    // session, and ledgering that as `escalation.rung_advanced` made the
    // trace say "Escalated to a stronger model" about the same model — a
    // mechanism-true event rendering a false sentence. The previous attempt's
    // own session label is on the attempt record; compare labels, not tiers.
    const previousLabel = attempts[attempts.length - 1]!.sessionLabel;
    if (isHigherRung(previousRung, rung) && rungSession.label !== previousLabel) {
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

/**
 * W16-03: the rung-ZERO consult — "have we solved this before?" (BLUEPRINT
 * §3.3, FR-M2/FR-F5), asked once per ticket before any model spend. The
 * memory layer answers (apps/server composes the hook — harbormaster may
 * not import `memory`, ARCHITECTURE §4); a verified hit becomes the
 * `priorSolution` block leading the first handoff. Deliberately NOT the
 * gateway ladder's resolve-without-an-attempt R0 (refused by
 * loop-land-policy.ts's header): the close gate still decides (C-2), so a
 * stale hit simply fails the gate and the ladder proceeds.
 */
export interface LandR0ConsultResult {
  readonly answered: boolean;
  readonly findingId?: string;
  readonly summary?: string;
}

export interface LandR0Consult {
  consult(input: {
    readonly ticketId: string;
    readonly criterion: string;
  }): LandR0ConsultResult | Promise<LandR0ConsultResult>;
}

/**
 * Consults once, before attempt 1. A consult failure is ledgered and
 * swallowed (`runAttemptOutcomeHook`'s posture: a memory store having a bad
 * day must never park a ticket). Returns the seed feedback for the first
 * handoff, or undefined on a miss / no hook.
 */
export async function consultRungZero(
  options: LandLoopOptions,
  ticket: {
    readonly id: string;
    readonly title: string;
    readonly acceptance: readonly { readonly text: string }[];
  },
): Promise<
  | {
      attempt: 0;
      gaps: readonly string[];
      priorSolution?: { findingId: string; summary: string };
    }
  | undefined
> {
  /**
   * W21-42: a rejection outranks a playbook hit. If a reviewer sent this
   * ticket back, that judgement is the most specific thing anyone knows about
   * it — more specific than "we solved something like this before" — and it
   * has no receipt behind it, so if it does not reach the maker it reaches
   * nobody. Cleared by a later close (the maker answered it), so a stale
   * judgement never follows a ticket forward.
   */
  const rejection = latestRejectionReason(listEvents(options.log), ticket.id);
  if (rejection) {
    return { attempt: 0, gaps: [`a reviewer sent this back: ${rejection}`] };
  }
  if (!options.r0Consult) return undefined;
  let result: LandR0ConsultResult | undefined;
  await runAttemptOutcomeHook(options, async () => {
    result = await options.r0Consult!.consult({
      ticketId: ticket.id,
      criterion: ticket.acceptance[0]?.text ?? ticket.title,
    });
  });
  if (!result?.answered || !result.summary) return undefined;
  return {
    attempt: 0,
    gaps: [],
    priorSolution: { findingId: result.findingId ?? 'unknown', summary: result.summary },
  };
}
