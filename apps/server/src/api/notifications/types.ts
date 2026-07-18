/**
 * Notification taxonomy types + row<->record mapping (DATABASE.md §3,
 * US-704 AC-1 "emitting an unclassified notification is an API-level
 * error"). `assertValidTaxonomy` is the runtime half of that guarantee —
 * `EmitNotificationInput.tier`/`.kind` in `./emit.ts` are the compile-time
 * half, and `006_notifications.sql`'s CHECK constraint is the third,
 * unbypassable layer ("the taxonomy is schema, not convention").
 */

export type NotificationTier = 'decide' | 'review' | 'record';

export const NOTIFICATION_TIERS: readonly NotificationTier[] = [
  'decide',
  'review',
  'record',
];

/** Closed per DATABASE.md §3 + `006_notifications.sql`'s CHECK constraint. `suggestion` is this ticket's addition (R-A1) — DATABASE.md §3 requires new kinds to land as "a migration + FR-N4 tier-declaration review, never an inline string", which `006_notifications.sql` is. */
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

export interface EmitOptions {
  now?: () => string;
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

export function assertValidTaxonomy(tier: unknown, kind: unknown): void {
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

export interface NotificationRow {
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

export function rowToNotification(row: NotificationRow): NotificationRecord {
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
