import { describe, expect, it } from 'vitest';
import { validateClaimCitations, validateReportCitations } from './citations.js';
import type { ResearchClaim, ResearchSource } from './types.js';

const TIER1: ResearchSource = { id: 's1', url: 'https://docs.example.com', tier: 1 };
const TIER3: ResearchSource = { id: 's3', url: 'https://forum.example.com', tier: 3 };

function claim(overrides: Partial<ResearchClaim> = {}): ResearchClaim {
  return {
    id: 'c1',
    text: 'the sky is blue',
    impact: 'LOW',
    citedSourceIds: ['s1'],
    ...overrides,
  };
}

describe('validateClaimCitations (FR-P8)', () => {
  it('passes a claim citing a tier-1 source', () => {
    expect(validateClaimCitations(claim(), [TIER1])).toEqual({
      valid: true,
      reasons: [],
    });
  });

  it('RED FIXTURE: a claim with zero citations fails its validator', () => {
    const result = validateClaimCitations(claim({ citedSourceIds: [] }), [TIER1]);
    expect(result.valid).toBe(false);
    expect(result.reasons[0]).toMatch(/no citations/);
  });

  it('RED FIXTURE: a claim citing an out-of-range/unknown source id fails', () => {
    const result = validateClaimCitations(claim({ citedSourceIds: ['does-not-exist'] }), [
      TIER1,
    ]);
    expect(result.valid).toBe(false);
    expect(result.reasons[0]).toMatch(/unknown source id/);
  });

  it('RED FIXTURE: a claim rooted only in a tier-3 source is unverified without corroboration', () => {
    const result = validateClaimCitations(claim({ citedSourceIds: ['s3'] }), [TIER3]);
    expect(result.valid).toBe(false);
    expect(result.reasons[0]).toMatch(/tier-1\/2 corroborator/);
  });

  it('passes a tier-3 claim once corroborated by a tier-1/2 source', () => {
    const result = validateClaimCitations(claim({ citedSourceIds: ['s1', 's3'] }), [
      TIER1,
      TIER3,
    ]);
    expect(result).toEqual({ valid: true, reasons: [] });
  });
});

describe('validateReportCitations', () => {
  it('aggregates reasons across every claim in the report', () => {
    const result = validateReportCitations(
      [
        claim({ id: 'c1', citedSourceIds: [] }),
        claim({ id: 'c2', citedSourceIds: ['s3'] }),
      ],
      [TIER1, TIER3],
    );
    expect(result.valid).toBe(false);
    expect(result.reasons).toHaveLength(2);
  });

  it('passes when every claim is cleanly cited', () => {
    const result = validateReportCitations([claim()], [TIER1]);
    expect(result).toEqual({ valid: true, reasons: [] });
  });
});
