/**
 * Wire types for Improvement Plans (FR-PLAN2/4, D-016). Hand-mirrored from
 * `apps/server/src/api/plans-types.ts` — apps/web may not import
 * `@shipwright/*` packages directly (ARCHITECTURE §4), same discipline as
 * `board/types.ts`'s own header comment.
 */

export type PlanItemState =
  'proposed' | 'accepted' | 'in_progress' | 'done' | 'regressed';

export interface PlanItem {
  id: string;
  catalogId: string;
  rank: number;
  state: PlanItemState;
  ticketId: string | null;
  verifyCriterion: string;
  recommendation: string;
  severity: number;
  leverage: number;
  lastVerifiedAt: string | null;
  evidence: Record<string, unknown>;
  createdAt: string;
  firstSeenAt: string;
  attempt: number;
  dismissedAt: string | null;
  dismissedReason: string | null;
}

/** FR-RL4-style funnel (AC2): raw findings -> plan items -> accepted -> done/regressed. */
export interface PlanFunnel {
  rawFindings: number;
  planItems: number;
  accepted: number;
  done: number;
  regressed: number;
}
