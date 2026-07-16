import { describe, expect, it } from 'vitest';
import { getPhase } from './topology.js';
import { SoftGateNotEligibleError, assertWaiverEligible } from './waiver-policy.js';

describe('assertWaiverEligible (FR-G5)', () => {
  it.each([0, 1, 2, 3] as const)('does not throw for doc phase %i', (id) => {
    expect(() => assertWaiverEligible(getPhase(id))).not.toThrow();
  });

  it.each([4, 5] as const)(
    'RED FIXTURE — refuses a soft-gate waiver attempt against build/verify phase %i',
    (id) => {
      expect(() => assertWaiverEligible(getPhase(id))).toThrow(SoftGateNotEligibleError);
    },
  );

  it('the rejection message cites FR-G5 and names the phase', () => {
    try {
      assertWaiverEligible(getPhase(4));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SoftGateNotEligibleError);
      expect((err as Error).message).toContain('FR-G5');
      expect((err as Error).message).toContain('Build');
    }
  });
});
