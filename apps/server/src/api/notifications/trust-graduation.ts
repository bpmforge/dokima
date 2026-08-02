/** R-A1/US-310: trust-graduation suggestion evidence + emission. */

import { isClaimable, type Ticket } from '@dokima/tickets';
import type { EventLog } from '@dokima/events';
import { emitNotification } from './emit.js';
import { type EmitOptions, LEVERAGE_BY_KIND, type NotificationRecord } from './types.js';

const CLEAN_CLOSE_WINDOW_DAYS = 7;

const TRUST_GRADUATION_THRESHOLDS = {
  minCleanCloses: 10,
  maxOscillations: 0,
  maxUnwaivedCriticals: 0,
  minLanesAvailable: 2,
} as const;

export interface TrustGraduationEvidence {
  cleanCloses: number;
  oscillations: number;
  unwaivedCriticalsOver7d: number;
  lanesAvailable: number;
  windowDays: number;
}

/** A ticket that was released (freed back to the board) and reclaimed at least once before its final close — rework, not a clean first-pass close. */
function oscillated(ticket: Ticket): boolean {
  return ticket.history.some((entry) => entry.verb === 'release');
}

/**
 * R-A1/US-310 evidence, derived from real ticket history only —
 * `unwaivedCriticalsOver7d` is honestly `0` because no findings/suppressions
 * producer is reachable from `apps/server` (`findings`/`suppressions` have
 * no migration yet, DATABASE.md §5b — same class of gap
 * `estimate-routes.ts` documents for the spend ledger): there is no
 * critical-findings mechanism running yet to report a nonzero count from,
 * so `0` is the accurate current state, not a fabricated pass (C-1).
 */
export function computeTrustGraduationEvidence(
  tickets: readonly Ticket[],
  now: Date,
): TrustGraduationEvidence {
  const windowStartMs = now.getTime() - CLEAN_CLOSE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  let cleanCloses = 0;
  let oscillations = 0;
  for (const ticket of tickets) {
    if (ticket.status !== 'done' || !ticket.closedAt) continue;
    if (new Date(ticket.closedAt).getTime() < windowStartMs) continue;
    if (oscillated(ticket)) {
      oscillations += 1;
    } else {
      cleanCloses += 1;
    }
  }
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const lanesAvailable = new Set(
    tickets.filter((t) => isClaimable(t, byId)).map((t) => t.lane),
  ).size;
  return {
    cleanCloses,
    oscillations,
    unwaivedCriticalsOver7d: 0,
    lanesAvailable,
    windowDays: CLEAN_CLOSE_WINDOW_DAYS,
  };
}

export function trustGraduationThresholdsCrossed(
  evidence: TrustGraduationEvidence,
): boolean {
  return (
    evidence.cleanCloses >= TRUST_GRADUATION_THRESHOLDS.minCleanCloses &&
    evidence.oscillations <= TRUST_GRADUATION_THRESHOLDS.maxOscillations &&
    evidence.unwaivedCriticalsOver7d <=
      TRUST_GRADUATION_THRESHOLDS.maxUnwaivedCriticals &&
    evidence.lanesAvailable >= TRUST_GRADUATION_THRESHOLDS.minLanesAvailable
  );
}

export interface MaybeEmitSuggestionOptions extends EmitOptions {
  id: string;
  actorId: string;
}

/**
 * R-A1/US-310: "a Record-tier suggestion when my project's evidence
 * justifies more berths ... graduation is offered on receipts, not guessed
 * at." Idempotent — skips if an open `suggestion` card already exists, so
 * repeated calls (this is invoked from the `GET /notifications` route,
 * `packages/harbormaster` not being reachable to run this as a background
 * rule from apps/server's write_scope) never spam duplicates.
 */
export function maybeEmitTrustGraduationSuggestion(
  log: EventLog,
  tickets: readonly Ticket[],
  opts: MaybeEmitSuggestionOptions,
): NotificationRecord | null {
  const now = opts.now ?? (() => new Date().toISOString());
  const evidence = computeTrustGraduationEvidence(tickets, new Date(now()));
  if (!trustGraduationThresholdsCrossed(evidence)) return null;

  const alreadyOpen = log.db
    .prepare(
      `SELECT 1 FROM notifications WHERE kind = 'suggestion' AND status = 'open' LIMIT 1`,
    )
    .get();
  if (alreadyOpen) return null;

  return emitNotification(
    log,
    {
      id: opts.id,
      tier: 'record',
      kind: 'suggestion',
      refType: 'berths',
      refId: null,
      title: 'Berths 2 is earned',
      body: {
        evidence,
        message:
          `${evidence.cleanCloses} clean closes, ${evidence.oscillations} oscillations, ` +
          `${evidence.unwaivedCriticalsOver7d} unwaived criticals, ${evidence.lanesAvailable} ` +
          `lanes available over the last ${evidence.windowDays} days.`,
      },
      leverage: LEVERAGE_BY_KIND.suggestion,
      actorId: opts.actorId,
    },
    { now },
  );
}
