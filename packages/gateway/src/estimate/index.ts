/**
 * Barrel for the estimate module (BLUEPRINT §12.2, FR-G7, US-307/309).
 * NOTE: not re-exported from packages/gateway/src/index.ts — that file is
 * out of this ticket's write_scope (packages/gateway/src/estimate/**
 * only), same gap prior gateway tickets (W2-01/02/04/05/07) left for
 * their own modules. Intended consumer: a future Harbormaster
 * pre-autorun check (packages/loop already depends on this package);
 * apps/server hand-mirrors an equivalent, smaller computation in the
 * meantime (no workspace dependency on packages/gateway from apps/server
 * — see apps/server/src/api/server/estimate-routes.ts's module header).
 * Tests are co-located `*.test.ts` per docs/TESTING.md §2.
 */

export type {
  EscalationRoiRungGroup,
  EscalationRoiTicketRow,
  EstimateResult,
  HistoricalActual,
  RoleRate,
  RungLedgerEntry,
  SuppressionDigestRow,
  SuppressionJustification,
  SuppressionRecord,
  TicketSizeInput,
  WaveEstimate,
  WeeklyDigestCard,
} from './types.js';

export { applyRoleRateOverrides, computeWaveEstimate } from './estimate.js';
export { groupSpendByRung } from './escalationRoi.js';
export { rollupSuppressionVolume } from './suppressionDigest.js';
export { buildWeeklyDigest } from './weeklyDigest.js';
