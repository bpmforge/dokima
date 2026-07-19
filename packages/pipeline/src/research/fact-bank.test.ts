import { describe, expect, it } from 'vitest';
import { decideFactBankAdmission } from './fact-bank.js';
import type { ResearchClaim, ResearchSource } from './types.js';

const TIER1: ResearchSource = { id: 's1', url: 'https://docs.example.com', tier: 1 };
const TIER3: ResearchSource = { id: 's3', url: 'https://forum.example.com', tier: 3 };
const CONTEXT = {
  phase: 1 as const,
  createdAt: '2026-07-18T00:00:00.000Z',
  idPrefix: 'report-1',
};

function claim(overrides: Partial<ResearchClaim> = {}): ResearchClaim {
  return {
    id: 'c1',
    text: 'the library supports async iterators',
    impact: 'LOW',
    citedSourceIds: ['s1'],
    ...overrides,
  };
}

describe('decideFactBankAdmission — FR-P8/US-105 AC-3: confirmed findings enter the R0 fact bank', () => {
  it('admits a cleanly cited LOW-impact claim without needing a verdict', () => {
    const entry = decideFactBankAdmission(claim(), [TIER1], null, CONTEXT);
    expect(entry).toEqual({
      id: 'report-1-c1',
      kind: 'research',
      content: 'the library supports async iterators',
      source: 'https://docs.example.com',
      confidence: 0.9,
      verified: true,
      ticketId: null,
      phase: 1,
      createdAt: '2026-07-18T00:00:00.000Z',
      lastUsedAt: null,
      useCount: 0,
      decayed: false,
    });
  });

  it('admits a HIGH-impact claim once its verdict is CONFIRMED', () => {
    const entry = decideFactBankAdmission(
      claim({ impact: 'HIGH' }),
      [TIER1],
      'CONFIRMED',
      CONTEXT,
    );
    expect(entry).not.toBeNull();
    expect(entry?.verified).toBe(true);
  });

  it('RED FIXTURE: an uncited claim is never admitted', () => {
    const entry = decideFactBankAdmission(
      claim({ citedSourceIds: [] }),
      [TIER1],
      null,
      CONTEXT,
    );
    expect(entry).toBeNull();
  });

  it('RED FIXTURE: an unchallenged HIGH-impact claim is never admitted', () => {
    const entry = decideFactBankAdmission(
      claim({ impact: 'HIGH' }),
      [TIER1],
      null,
      CONTEXT,
    );
    expect(entry).toBeNull();
  });

  it('RED FIXTURE: a CONTRADICTED HIGH-impact claim is never admitted', () => {
    const entry = decideFactBankAdmission(
      claim({ impact: 'HIGH' }),
      [TIER1],
      'CONTRADICTED',
      CONTEXT,
    );
    expect(entry).toBeNull();
  });

  it('confidence reflects the highest-tier cited source', () => {
    const entry = decideFactBankAdmission(
      claim({ citedSourceIds: ['s1', 's3'] }),
      [TIER1, TIER3],
      null,
      CONTEXT,
    );
    expect(entry?.confidence).toBe(0.9);
  });
});
