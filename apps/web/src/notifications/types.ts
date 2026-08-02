/**
 * Hand-mirrored from `apps/server/src/api/notifications.ts` (apps/web may
 * not import `@dokima/*` packages directly — ARCHITECTURE.md §4; same
 * discipline as `apps/web/src/board/types.ts`'s own header comment).
 */

export type NotificationTier = 'decide' | 'review' | 'record';

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

export type NotificationStatus = 'open' | 'done' | 'dismissed';

export interface NotificationItem {
  id: string;
  tier: NotificationTier;
  kind: NotificationKind;
  refType: string | null;
  refId: string | null;
  title: string;
  body: unknown;
  leverage: number;
  status: NotificationStatus;
  pushedAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
  projectId: string;
  projectName: string;
}
