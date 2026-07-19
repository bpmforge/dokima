import type {
  CoverageSnapshot,
  DeliverablesSnapshot,
  FindingsSnapshot,
  GatesSnapshot,
  PlanEvaluationSnapshot,
  PlanItemsSnapshot,
  PlaybookSnapshot,
  ProvidersSnapshot,
  ReceiptsSnapshot,
  RulesSnapshot,
  SpendSnapshot,
  TicketsSnapshot,
} from './types.js';

export interface SnapshotOverrides {
  readonly phase?: string | null;
  readonly receipts?: Partial<ReceiptsSnapshot>;
  readonly coverage?: Partial<CoverageSnapshot>;
  readonly findings?: Partial<FindingsSnapshot>;
  readonly rules?: Partial<RulesSnapshot>;
  readonly tickets?: Partial<TicketsSnapshot>;
  readonly spend?: Partial<SpendSnapshot>;
  readonly gates?: Partial<GatesSnapshot>;
  readonly providers?: Partial<ProvidersSnapshot>;
  readonly deliverables?: Partial<DeliverablesSnapshot>;
  readonly planItems?: Partial<PlanItemsSnapshot>;
  readonly playbook?: Partial<PlaybookSnapshot>;
}

/** Every catalog condition false — the "nothing to recommend" baseline. */
export function baselineSnapshot(
  overrides: SnapshotOverrides = {},
): PlanEvaluationSnapshot {
  return {
    phase: overrides.phase ?? null,
    receipts: { staleCount: 0, ...overrides.receipts },
    coverage: { requiredSkipped: 0, ...overrides.coverage },
    findings: { openCriticalUnwaived: 0, ...overrides.findings },
    rules: { fpHeavyCount: 0, ...overrides.rules },
    tickets: {
      oscillatingCount: 0,
      blockedWithEvidenceMaxAgeDays: 0,
      ...overrides.tickets,
    },
    spend: { thresholdBreachRepeatCount: 0, ...overrides.spend },
    gates: { missingRedFixtureCount: 0, ...overrides.gates },
    providers: { unverifiedTosCount: 0, ...overrides.providers },
    deliverables: { orphanedCount: 0, ...overrides.deliverables },
    planItems: { regressedCount: 0, ...overrides.planItems },
    playbook: { staleEntryCount: 0, ...overrides.playbook },
  };
}
