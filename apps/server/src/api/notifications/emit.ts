/**
 * Emit + list notifications (UX_SPEC §7 "Review items coalesce ... one
 * notification per batch"). Writes happen directly against the already-open
 * `EventLog.db` handle from `apps/server` (`packages/events/src/**` beyond
 * `migrations/**` is outside this ticket's write_scope) — every write still
 * goes through the log's own `appendEvent` in the same `db.transaction()`
 * (mirrors `packages/events/src/receipts.ts`'s `mintReceipt`), so the row
 * and its anchoring event land atomically.
 */

import { appendEvent, type EventLog } from '@shipwright/events';
import {
  assertValidTaxonomy,
  type EmitOptions,
  LEVERAGE_BY_KIND,
  type NotificationKind,
  type NotificationRecord,
  type NotificationRow,
  type NotificationStatus,
  type NotificationTier,
  rowToNotification,
} from './types.js';

export interface EmitNotificationInput {
  id: string;
  tier: NotificationTier;
  kind: NotificationKind;
  refType?: string | null;
  refId?: string | null;
  title: string;
  body?: unknown;
  leverage?: number;
  actorId: string;
}

/** Record never pops by construction: this only ever persists `status: 'open'`; push promotion is a separate, decide-tier-only step (`promoteEligibleNotifications`, `./push-promotion.js`). */
export function emitNotification(
  log: EventLog,
  input: EmitNotificationInput,
  opts: EmitOptions = {},
): NotificationRecord {
  assertValidTaxonomy(input.tier, input.kind);
  const now = opts.now ?? (() => new Date().toISOString());
  const refType = input.refType ?? null;
  const refId = input.refId ?? null;
  const body = input.body ?? {};
  const leverage = input.leverage ?? LEVERAGE_BY_KIND[input.kind];
  const bodyJson = JSON.stringify(body);
  let createdAt = '';

  const run = log.db.transaction((): void => {
    createdAt = now();
    log.db
      .prepare(
        `INSERT INTO notifications
           (id, tier, kind, ref_type, ref_id, title, body, leverage, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(
        input.id,
        input.tier,
        input.kind,
        refType,
        refId,
        input.title,
        bodyJson,
        leverage,
        createdAt,
      );
    appendEvent(
      log,
      {
        eventType: 'notification.emitted',
        actorId: input.actorId,
        payload: { id: input.id, tier: input.tier, kind: input.kind, refType, refId },
      },
      { now: () => createdAt },
    );
  });
  run();

  return {
    id: input.id,
    tier: input.tier,
    kind: input.kind,
    refType,
    refId,
    title: input.title,
    body,
    leverage,
    status: 'open',
    pushedAt: null,
    createdAt,
    resolvedAt: null,
  };
}

export interface ListNotificationsFilter {
  tier?: NotificationTier;
  status?: NotificationStatus;
  orderBy?: 'leverage' | 'recent';
}

/** `orderBy: 'leverage'` is the morning-queue sort (leverage DESC, oldest-first tiebreak — the DB index's own order); `'recent'` (default) is the notification-center feed order. */
export function listNotifications(
  log: EventLog,
  filter: ListNotificationsFilter = {},
): NotificationRecord[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.tier) {
    clauses.push('tier = ?');
    params.push(filter.tier);
  }
  if (filter.status) {
    clauses.push('status = ?');
    params.push(filter.status);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const orderBy =
    filter.orderBy === 'leverage'
      ? 'ORDER BY leverage DESC, created_at ASC'
      : 'ORDER BY created_at DESC';
  const rows = log.db
    .prepare<unknown[], NotificationRow>(
      `SELECT * FROM notifications ${where} ${orderBy}`,
    )
    .all(...params);
  return rows.map(rowToNotification);
}

function getOpenReviewDigest(log: EventLog): NotificationRecord | undefined {
  const row = log.db
    .prepare<[], NotificationRow>(
      `SELECT * FROM notifications
         WHERE tier = 'review' AND kind = 'digest' AND status = 'open'
         ORDER BY created_at DESC LIMIT 1`,
    )
    .get();
  return row ? rowToNotification(row) : undefined;
}

export interface ReviewDigestItem {
  kind: NotificationKind;
  refType: string | null;
  refId: string | null;
  title: string;
  summary: string;
  at: string;
}

export interface ReviewItemInput {
  /** The item's own semantic kind (e.g. `pr_ready`, `gate_passed`) — the digest row itself is always `kind: 'digest'`. */
  kind: NotificationKind;
  refType?: string | null;
  refId?: string | null;
  title: string;
  summary: string;
  leverage?: number;
}

export interface EmitReviewItemOptions extends EmitOptions {
  /** Only used when no open digest exists yet (a fresh digest is created). */
  id: string;
  actorId: string;
}

/**
 * UX_SPEC §7: "Review items coalesce ... one notification per batch." Every
 * open digest absorbs new Review-tier items until it is resolved (approved
 * from the morning queue or dismissed from the notification center), at
 * which point the next `emitReviewItem` call starts a fresh batch.
 */
export function emitReviewItem(
  log: EventLog,
  input: ReviewItemInput,
  opts: EmitReviewItemOptions,
): NotificationRecord {
  assertValidTaxonomy('review', input.kind);
  const now = opts.now ?? (() => new Date().toISOString());
  const itemLeverage = input.leverage ?? LEVERAGE_BY_KIND[input.kind];
  const existing = getOpenReviewDigest(log);

  if (!existing) {
    return emitNotification(
      log,
      {
        id: opts.id,
        tier: 'review',
        kind: 'digest',
        title: 'Review digest',
        body: {
          items: [
            {
              kind: input.kind,
              refType: input.refType ?? null,
              refId: input.refId ?? null,
              title: input.title,
              summary: input.summary,
              at: now(),
            },
          ] satisfies ReviewDigestItem[],
        },
        leverage: itemLeverage,
        actorId: opts.actorId,
      },
      { now },
    );
  }

  const existingBody = existing.body as { items: ReviewDigestItem[] };
  const at = now();
  const items: ReviewDigestItem[] = [
    ...(existingBody.items ?? []),
    {
      kind: input.kind,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      title: input.title,
      summary: input.summary,
      at,
    },
  ];
  const leverage = Math.max(existing.leverage, itemLeverage);
  const run = log.db.transaction((): void => {
    log.db
      .prepare(`UPDATE notifications SET body = ?, leverage = ? WHERE id = ?`)
      .run(JSON.stringify({ items }), leverage, existing.id);
    appendEvent(
      log,
      {
        eventType: 'notification.digest_appended',
        actorId: opts.actorId,
        payload: { id: existing.id, item: items[items.length - 1] },
      },
      { now: () => at },
    );
  });
  run();

  return { ...existing, body: { items }, leverage };
}
