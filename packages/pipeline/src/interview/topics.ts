/**
 * The interview's topic set: every phase-0–2 deliverable whose
 * `producingRole` is `pm-interviewer` in `../phases/topology.ts`'s `PHASES`
 * table. Bound to that table rather than hand-listed so the set can't drift
 * from the single source of truth — it currently yields, in order,
 * VISION.md, COMPETITIVE_ANALYSIS.md is `researcher`-owned and excluded,
 * SCOPE.md, RISKS.md, CONSTRAINTS.md, USER_PERSONAS.md, SRS.md,
 * USER_STORIES.md, USE_CASES.md (TEST_PLAN.md is `test-engineer`-owned and
 * excluded). The ticket acceptance's "VISION/SCOPE/personas/SRS/stories" is
 * the illustrative subset of this full pm-interviewer set, not a smaller
 * scope than phases 0–2 as a whole (the ticket title).
 */
import { PHASES } from '../phases/index.js';
import type { InterviewTopic } from './types.js';

const PM_INTERVIEWER_ROLE = 'pm-interviewer';
const LAST_INTERVIEW_PHASE = 2;

export const INTERVIEW_TOPICS: readonly InterviewTopic[] = PHASES.filter(
  (phase) => phase.id <= LAST_INTERVIEW_PHASE,
).flatMap((phase) =>
  phase.deliverables
    .filter((deliverable) => deliverable.producingRole === PM_INTERVIEWER_ROLE)
    .map((deliverable) => ({ phaseId: phase.id, deliverableId: deliverable.id })),
);
