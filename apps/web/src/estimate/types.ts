/**
 * Dry-run estimate / escalation-ROI / weekly digest types (BLUEPRINT
 * §12.2, FR-G7, US-307/309). Mirrors
 * `apps/server/src/api/server/estimate-routes.ts`'s wire shapes.
 */

export interface WaveEstimate {
  wave: number;
  ticketCount: number;
  totalPoints: number;
  usdPerPoint: number;
  estimatedUsd: number;
}

export interface EstimateResult {
  waves: WaveEstimate[];
  totalUsd: number;
  assumptions: string[];
}

export interface EscalationRoiTicketRow {
  ticketId: string;
  spendUsd: number;
  outcome: string;
}

export interface EscalationRoiRungGroup {
  rung: string;
  totalUsd: number;
  tickets: EscalationRoiTicketRow[];
}

export interface SpendByRungResult {
  groupBy: string;
  items: EscalationRoiRungGroup[];
  assumptions: string[];
}

export interface SuppressionDigestRow {
  ruleId: string;
  count: number;
}

export interface WeeklyDigest {
  tier: string;
  weekOf: string;
  totalSpendUsd: number;
  byRung: EscalationRoiRungGroup[];
  suppressionVolume: SuppressionDigestRow[];
  assumptions: string[];
}
