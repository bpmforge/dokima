import { describe, expect, it } from 'vitest';
import { applyRoleRateOverrides, computeWaveEstimate } from './estimate.js';
import type { HistoricalActual, RoleRate, TicketSizeInput } from './types.js';

const MATRIX: RoleRate[] = [
  { role: 'coding-agent', usdPerPoint: 0.1 },
  { role: 'code-reviewer', usdPerPoint: 0.2 },
  { role: 'challenger', usdPerPoint: 0.05 },
];

const TICKET_W0_01: TicketSizeInput = { ticketId: 'W0-01', wave: 0, points: 2 };
const TICKET_W0_02: TicketSizeInput = { ticketId: 'W0-02', wave: 0, points: 3 };
const TICKET_W1_01: TicketSizeInput = { ticketId: 'W1-01', wave: 1, points: 5 };

const TICKETS: TicketSizeInput[] = [TICKET_W0_01, TICKET_W0_02, TICKET_W1_01];

describe('computeWaveEstimate', () => {
  it('empty tickets yields an empty, non-fabricated result', () => {
    const result = computeWaveEstimate([], MATRIX);
    expect(result.waves).toEqual([]);
    expect(result.totalUsd).toBe(0);
    expect(result.assumptions).toContain('no tickets to estimate');
  });

  it('per-wave breakdown: points x summed matrix rate, matrix list-price only when no historical actuals', () => {
    const result = computeWaveEstimate(TICKETS, MATRIX);
    expect(result.waves).toHaveLength(2);
    const wave0 = result.waves[0] as (typeof result.waves)[number];
    const wave1 = result.waves[1] as (typeof result.waves)[number];
    expect(wave0.wave).toBe(0);
    expect(wave0.ticketCount).toBe(2);
    expect(wave0.totalPoints).toBe(5);
    expect(wave0.usdPerPoint).toBeCloseTo(0.35);
    expect(wave0.estimatedUsd).toBeCloseTo(1.75);
    expect(wave0.rateSource).toBe('matrix');
    expect(wave1.wave).toBe(1);
    expect(wave1.ticketCount).toBe(1);
    expect(wave1.totalPoints).toBe(5);
    expect(wave1.usdPerPoint).toBeCloseTo(0.35);
    expect(wave1.estimatedUsd).toBeCloseTo(1.75);
    expect(wave1.rateSource).toBe('matrix');
    expect(result.totalUsd).toBeCloseTo(3.5);
    expect(result.assumptions).toContain(
      'no historical actuals; every wave priced at matrix list-price only',
    );
  });

  it('waves sort ascending regardless of input order', () => {
    const shuffled = [TICKET_W1_01, TICKET_W0_01, TICKET_W0_02];
    const result = computeWaveEstimate(shuffled, MATRIX);
    expect(result.waves.map((w) => w.wave)).toEqual([0, 1]);
  });

  it('prefers a wave historical actual rate over the matrix when its tickets have one', () => {
    const actuals: HistoricalActual[] = [
      { ticketId: 'W0-01', points: 2, actualUsd: 1 },
      { ticketId: 'W0-02', points: 3, actualUsd: 1.5 },
    ];
    const result = computeWaveEstimate(TICKETS, MATRIX, actuals);
    const wave0 = result.waves.find((w) => w.wave === 0);
    const wave1 = result.waves.find((w) => w.wave === 1);
    expect(wave0?.usdPerPoint).toBeCloseTo(0.5);
    expect(wave0?.estimatedUsd).toBeCloseTo(2.5);
    expect(wave0?.rateSource).toBe('historical');
    expect(wave1?.usdPerPoint).toBeCloseTo(0.35);
    expect(wave1?.estimatedUsd).toBeCloseTo(1.75);
    expect(wave1?.rateSource).toBe('matrix');
    expect(result.assumptions).toContain(
      'some waves have no historical actuals for their tickets; those waves fall back to matrix list-price',
    );
  });

  it('what-if: overriding one role rate recomputes deterministically (SRS FR-G7)', () => {
    const base = computeWaveEstimate(TICKETS, MATRIX);
    const cheaper = applyRoleRateOverrides(MATRIX, { 'code-reviewer': 0.02 });
    const result = computeWaveEstimate(TICKETS, cheaper);
    expect(result.totalUsd).toBeLessThan(base.totalUsd);
    // deterministic: recomputing with the same override yields the same total
    const again = computeWaveEstimate(
      TICKETS,
      applyRoleRateOverrides(MATRIX, { 'code-reviewer': 0.02 }),
    );
    expect(again.totalUsd).toBe(result.totalUsd);
  });

  it('applyRoleRateOverrides leaves unmentioned roles untouched', () => {
    const overridden = applyRoleRateOverrides(MATRIX, { 'code-reviewer': 0.02 });
    expect(overridden.find((r) => r.role === 'coding-agent')?.usdPerPoint).toBe(0.1);
    expect(overridden.find((r) => r.role === 'code-reviewer')?.usdPerPoint).toBe(0.02);
  });
});
