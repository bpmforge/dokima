/**
 * W17-01 (FR-L3): the starting budget shrinks for an over-claimer, never
 * grows, and stays put with no history — downward only, by construction.
 */
import { describe, expect, it } from 'vitest';
import { calibratedBaseIterations } from './run-build-spawn.js';

describe('calibratedBaseIterations (W17-01)', () => {
  it('no record, or a clean record, leaves the base untouched', () => {
    expect(calibratedBaseIterations(12, undefined)).toBe(12);
    expect(calibratedBaseIterations(12, { bias: 0, sampleCount: 20 })).toBe(12);
  });

  it('RED FIXTURE: an over-claiming record SHRINKS the base and can never enlarge it', () => {
    const shrunk = calibratedBaseIterations(12, { bias: 0.3, sampleCount: 9 });
    expect(shrunk).toBeLessThan(12);
    expect(shrunk).toBeGreaterThanOrEqual(4);
    // Even an absurd bias never inflates or goes below the floor.
    expect(calibratedBaseIterations(12, { bias: 5, sampleCount: 9 })).toBe(6);
    expect(calibratedBaseIterations(6, { bias: 0.5, sampleCount: 9 })).toBe(4);
  });
});
