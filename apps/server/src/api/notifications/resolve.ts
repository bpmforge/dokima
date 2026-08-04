/** Resolving open notifications: notification-center dismiss and morning-queue decide. */

import { appendEvent, type EventLog } from '@dokima/events';
import { type EmitOptions, NotificationNotFoundError } from './types.js';

interface ResolveOptions extends EmitOptions {
  actorId: string;
}

function resolveNotification(
  log: EventLog,
  id: string,
  status: 'done' | 'dismissed',
  eventType: string,
  eventPayload: Record<string, unknown>,
  opts: ResolveOptions,
): void {
  const now = opts.now ?? (() => new Date().toISOString());
  let resolvedAt = '';
  const run = log.db.transaction((): void => {
    resolvedAt = now();
    const result = log.db
      .prepare(
        `UPDATE notifications SET status = ?, resolved_at = ? WHERE id = ? AND status = 'open'`,
      )
      .run(status, resolvedAt, id);
    if (result.changes === 0) throw new NotificationNotFoundError(id);
    appendEvent(
      log,
      { eventType, actorId: opts.actorId, payload: { id, ...eventPayload } },
      { now: () => resolvedAt },
    );
  });
  run();
}

/** Notification-center "dismiss" (Review/Record tiers; also usable on Decide items the human waves off without deciding). */
export function dismissNotification(
  log: EventLog,
  id: string,
  opts: ResolveOptions,
): void {
  resolveNotification(log, id, 'dismissed', 'notification.dismissed', {}, opts);
}

export type ApprovalDecision = 'approved' | 'rejected';

/** Morning-queue Approve/Reject (UX_SPEC §7) on a Decide-tier card. */
export function decideNotification(
  log: EventLog,
  id: string,
  decision: ApprovalDecision,
  opts: ResolveOptions & { note?: string },
): void {
  resolveNotification(
    log,
    id,
    'done',
    'notification.decided',
    {
      decision,
      note: opts.note ?? null,
    },
    opts,
  );
}

/**
 * Closes a Decide card whose underlying slate has already been answered
 * somewhere else — the Decisions board, the CLI, a resumed creation run
 * (W10-73).
 *
 * Not `dismissNotification`: nothing was waved off. Not `decideNotification`:
 * the founder chose an option on a slate, they did not approve or reject a
 * card. The card is simply `done`, and the event says why it closed so the
 * ledger does not imply a decision that was never made here.
 */
export function resolveAnsweredSlateNotification(
  log: EventLog,
  id: string,
  slateId: string,
  opts: ResolveOptions,
): void {
  resolveNotification(
    log,
    id,
    'done',
    'notification.decided',
    { decision: 'answered', slateId, note: 'slate answered in the decisions store' },
    opts,
  );
}
