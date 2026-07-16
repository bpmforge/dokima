import { describe, expect, it } from 'vitest';
import * as modes from './index.js';

describe('modes barrel', () => {
  it('re-exports the mode registry and all four mode definitions', () => {
    expect(modes.MODES).toHaveLength(4);
    expect(modes.getMode('onboard').id).toBe('onboard');
    expect(modes.macroLoopCapForMode('improve')).toBe(2);
  });

  it('re-exports the macro coverage loop', () => {
    expect(typeof modes.runCoverageLoop).toBe('function');
    expect(typeof modes.runCoverageLoopForMode).toBe('function');
    expect(typeof modes.computeGapChecksum).toBe('function');
  });

  it('re-exports Feature-mode eligibility and Improve-mode backlog builder', () => {
    expect(typeof modes.decideFeatureEligibility).toBe('function');
    expect(typeof modes.buildFixBacklog).toBe('function');
  });
});
