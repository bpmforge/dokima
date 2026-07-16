import { describe, expect, it } from 'vitest';
import { explainRefusal, isRefusal, refusalFixAffordance } from './refusal.js';
import type { ProblemDetails } from './types.js';

const CLOSE_REFUSAL: ProblemDetails = {
  type: 'https://shipwright.dev/errors/close-requires-receipt',
  title: 'close refused: verify has not passed',
  status: 409,
  detail: 'ticket W2-04 verify `pnpm test --filter gateway` exited 1; see evidence',
  instance: '/api/v1/tickets/W2-04/close',
  request_id: 'req_01J',
  rule: 'FR-T2',
  evidence: { receipt_id: null, verify_exit: 1, failure_receipt: 'rcpt_9f2' },
};

describe('explainRefusal', () => {
  it('surfaces the specific rule and detail verbatim (FR-T4 explain-this-refusal)', () => {
    expect(explainRefusal(CLOSE_REFUSAL)).toEqual({
      rule: 'FR-T2',
      message: 'ticket W2-04 verify `pnpm test --filter gateway` exited 1; see evidence',
      evidence: { receipt_id: null, verify_exit: 1, failure_receipt: 'rcpt_9f2' },
      hasFix: false,
    });
  });

  it('falls back to the title when no rule id is attached', () => {
    const problem: ProblemDetails = { ...CLOSE_REFUSAL, rule: undefined };
    expect(explainRefusal(problem).rule).toBe('close refused: verify has not passed');
  });

  it('reports null evidence as null, not undefined-crash', () => {
    const problem: ProblemDetails = { ...CLOSE_REFUSAL, evidence: undefined };
    expect(explainRefusal(problem).evidence).toBeNull();
  });

  it('detects an actionable fixing affordance (UX_SPEC §4 "run verify now")', () => {
    const withFix: ProblemDetails = {
      ...CLOSE_REFUSAL,
      evidence: { fix: 'run verify now' },
    };
    expect(explainRefusal(withFix).hasFix).toBe(true);
    expect(refusalFixAffordance(withFix)).toBe('run verify now');
  });
});

describe('isRefusal', () => {
  it('is true only for 409', () => {
    expect(isRefusal(409)).toBe(true);
    expect(isRefusal(401)).toBe(false);
    expect(isRefusal(200)).toBe(false);
  });
});
