import { describe, expect, it } from 'vitest';
import {
  decideClaimCitability,
  decideReportCitability,
  isChallengerRequired,
} from './challenger-gate.js';
import { getDepthPolicy } from './depth.js';
import type { ResearchClaim } from './types.js';

function claim(overrides: Partial<ResearchClaim> = {}): ResearchClaim {
  return {
    id: 'c1',
    text: 'claim text',
    impact: 'HIGH',
    citedSourceIds: ['s1'],
    ...overrides,
  };
}

describe('decideClaimCitability — FR-P8/US-105 AC-2: slate citing an unchallenged HIGH claim is refused', () => {
  it('MEDIUM/LOW claims are always citable regardless of verdict', () => {
    expect(decideClaimCitability(claim({ impact: 'MEDIUM' }), null)).toEqual({
      valid: true,
      reasons: [],
    });
    expect(decideClaimCitability(claim({ impact: 'LOW' }), 'CONTRADICTED')).toEqual({
      valid: true,
      reasons: [],
    });
  });

  it('a HIGH claim with a CONFIRMED verdict is citable', () => {
    expect(decideClaimCitability(claim(), 'CONFIRMED')).toEqual({
      valid: true,
      reasons: [],
    });
  });

  it('RED FIXTURE: a HIGH claim with no verdict at all is refused', () => {
    const result = decideClaimCitability(claim(), null);
    expect(result.valid).toBe(false);
    expect(result.reasons[0]).toMatch(/no Challenger verdict/);
  });

  it('RED FIXTURE: a HIGH claim with a CONTRADICTED verdict is refused', () => {
    const result = decideClaimCitability(claim(), 'CONTRADICTED');
    expect(result.valid).toBe(false);
    expect(result.reasons[0]).toMatch(/CONTRADICTED/);
  });

  it('RED FIXTURE: a HIGH claim with an UNVERIFIABLE verdict is refused', () => {
    const result = decideClaimCitability(claim(), 'UNVERIFIABLE');
    expect(result.valid).toBe(false);
    expect(result.reasons[0]).toMatch(/UNVERIFIABLE/);
  });
});

describe('decideReportCitability', () => {
  it('aggregates per-claim refusals across the report', () => {
    const verdicts = new Map([['c2', 'CONFIRMED' as const]]);
    const result = decideReportCitability(
      [claim({ id: 'c1' }), claim({ id: 'c2' }), claim({ id: 'c3', impact: 'LOW' })],
      verdicts,
    );
    expect(result.valid).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toMatch(/"c1"/);
  });
});

describe('isChallengerRequired', () => {
  it('is required for HIGH-impact claims at any depth', () => {
    expect(isChallengerRequired(getDepthPolicy('quick'), claim({ impact: 'HIGH' }))).toBe(
      true,
    );
  });

  it('is not required for LOW-impact claims outside deep depth', () => {
    expect(
      isChallengerRequired(getDepthPolicy('standard'), claim({ impact: 'LOW' })),
    ).toBe(false);
  });

  it('is required for every claim at deep depth, regardless of impact', () => {
    expect(isChallengerRequired(getDepthPolicy('deep'), claim({ impact: 'LOW' }))).toBe(
      true,
    );
  });
});
