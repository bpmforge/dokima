import { describe, expect, it } from 'vitest';
import { INTERVIEW_DELIVERABLE_PATHS, phaseForDeliverable } from './deliverablePhase.js';

describe('phaseForDeliverable', () => {
  it('resolves each interview-driven deliverable (phases 0-2) to its declared phase', () => {
    expect(phaseForDeliverable('docs/VISION.md')).toBe(0);
    expect(phaseForDeliverable('docs/COMPETITIVE_ANALYSIS.md')).toBe(0);
    expect(phaseForDeliverable('docs/SCOPE.md')).toBe(1);
    expect(phaseForDeliverable('docs/USER_PERSONAS.md')).toBe(1);
    expect(phaseForDeliverable('docs/SRS.md')).toBe(2);
    expect(phaseForDeliverable('docs/USER_STORIES.md')).toBe(2);
  });

  it('resolves phase 3 design deliverables too', () => {
    expect(phaseForDeliverable('docs/ARCHITECTURE.md')).toBe(3);
    expect(phaseForDeliverable('docs/design/UX_SPEC.md')).toBe(3);
  });

  it('returns null for a path that is not a declared deliverable', () => {
    expect(phaseForDeliverable('docs/RANDOM_NOTES.md')).toBeNull();
    expect(phaseForDeliverable('')).toBeNull();
  });

  it('INTERVIEW_DELIVERABLE_PATHS contains only phase 0-2 docs', () => {
    expect(INTERVIEW_DELIVERABLE_PATHS.has('docs/SRS.md')).toBe(true);
    expect(INTERVIEW_DELIVERABLE_PATHS.has('docs/ARCHITECTURE.md')).toBe(false);
  });
});
