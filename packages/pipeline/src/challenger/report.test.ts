import { describe, expect, it } from 'vitest';
import {
  buildChallengeReport,
  buildRevisionHandoffs,
  UnknownClaimError,
} from './report.js';
import { ChallengerSameModelError } from './model-guard.js';
import type { ChallengeAttempt, Claim } from './claims.js';

const claimA: Claim = {
  id: 'C-A',
  text: 'writes are idempotent',
  originatingRole: 'architecture-designer',
  artifactPath: 'docs/ARCHITECTURE.md',
};

const claimB: Claim = {
  id: 'C-B',
  text: 'the schema has a unique index on email',
  originatingRole: 'db-architect',
  artifactPath: 'docs/DATABASE.md',
};

function attemptFor(
  claim: Claim,
  overrides: Partial<ChallengeAttempt> = {},
): ChallengeAttempt {
  return {
    claim,
    rawVerdict: 'CONFIRMED',
    citations: [{ source: claim.artifactPath }],
    toolCallsUsed: 1,
    rerun: {
      command: 'grep -n unique docs/DATABASE.md',
      counts: { matches: 1 },
      exitCode: 0,
    },
    challengerModel: 'claude-opus',
    makerModel: 'claude-sonnet',
    reasoning: 'verified against the doc',
    ...overrides,
  };
}

describe('buildChallengeReport (US-405 AC-1)', () => {
  it('assembles CONFIRMED/CONTRADICTED/UNVERIFIABLE verdicts into one report', () => {
    const report = buildChallengeReport({
      reportId: 'CR-1',
      generatedAt: '2026-07-16T00:00:00.000Z',
      attempts: [
        attemptFor(claimA, { rawVerdict: 'CONFIRMED' }),
        attemptFor(claimB, { rawVerdict: 'CONTRADICTED' }),
      ],
    });
    expect(report.claims.map((c) => c.verdict)).toEqual(['CONFIRMED', 'CONTRADICTED']);
    expect(report.contradicted).toHaveLength(1);
    expect(report.contradicted[0]?.claimId).toBe('C-B');
  });

  it('routes bounced (INCOMPLETE) claims separately from recorded ones', () => {
    const report = buildChallengeReport({
      reportId: 'CR-2',
      generatedAt: '2026-07-16T00:00:00.000Z',
      attempts: [attemptFor(claimA, { rerun: null }), attemptFor(claimB)],
    });
    expect(report.incomplete).toHaveLength(1);
    expect(report.incomplete[0]?.claimId).toBe('C-A');
    expect(report.claims).toHaveLength(1);
  });

  it('a maker==verifier collision anywhere in the batch aborts the whole report', () => {
    expect(() =>
      buildChallengeReport({
        reportId: 'CR-3',
        generatedAt: '2026-07-16T00:00:00.000Z',
        attempts: [
          attemptFor(claimA),
          attemptFor(claimB, {
            challengerModel: 'claude-sonnet',
            makerModel: 'claude-sonnet',
          }),
        ],
      }),
    ).toThrow(ChallengerSameModelError);
  });
});

describe('buildRevisionHandoffs (FR-P4/US-405 AC-3)', () => {
  it('every CONTRADICTED verdict forces a revision HANDOFF to the originating role', () => {
    const report = buildChallengeReport({
      reportId: 'CR-4',
      generatedAt: '2026-07-16T00:00:00.000Z',
      attempts: [
        attemptFor(claimA, { rawVerdict: 'CONFIRMED' }),
        attemptFor(claimB, { rawVerdict: 'CONTRADICTED' }),
      ],
    });
    const handoffs = buildRevisionHandoffs(report, [claimA, claimB]);
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]?.role).toBe('db-architect');
    expect(handoffs[0]?.writeScope).toEqual(['docs/DATABASE.md']);
    expect(handoffs[0]?.context).toContain('re-ran independently:');
  });

  it('CONFIRMED/UNVERIFIABLE verdicts never produce a handoff', () => {
    const report = buildChallengeReport({
      reportId: 'CR-5',
      generatedAt: '2026-07-16T00:00:00.000Z',
      attempts: [
        attemptFor(claimA, { rawVerdict: 'CONFIRMED' }),
        attemptFor(claimB, { rawVerdict: 'UNVERIFIABLE' }),
      ],
    });
    expect(buildRevisionHandoffs(report, [claimA, claimB])).toHaveLength(0);
  });

  it('refuses to build a handoff for a claim id not in the supplied claim set', () => {
    const report = buildChallengeReport({
      reportId: 'CR-6',
      generatedAt: '2026-07-16T00:00:00.000Z',
      attempts: [attemptFor(claimB, { rawVerdict: 'CONTRADICTED' })],
    });
    expect(() => buildRevisionHandoffs(report, [claimA])).toThrow(UnknownClaimError);
  });
});
