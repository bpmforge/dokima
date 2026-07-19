import { describe, expect, it } from 'vitest';
import { validateResearchReport } from './report.js';
import type {
  ClaimVerdict,
  ResearchClaim,
  ResearchReport,
  ResearchSource,
} from './types.js';

const TIER1: ResearchSource = { id: 's1', url: 'https://docs.example.com', tier: 1 };
const TIER2: ResearchSource = { id: 's2', url: 'https://blog.example.com', tier: 2 };
const TIER3: ResearchSource = { id: 's3', url: 'https://forum.example.com', tier: 3 };

function baseClaim(overrides: Partial<ResearchClaim> = {}): ResearchClaim {
  return { id: 'c1', text: 'claim', impact: 'LOW', citedSourceIds: ['s1'], ...overrides };
}

function baseReport(overrides: Partial<ResearchReport> = {}): ResearchReport {
  return {
    id: 'r1',
    topic: 'topic',
    phase: 0,
    depth: 'quick',
    sources: [TIER1],
    claims: [baseClaim()],
    generatedAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

const NO_VERDICTS: ReadonlyMap<string, ClaimVerdict> = new Map();

describe('validateResearchReport — FR-P8: research report without citations fails its validator', () => {
  it('passes a well-formed quick report', () => {
    expect(validateResearchReport(baseReport(), NO_VERDICTS)).toEqual({
      valid: true,
      reasons: [],
    });
  });

  it('RED FIXTURE: a report with no claims fails', () => {
    const result = validateResearchReport(baseReport({ claims: [] }), NO_VERDICTS);
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes('no claims'))).toBe(true);
  });

  it('RED FIXTURE: too few sources for the declared depth fails', () => {
    const result = validateResearchReport(
      baseReport({ depth: 'deep', sources: [TIER1] }),
      new Map([['c1', 'CONFIRMED']]),
    );
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes('requires at least 3'))).toBe(true);
  });

  it('RED FIXTURE: an uncited claim fails via the citation check', () => {
    const result = validateResearchReport(
      baseReport({ claims: [baseClaim({ citedSourceIds: [] })] }),
      NO_VERDICTS,
    );
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes('no citations'))).toBe(true);
  });

  it('RED FIXTURE: an unchallenged HIGH claim fails via the Challenger gate', () => {
    const result = validateResearchReport(
      baseReport({ claims: [baseClaim({ impact: 'HIGH' })] }),
      NO_VERDICTS,
    );
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes('Challenger'))).toBe(true);
  });

  it('RED FIXTURE: deep depth requires a verdict on every claim, even LOW impact', () => {
    const result = validateResearchReport(
      baseReport({
        depth: 'deep',
        sources: [TIER1, TIER2, TIER3],
        claims: [baseClaim({ impact: 'LOW' })],
      }),
      NO_VERDICTS,
    );
    expect(result.valid).toBe(false);
    expect(
      result.reasons.some((r) => r.includes('Challenger mandatory on every DEEP DIVE')),
    ).toBe(true);
  });

  it('passes a deep report once every claim carries a verdict', () => {
    const result = validateResearchReport(
      baseReport({
        depth: 'deep',
        sources: [TIER1, TIER2, TIER3],
        claims: [baseClaim({ impact: 'LOW' })],
      }),
      new Map([['c1', 'CONFIRMED']]),
    );
    expect(result).toEqual({ valid: true, reasons: [] });
  });
});
