/**
 * The interview's question set: one opening question per phase-0–2 deliverable
 * the `pm-interviewer` role owns.
 *
 * W10-54. These same nine questions already existed, hardcoded inside
 * `sample-data.ts` as the guided sample's playback script — the product could
 * ask them about a link shortener it invented, but never about the user's own
 * idea. Lifted here so both the sample and the real interview draw on one list.
 *
 * WHY STATIC, stated rather than left to be discovered: `InterviewDeps.nextQuestion`
 * in `@dokima/pipeline` is designed for adaptive, model-driven follow-ups, and
 * had no production implementation anywhere — only tests ever supplied one. It
 * cannot live in `apps/web`, because a web bundle must not call a model
 * directly (ARCHITECTURE §4 / law 6: model access only through the gateway).
 * Wiring the adaptive version therefore needs a server-side interview endpoint,
 * which is its own ticket. One good opening question per deliverable is what
 * makes the product usable today; it is deliberately the floor, not the ceiling.
 */
import type { InterviewTopic } from './types.js';

export interface InterviewQuestion {
  readonly topic: InterviewTopic;
  readonly question: string;
  /**
   * The section heading this answer becomes in the generated document
   * (`buildInterviewSession`). INTERNAL — W13-02 stopped rendering it under
   * the field, where it appeared as `Drafts: Vision` / `Drafts: User personas`
   * and asked the person answering a question to interpret an artifact name.
   * VOCABULARY.md's rule: internal terms are for wire shapes, not for the
   * reader. It is still exactly right as a heading in the file it produces.
   */
  readonly drafts: string;
}

export const INTERVIEW_QUESTIONS: readonly InterviewQuestion[] = [
  {
    topic: { phaseId: 0, deliverableId: 'docs/VISION.md' },
    question: 'In one sentence, what does this product do and for whom?',
    drafts: 'Vision',
  },
  {
    topic: { phaseId: 1, deliverableId: 'docs/SCOPE.md' },
    question: "What's explicitly in scope for v1, and what's explicitly out?",
    drafts: 'Scope',
  },
  {
    topic: { phaseId: 1, deliverableId: 'docs/RISKS.md' },
    question: "What's the biggest risk to this shipping on time?",
    drafts: 'Risks',
  },
  {
    topic: { phaseId: 1, deliverableId: 'docs/CONSTRAINTS.md' },
    question: 'Any hard constraints — budget, timeline, tech stack, compliance?',
    drafts: 'Constraints',
  },
  {
    topic: { phaseId: 1, deliverableId: 'docs/USER_PERSONAS.md' },
    question: "Who's the primary user?",
    drafts: 'User personas',
  },
  {
    topic: { phaseId: 2, deliverableId: 'docs/SRS.md' },
    question: "What's the one non-negotiable functional requirement?",
    drafts: 'Requirements',
  },
  {
    topic: { phaseId: 2, deliverableId: 'docs/USER_STORIES.md' },
    question: 'Give one user story that captures the core loop.',
    drafts: 'User stories',
  },
  {
    topic: { phaseId: 2, deliverableId: 'docs/USE_CASES.md' },
    question: 'Walk through the primary flow, start to finish.',
    drafts: 'Use cases',
  },
];
