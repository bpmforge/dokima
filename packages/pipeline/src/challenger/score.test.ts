import { describe, expect, it } from 'vitest';
import {
  classifyReviewSignal,
  classifySubjectiveScore,
  evaluateScoreVerdict,
} from './score.js';
import type { RerunEvidence } from './rerun.js';

const rerun: RerunEvidence = {
  command: 'pnpm test --filter challenger',
  counts: { passed: 12, failed: 0 },
  exitCode: 0,
};

describe('classifySubjectiveScore (R-B2 asymmetric threshold)', () => {
  it.each([
    [7, 'ACCEPT'],
    [8, 'ACCEPT'],
    [10, 'ACCEPT'],
    [5, 'BOUNDED_POLISH'],
    [6, 'BOUNDED_POLISH'],
    [1, 'ESCALATE_TO_HUMAN'],
    [4, 'ESCALATE_TO_HUMAN'],
  ] as const)('score %i -> %s', (score, expected) => {
    expect(classifySubjectiveScore(score)).toBe(expected);
  });

  it('rejects out-of-range or non-integer scores', () => {
    expect(() => classifySubjectiveScore(0)).toThrow(RangeError);
    expect(() => classifySubjectiveScore(11)).toThrow(RangeError);
    expect(() => classifySubjectiveScore(5.5)).toThrow(RangeError);
  });
});

describe('classifyReviewSignal', () => {
  it('never auto-fails a passing deterministic gate — a score of 1 still returns an action, not a FAIL', () => {
    const action = classifyReviewSignal({
      subjectiveScore: 1,
      deterministicGatePassed: true,
    });
    expect(action).toBe('ESCALATE_TO_HUMAN');
  });

  it('refuses to classify a subjective score against a failing deterministic gate', () => {
    expect(() =>
      classifyReviewSignal({ subjectiveScore: 9, deterministicGatePassed: false }),
    ).toThrow(/deterministic gate has not passed/);
  });
});

describe('evaluateScoreVerdict (US-410)', () => {
  it('AC-1: a verdict without the re-ran-independently line is rejected as INCOMPLETE', () => {
    const outcome = evaluateScoreVerdict({
      subjectiveScore: 9,
      deterministicGatePassed: true,
      rerun: null,
    });
    expect(outcome.status).toBe('INCOMPLETE');
  });

  it('AC-2: a score of 1-4 over a passing gate escalates, never fails the ticket', () => {
    const outcome = evaluateScoreVerdict({
      subjectiveScore: 3,
      deterministicGatePassed: true,
      rerun,
    });
    expect(outcome.status).toBe('RECORDED');
    if (outcome.status !== 'RECORDED') throw new Error('unreachable');
    expect(outcome.action).toBe('ESCALATE_TO_HUMAN');
    expect(outcome.rerunLine).toContain('re-ran independently:');
  });

  it('a valid high score records ACCEPT with the evidence line', () => {
    const outcome = evaluateScoreVerdict({
      subjectiveScore: 8,
      deterministicGatePassed: true,
      rerun,
    });
    expect(outcome.status).toBe('RECORDED');
    if (outcome.status !== 'RECORDED') throw new Error('unreachable');
    expect(outcome.action).toBe('ACCEPT');
  });
});
