import { describe, expect, it } from 'vitest';
import { shouldPauseAtBreakpoint, waveOf } from './breakpoints.js';

describe('waveOf', () => {
  it('parses the W<n>-<seq> convention this board uses everywhere', () => {
    expect(waveOf('W3-03')).toBe(3);
    expect(waveOf('W12-01')).toBe(12);
    expect(waveOf('W0-08')).toBe(0);
  });

  it('is null for an id that does not follow the convention', () => {
    expect(waveOf('not-a-ticket')).toBeNull();
  });
});

describe('shouldPauseAtBreakpoint (FR-H3)', () => {
  it("'never' never pauses here, regardless of wave state", () => {
    expect(
      shouldPauseAtBreakpoint({
        breakpoint: 'never',
        justClosedWave: 3,
        remainingClaimableWaves: [],
      }),
    ).toBe(false);
    expect(
      shouldPauseAtBreakpoint({
        breakpoint: 'never',
        justClosedWave: 3,
        remainingClaimableWaves: [3, 4],
      }),
    ).toBe(false);
  });

  it("'ticket' always pauses — one ticket per invocation", () => {
    expect(
      shouldPauseAtBreakpoint({
        breakpoint: 'ticket',
        justClosedWave: 3,
        remainingClaimableWaves: [3, 3, 4],
      }),
    ).toBe(true);
  });

  it("'wave' does not pause while another claimable ticket shares the wave that just closed", () => {
    expect(
      shouldPauseAtBreakpoint({
        breakpoint: 'wave',
        justClosedWave: 3,
        remainingClaimableWaves: [3, 4],
      }),
    ).toBe(false);
  });

  it("'wave' pauses once no remaining claimable ticket shares the just-closed wave (boundary crossed)", () => {
    expect(
      shouldPauseAtBreakpoint({
        breakpoint: 'wave',
        justClosedWave: 3,
        remainingClaimableWaves: [4, 5],
      }),
    ).toBe(true);
    expect(
      shouldPauseAtBreakpoint({
        breakpoint: 'wave',
        justClosedWave: 3,
        remainingClaimableWaves: [],
      }),
    ).toBe(true);
  });
});
