/** FR-N4: quiet hours + idle-blocked push promotion for Decide-tier notifications. */

import { appendEvent, type EventLog } from '@dokima/events';
import { isClaimable, type Ticket } from '@dokima/tickets';
import {
  type EmitOptions,
  type NotificationRecord,
  type NotificationRow,
  type NotificationTier,
  rowToNotification,
} from './types.js';

export interface QuietHours {
  /** Local 24h hour [0,24) push queueing starts. */
  startHour: number;
  /** Local 24h hour [0,24) push queueing ends. */
  endHour: number;
}

/** Placeholder default (10pm-7am) until project settings (W4-06, `GET/PUT /settings/global` "notification prefs + quiet hours") are reachable from apps/server — every quiet-hours-aware function below takes an explicit override for when that lands. */
export const DEFAULT_QUIET_HOURS: QuietHours = { startHour: 22, endHour: 7 };

export function isWithinQuietHours(
  now: Date,
  quietHours: QuietHours = DEFAULT_QUIET_HOURS,
): boolean {
  const { startHour, endHour } = quietHours;
  if (startHour === endHour) return false;
  const hour = now.getHours();
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

/**
 * "The Harbormaster runs out of unblocked work" (UX_SPEC §7): no ticket
 * anywhere in the project is claimable. An empty board is never idle-blocked
 * — there is no run to be blocked on.
 */
export function isIdleBlocked(tickets: Iterable<Ticket>): boolean {
  const list = Array.from(tickets);
  if (list.length === 0) return false;
  const byId = new Map(list.map((t) => [t.id, t]));
  return list.every((t) => !isClaimable(t, byId));
}

export type PushDecisionReason =
  'not-decide-tier' | 'already-pushed' | 'not-idle-blocked' | 'quiet-hours' | 'promoted';

export interface EvaluatePushInput {
  tier: NotificationTier;
  pushedAt: string | null;
  idleBlocked: boolean;
  now: Date;
  quietHours?: QuietHours;
}

/**
 * FR-N4: "A Decide card ... is promoted to push only when the Harbormaster
 * runs out of unblocked work — interrupt-when-idle-blocked. Quiet hours
 * respected for push; the run continues under `auto` policy and queues
 * Decide items." Record/Review never reach this function's `push: true`
 * branch by construction (the `not-decide-tier` guard is first).
 */
export function evaluatePushPromotion(input: EvaluatePushInput): {
  push: boolean;
  reason: PushDecisionReason;
} {
  if (input.tier !== 'decide') return { push: false, reason: 'not-decide-tier' };
  if (input.pushedAt !== null) return { push: false, reason: 'already-pushed' };
  if (!input.idleBlocked) return { push: false, reason: 'not-idle-blocked' };
  if (isWithinQuietHours(input.now, input.quietHours)) {
    return { push: false, reason: 'quiet-hours' };
  }
  return { push: true, reason: 'promoted' };
}

export interface PromoteOptions extends EmitOptions {
  actorId: string;
  quietHours?: QuietHours;
}

/** Re-evaluates every open, not-yet-pushed Decide notification against current board state; idempotent (already-pushed rows are skipped). */
export function promoteEligibleNotifications(
  log: EventLog,
  tickets: readonly Ticket[],
  opts: PromoteOptions,
): NotificationRecord[] {
  const now = opts.now ?? (() => new Date().toISOString());
  const idleBlocked = isIdleBlocked(tickets);
  const rows = log.db
    .prepare<[], NotificationRow>(
      `SELECT * FROM notifications WHERE tier = 'decide' AND status = 'open' AND pushed_at IS NULL`,
    )
    .all();

  const promoted: NotificationRecord[] = [];
  for (const row of rows) {
    const record = rowToNotification(row);
    const decision = evaluatePushPromotion({
      tier: record.tier,
      pushedAt: record.pushedAt,
      idleBlocked,
      now: new Date(now()),
      quietHours: opts.quietHours,
    });
    if (!decision.push) continue;
    let pushedAt = '';
    const run = log.db.transaction((): void => {
      pushedAt = now();
      log.db
        .prepare(`UPDATE notifications SET pushed_at = ? WHERE id = ?`)
        .run(pushedAt, record.id);
      appendEvent(
        log,
        {
          eventType: 'notification.promoted',
          actorId: opts.actorId,
          payload: { id: record.id },
        },
        { now: () => pushedAt },
      );
    });
    run();
    promoted.push({ ...record, pushedAt });
  }
  return promoted;
}
