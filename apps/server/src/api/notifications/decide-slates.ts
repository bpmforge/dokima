/**
 * notifications/decide-slates.ts — an open decision slate is a Decide-tier
 * notification (W10-73).
 *
 * Measured 2026-08-04 with a real creation run paused on two founder
 * decisions, both slates `status=open` in the event-logged store: the morning
 * queue rendered "Nothing needs you.", the Decide filter was empty, and the
 * header bell announced "Notifications, 0 awaiting a decision" to a screen
 * reader. The one surface whose entire job is *what needs a human* was blind
 * to the only thing that did.
 *
 * Nothing was emitting them. `refreshAndListProjectNotifications` derived
 * trust-graduation suggestions and promoted existing rows, and no code path
 * anywhere turned a slate into a notification.
 *
 * DERIVED ON REFRESH, not emitted at `createSlate` time, for three reasons:
 * slates are created by writers that have no business knowing about the
 * notification surface (the creation pipeline, the CLI, a future berth);
 * deriving picks up every slate that already exists rather than only ones
 * created after this shipped; and it stays correct when a slate is decided by
 * someone else, because the resolve pass below closes the card. Same shape as
 * `maybeEmitTrustGraduationSuggestion`, which is the established pattern here.
 *
 * `clarification` is the right existing kind — a founder slate is precisely a
 * question the founder must answer — so this needs no new taxonomy entry and
 * no migration (DATABASE.md §3: new kinds land as a migration plus an FR-N4
 * tier review, never an inline string).
 */

import { listSlates } from '../decisions/store.js';
import { emitNotification } from './emit.js';
import { resolveAnsweredSlateNotification } from './resolve.js';
import { LEVERAGE_BY_KIND } from './types.js';
import type { EventLog } from '@dokima/events';
import type { NotificationRecord } from './types.js';

export interface DecideSlateSyncOptions {
  readonly actorId: string;
  readonly now?: () => string;
  /** Ids for any notifications minted this pass — injected so tests are deterministic. */
  readonly mintId: () => string;
}

interface OpenSlateCard {
  readonly id: string;
  readonly refId: string;
}

/** Decide-tier cards this project already has open, by the slate they point at. */
function openSlateCards(log: EventLog): Map<string, OpenSlateCard> {
  const rows = log.db
    .prepare<[], { id: string; ref_id: string | null }>(
      `SELECT id, ref_id FROM notifications
        WHERE kind = 'clarification' AND ref_type = 'slate' AND status = 'open'`,
    )
    .all();
  const byRef = new Map<string, OpenSlateCard>();
  for (const row of rows) {
    if (row.ref_id) byRef.set(row.ref_id, { id: row.id, refId: row.ref_id });
  }
  return byRef;
}

/**
 * Makes the Decide queue agree with the decisions store: one open card per
 * open slate, and no card for a slate that has been answered.
 *
 * Idempotent by construction — it reconciles against what is already open
 * rather than appending, so calling it on every notifications refresh (which
 * is what happens) cannot produce duplicates.
 */
export function syncDecideSlateNotifications(
  log: EventLog,
  opts: DecideSlateSyncOptions,
): NotificationRecord[] {
  const open = listSlates(log, { status: 'open' });
  const existing = openSlateCards(log);
  const minted: NotificationRecord[] = [];

  for (const slate of open) {
    if (existing.has(slate.id)) continue;
    // Both slate kinds carry a top-level `title` — no discriminant needed.
    const { title } = slate.slate;
    minted.push(
      emitNotification(
        log,
        {
          id: opts.mintId(),
          tier: 'decide',
          kind: 'clarification',
          refType: 'slate',
          refId: slate.id,
          title,
          body: {
            slateId: slate.id,
            message: 'A decision only you can make is blocking this project.',
          },
          leverage: LEVERAGE_BY_KIND.clarification,
          actorId: opts.actorId,
        },
        { now: opts.now },
      ),
    );
  }

  // A slate answered anywhere — the Decisions board, the CLI, a resumed run —
  // must not leave a card demanding an answer that already exists.
  const stillOpen = new Set(open.map((slate) => slate.id));
  for (const [refId, card] of existing) {
    if (stillOpen.has(refId)) continue;
    resolveAnsweredSlateNotification(log, card.id, refId, {
      actorId: opts.actorId,
      now: opts.now,
    });
  }

  return minted;
}
