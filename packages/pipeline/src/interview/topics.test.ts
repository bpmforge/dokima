import { describe, expect, it } from 'vitest';
import { PHASES } from '../phases/index.js';
import { INTERVIEW_TOPICS } from './topics.js';

describe('INTERVIEW_TOPICS', () => {
  it('includes exactly the phase 0-2 deliverables owned by pm-interviewer', () => {
    const expected = PHASES.filter((phase) => phase.id <= 2).flatMap((phase) =>
      phase.deliverables
        .filter((deliverable) => deliverable.producingRole === 'pm-interviewer')
        .map((deliverable) => ({ phaseId: phase.id, deliverableId: deliverable.id })),
    );
    expect(INTERVIEW_TOPICS).toEqual(expected);
  });

  it('covers the ticket acceptance subset: VISION, SCOPE, personas, SRS, stories', () => {
    const ids = INTERVIEW_TOPICS.map((topic) => topic.deliverableId);
    expect(ids).toContain('docs/VISION.md');
    expect(ids).toContain('docs/SCOPE.md');
    expect(ids).toContain('docs/USER_PERSONAS.md');
    expect(ids).toContain('docs/SRS.md');
    expect(ids).toContain('docs/USER_STORIES.md');
  });

  it('excludes deliverables owned by other roles (researcher, test-engineer)', () => {
    const ids = INTERVIEW_TOPICS.map((topic) => topic.deliverableId);
    expect(ids).not.toContain('docs/COMPETITIVE_ANALYSIS.md');
    expect(ids).not.toContain('docs/TEST_PLAN.md');
  });

  it('excludes phase 3+ deliverables', () => {
    expect(INTERVIEW_TOPICS.every((topic) => topic.phaseId <= 2)).toBe(true);
  });
});
