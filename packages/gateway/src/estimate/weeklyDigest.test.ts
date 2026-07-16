import { describe, expect, it } from 'vitest';
import { buildWeeklyDigest } from './weeklyDigest.js';
import type { RungLedgerEntry, SuppressionRecord } from './types.js';

describe('buildWeeklyDigest', () => {
  it('is a Review-tier card (US-309 AC-1)', () => {
    const digest = buildWeeklyDigest('2026-07-13', [], []);
    expect(digest.tier).toBe('review');
    expect(digest.weekOf).toBe('2026-07-13');
  });

  it('honest-empty when no ledger entries or suppressions exist, with assumptions carried through', () => {
    const digest = buildWeeklyDigest(
      '2026-07-13',
      [],
      [],
      ['no persisted spend ledger yet'],
    );
    expect(digest.totalSpendUsd).toBe(0);
    expect(digest.byRung).toEqual([]);
    expect(digest.suppressionVolume).toEqual([]);
    expect(digest.assumptions).toEqual(['no persisted spend ledger yet']);
  });

  it('combines rung rollup + suppression volume (GATE_ECONOMICS §3)', () => {
    const entries: RungLedgerEntry[] = [
      { ticketId: 'W0-02', rung: 'R3', costUsd: 0.41, outcome: 'done' },
    ];
    const suppressions: SuppressionRecord[] = [
      { ruleId: 'no-magic-numbers', fingerprint: 'f1', justification: 'false_positive' },
    ];
    const digest = buildWeeklyDigest('2026-07-13', entries, suppressions);
    expect(digest.totalSpendUsd).toBeCloseTo(0.41);
    expect(digest.byRung).toEqual([
      {
        rung: 'R3',
        totalUsd: 0.41,
        tickets: [{ ticketId: 'W0-02', spendUsd: 0.41, outcome: 'done' }],
      },
    ]);
    expect(digest.suppressionVolume).toEqual([{ ruleId: 'no-magic-numbers', count: 1 }]);
  });
});
