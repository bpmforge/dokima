import { describe, expect, it } from 'vitest';
import { PHASES } from '../phases/topology.js';
import { NEW_PRODUCT_MODE, NEW_PRODUCT_STEPS } from './new-product.js';

describe('NEW_PRODUCT_MODE', () => {
  it('R-B5: macro coverage-loop cap is 3', () => {
    expect(NEW_PRODUCT_MODE.macroLoopCap).toBe(3);
  });

  it('wraps the full six-phase PHASES table, one step per phase, in order', () => {
    expect(NEW_PRODUCT_STEPS.map((s) => s.name)).toEqual(PHASES.map((p) => p.name));
    expect(NEW_PRODUCT_STEPS).toHaveLength(6);
  });

  it("carries each phase's deliverables through unchanged (same array reference, no re-derivation)", () => {
    NEW_PRODUCT_STEPS.forEach((step, i) => {
      expect(step.deliverables).toBe(PHASES[i]?.deliverables);
    });
  });
});
