import { describe, expect, it } from 'vitest';
import { getDepthPolicy } from './depth.js';

describe('getDepthPolicy (FR-P8/US-105 AC-1)', () => {
  it('quick: 1 source floor, Challenger not mandatory', () => {
    expect(getDepthPolicy('quick')).toEqual({
      depth: 'quick',
      minSources: 1,
      challengerMandatory: false,
    });
  });

  it('standard: 2 source floor, Challenger not mandatory', () => {
    expect(getDepthPolicy('standard')).toEqual({
      depth: 'standard',
      minSources: 2,
      challengerMandatory: false,
    });
  });

  it('deep: 3 source floor, Challenger mandatory on every claim (researcher.md Step 5.4)', () => {
    expect(getDepthPolicy('deep')).toEqual({
      depth: 'deep',
      minSources: 3,
      challengerMandatory: true,
    });
  });

  it('source-count floors rise monotonically with depth', () => {
    const quick = getDepthPolicy('quick');
    const standard = getDepthPolicy('standard');
    const deep = getDepthPolicy('deep');
    expect(quick.minSources).toBeLessThan(standard.minSources);
    expect(standard.minSources).toBeLessThan(deep.minSources);
  });
});
