// ledger.test.ts — P3-05 AC1: requirement ids re-derived from SRS text are
// THE denominator; uncovered (A-1) and coded-not-done both surface.

import { describe, expect, it } from 'vitest';
import { deriveRequirementIds, requirementClosureGaps } from './ledger.js';
import type { RequirementLedger } from './ledger.js';

const SRS_TEXT = `
# SRS (excerpt)

## FR-T1 Ticket decomposition
The decomposer (FR-T1, US-203) turns drafts into a DAG. See also FR-PLAN1
and FR-P8 for plan evaluation; US-105 covers the research gate.

| id | story |
|----|-------|
| US-203 | As a planner I edit the DAG |
| US-101 | As a user I create a project |

Non-requirement noise: BUS-9 STATUS-OK FRUIT FR- US-.
`;

describe('deriveRequirementIds', () => {
  it('extracts US-*/FR-* ids from real doc text, deduplicated, in first-appearance order', () => {
    expect(deriveRequirementIds(SRS_TEXT)).toEqual([
      'FR-T1',
      'US-203',
      'FR-PLAN1',
      'FR-P8',
      'US-105',
      'US-101',
    ]);
  });

  it('matches multi-segment FR ids without swallowing trailing punctuation', () => {
    expect(deriveRequirementIds('FR-AUTH-2FA, then FR-X9.')).toEqual([
      'FR-AUTH-2FA',
      'FR-X9',
    ]);
  });

  it('returns [] for text with no requirement ids', () => {
    expect(deriveRequirementIds('nothing to see here')).toEqual([]);
  });
});

describe('requirementClosureGaps', () => {
  const testExists = (path: string): boolean => path.startsWith('e2e/real/');

  it('reports coded-not-done for a requirement with tickets but no EXISTING proving test', () => {
    const ledger: RequirementLedger = {
      'FR-T1': {
        implementingTickets: ['P1-01'],
        provingTests: ['e2e/deleted/gone.test.ts'],
        status: 'done',
      },
    };
    const gaps = requirementClosureGaps(ledger, {
      requirementIds: ['FR-T1'],
      testExists,
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ requirementId: 'FR-T1', status: 'coded-not-done' });
    expect(gaps[0]?.detail).toContain('e2e/deleted/gone.test.ts');
  });

  it('reports coded-not-done when no proving test is listed at all', () => {
    const ledger: RequirementLedger = {
      'US-101': { implementingTickets: ['P2-03'], provingTests: [], status: 'done' },
    };
    const gaps = requirementClosureGaps(ledger, {
      requirementIds: ['US-101'],
      testExists,
    });
    expect(gaps.map((g) => g.status)).toEqual(['coded-not-done']);
  });

  it('reports uncovered for a requirement with no tickets (empty entry or missing entry)', () => {
    const ledger: RequirementLedger = {
      'US-105': { implementingTickets: [], provingTests: [], status: 'uncovered' },
    };
    const gaps = requirementClosureGaps(ledger, {
      requirementIds: ['US-105', 'FR-P8'],
      testExists,
    });
    expect(gaps.map((g) => [g.requirementId, g.status])).toEqual([
      ['US-105', 'uncovered'],
      ['FR-P8', 'uncovered'],
    ]);
  });

  it('is silent for a requirement closed by tickets plus an existing proving test', () => {
    const ledger: RequirementLedger = {
      'US-203': {
        implementingTickets: ['P1-01', 'P1-02'],
        provingTests: ['e2e/real/dag.test.ts'],
        status: 'done',
      },
    };
    expect(
      requirementClosureGaps(ledger, { requirementIds: ['US-203'], testExists }),
    ).toEqual([]);
  });

  it('DENOMINATOR PROPERTY: a requirement present in SRS text but absent from every ticket surfaces as uncovered', () => {
    // The board/ledger were built only from tickets and have never heard of
    // US-101 — the A-1 silent-divergence class. The SRS-derived denominator
    // still surfaces it.
    const ticketDerivedLedger: RequirementLedger = {
      'FR-T1': {
        implementingTickets: ['P1-01'],
        provingTests: ['e2e/real/t1.test.ts'],
        status: 'done',
      },
    };
    const denominator = deriveRequirementIds(SRS_TEXT);
    expect(denominator).toContain('US-101');
    const gaps = requirementClosureGaps(ticketDerivedLedger, {
      requirementIds: denominator,
      testExists,
    });
    const us101 = gaps.find((g) => g.requirementId === 'US-101');
    expect(us101?.status).toBe('uncovered');
  });

  it('ignores stale ledger keys outside the SRS-derived denominator', () => {
    const ledger: RequirementLedger = {
      'FR-DELETED': { implementingTickets: [], provingTests: [], status: 'uncovered' },
    };
    expect(requirementClosureGaps(ledger, { requirementIds: [], testExists })).toEqual(
      [],
    );
  });
});
