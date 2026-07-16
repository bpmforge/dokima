import { describe, expect, it } from 'vitest';
import { REQUIRED_ONBOARD_ARTIFACTS } from './onboard.js';
import { FEATURE_MODE, decideFeatureEligibility } from './feature.js';

describe('FEATURE_MODE', () => {
  it('R-B5: macro coverage-loop cap is 2', () => {
    expect(FEATURE_MODE.macroLoopCap).toBe(2);
  });

  it('runs a scoped mini-program: no ideation/planning steps, since it starts from an already-onboarded repo', () => {
    expect(FEATURE_MODE.steps.length).toBeGreaterThan(0);
    const names = FEATURE_MODE.steps.map((s) => s.name.toLowerCase());
    expect(names).not.toContain('idea');
    expect(names).not.toContain('plan');
    expect(names.some((n) => n.includes('impact'))).toBe(true);
    expect(names.some((n) => n.includes('implement'))).toBe(true);
  });
});

describe('decideFeatureEligibility (US-106 AC-2)', () => {
  it('refuses when the repo has never been onboarded, naming the missing artifacts and the fix', () => {
    const result = decideFeatureEligibility({ presentArtifacts: [] });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(' ')).toContain('LANDSCAPE.md');
    expect(result.reasons.join(' ')).toMatch(/onboard/i);
  });

  it('refuses when onboarding is partial (some but not all required artifacts present)', () => {
    const result = decideFeatureEligibility({
      presentArtifacts: ['docs/LANDSCAPE.md', 'docs/HEALTH_ASSESSMENT.md'],
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(' ')).toContain('docs/diagrams/entry-points.md');
  });

  it('allows Feature mode once every required onboard artifact is present', () => {
    const result = decideFeatureEligibility({
      presentArtifacts: REQUIRED_ONBOARD_ARTIFACTS,
    });
    expect(result).toEqual({ allowed: true, reasons: [] });
  });

  it('ignores unrelated extra artifacts — only the required set gates eligibility', () => {
    const result = decideFeatureEligibility({
      presentArtifacts: [...REQUIRED_ONBOARD_ARTIFACTS, 'docs/UNRELATED.md'],
    });
    expect(result.allowed).toBe(true);
  });
});
