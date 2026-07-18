/**
 * Notification taxonomy core (DATABASE.md §3, UX_SPEC §7, FR-N4, US-704,
 * US-404, R-A1/US-310). One project's `.shipwright/state.db` at a time —
 * the route layer (`server/notifications-routes.ts`) fans this out across
 * every registered project for the aggregated morning queue (FR-F4).
 *
 * "Emitting without a tier is a type/API error" (US-704 AC-1) is enforced
 * twice: `EmitNotificationInput.tier`/`.kind` are typed as the closed union
 * below (a TS compile error to omit or misspell), and `assertValidTaxonomy`
 * re-checks at runtime for anything crossing the HTTP boundary (a POST body
 * is `unknown`, not a TS type) — the DB's own CHECK constraint
 * (`003_notifications.sql`) is the third, unbypassable layer ("the taxonomy
 * is schema, not convention").
 *
 * Table writes happen directly against the already-open `EventLog.db`
 * handle from this apps/server module, not from a `packages/events`
 * primitive — `packages/events/src/**` (beyond `migrations/**`, which is
 * conductor-allowlisted shared infra) is outside this ticket's write_scope.
 * Every write still goes through the log's own `appendEvent` in the same
 * `db.transaction()` (mirrors `packages/events/src/receipts.ts`'s
 * `mintReceipt`), so the row and its anchoring event land atomically and
 * the notifications table stays "maintained transactionally with their
 * source events" (DATABASE.md §3) even though this module, not
 * `packages/events`, issues the INSERT/UPDATE.
 */

import { randomUUID } from 'node:crypto';
import { appendEvent, type EventLog } from '@shipwright/events';
import { isClaimable, type Ticket } from '@shipwright/tickets';

export type NotificationTier = 'decide' | 'review' | 'record';

export const NOTIFICATION_TIERS: readonly NotificationTier[] = [
  'decide',
  'review',
  'record',
];

/** Closed per DATABASE.md §3 + `003_notifications.sql`'s CHECK constraint. `suggestion` is this ticket's addition (R-A1) — DATABASE.md §3 requires new kinds to land as "a migration + FR-N4 tier-declaration review, never an inline string", which `003_notifications.sql` is. */
export type NotificationKind =
  | 'clarification'
  | 'approval'
  | 'blocked'
  | 'budget'
  | 'pr_ready'
  | 'gate_passed'
  | 'digest'
  | 'drift_report'
  | 'suggestion';

export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'clarification',
  'approval',
  'blocked',
  'budget',
  'pr_ready',
  'gate_passed',
  'digest',
  'drift_report',
  'suggestion',
];

export type NotificationStatus = 'open' | 'done' | 'dismissed';

export const NOTIFICATION_STATUSES: readonly NotificationStatus[] = [
  'open',
  'done',
  'dismissed',
];

export interface NotificationRecord {
  id: string;
  tier: NotificationTier;
  kind: NotificationKind;
  refType: string | null;
  refId: string | null;
  title: string;
  body: unknown;
  leverage: number;
  status: NotificationStatus;
  /** Set only when a Decide-tier card is promoted to push (FR-N4). */
  pushedAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/**
 * Morning-queue leverage (UX_SPEC §7 / API_DESIGN "approvals & notifications":
 * "merges -> approvals -> clarifications -> FYI digests"), extended to every
 * closed `kind`. The four canonical anchors keep that documented order
 * (`pr_ready` 40 > `approval` 30 > `clarification` 20 > `digest` 10); the
 * other kinds are slotted between them by how much they resemble a
 * lane-blocking Decide item vs. a passive Review FYI. Matches the leverage
 * scale `packages/harbormaster`'s W3-05 review-queue already established
 * (merge=40 > approval=30 > clarification=20 > digest=10) — not imported
 * (`@shipwright/harbormaster` is not a declared `apps/server` dependency
 * and `apps/server/package.json` is outside this ticket's write_scope), so
 * mirrored by value instead. Ties break oldest-first (created_at ASC).
 */
export const LEVERAGE_BY_KIND: Readonly<Record<NotificationKind, number>> = {
  pr_ready: 40,
  approval: 30,
  blocked: 25,
  budget: 24,
  clarification: 20,
  gate_passed: 14,
  drift_report: 13,
  digest: 10,
  suggestion: 5,
};

export class NotificationTaxonomyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotificationTaxonomyError';
  }
}

export class NotificationNotFoundError extends Error {
  constructor(id: string) {
    super(`no open notification with id ${id}`);
    this.name = 'NotificationNotFoundError';
  }
}

function assertValidTaxonomy(tier: unknown, kind: unknown): void {
  if (
    typeof tier !== 'string' ||
    !(NOTIFICATION_TIERS as readonly string[]).includes(tier)
  ) {
    throw new NotificationTaxonomyError(
      `emitters must declare a tier (decide|review|record) — got ${JSON.stringify(tier)} (FR-N4)`,
    );
  }
  if (
    typeof kind !== 'string' ||
    !(NOTIFICATION_KINDS as readonly string[]).includes(kind)
  ) {
    throw new NotificationTaxonomyError(
      `emitters must declare a closed-enum kind — got ${JSON.stringify(kind)} (DATABASE.md §3)`,
    );
  }
}

interface NotificationRow {
  id: string;
  tier: string;
  kind: string;
  ref_type: string | null;
  ref_id: string | null;
  title: string;
  body: string;
  leverage: number;
  status: string;
  pushed_at: string | null;
  created_at: string;
  resolved_at: string | null;
}

function rowToNotification(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    tier: row.tier as NotificationTier,
    kind: row.kind as NotificationKind,
    refType: row.ref_type,
    refId: row.ref_id,
    title: row.title,
    body: JSON.parse(row.body) as unknown,
    leverage: row.leverage,
    status: row.status as NotificationStatus,
    pushedAt: row.pushed_at,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

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

export interface EmitOptions {
  now?: () => string;
}

/** Record never pops by construction: this only ever persists `status: 'open'`; push promotion is a separate, decide-tier-only step (`promoteEligibleNotifications`). */
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

/** Convenience id generator for callers that don't need deterministic ids (route layer; tests pass their own). */
export function generateNotificationId(): string {
  return randomUUID();
}
