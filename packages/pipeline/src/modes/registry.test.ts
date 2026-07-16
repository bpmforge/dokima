import { describe, expect, it } from 'vitest';
import { MODES, UnknownModeError, getMode, macroLoopCapForMode } from './registry.js';

describe('mode registry', () => {
  it('FR-P5: declares exactly the four v1 modes', () => {
    expect(MODES.map((m) => m.id).sort()).toEqual([
      'feature',
      'improve',
      'new-product',
      'onboard',
    ]);
  });

  it('R-B5: macro coverage-loop cap is 3 for New Product/Onboard, 2 for Feature/Improve', () => {
    expect(macroLoopCapForMode('new-product')).toBe(3);
    expect(macroLoopCapForMode('onboard')).toBe(3);
    expect(macroLoopCapForMode('feature')).toBe(2);
    expect(macroLoopCapForMode('improve')).toBe(2);
  });

  it('getMode returns the definition whose macroLoopCap backs macroLoopCapForMode (no second hard-coded table)', () => {
    for (const mode of MODES) {
      expect(macroLoopCapForMode(mode.id)).toBe(mode.macroLoopCap);
    }
  });

  it('getMode throws UnknownModeError for an unrecognized id', () => {
    // @ts-expect-error deliberately outside the ModeId union for the runtime check
    expect(() => getMode('nonexistent')).toThrow(UnknownModeError);
  });

  it('every mode step declares at least one deliverable with a non-empty producing role', () => {
    for (const mode of MODES) {
      expect(mode.steps.length).toBeGreaterThan(0);
      for (const step of mode.steps) {
        expect(step.deliverables.length).toBeGreaterThan(0);
        for (const d of step.deliverables) {
          expect(d.producingRole.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
