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
