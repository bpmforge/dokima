/**
 * The built-in guided-sample idea (BLUEPRINT §12.3 item 3, UX_SPEC §8):
 * "a link-shortener with auth". Canonical human-readable source:
 * `content/samples/link-shortener.md` — kept in sync by hand, see that
 * file's provenance header for why this can't be a runtime content-loader
 * fetch (no `@dokima/pipeline` dependency reachable from apps/web to
 * validate the shape, and no server route serves `content/samples/**` yet
 * — HANDOFF in plan.json/docs/STATUS.md).
 *
 * Every topic here is pre-drafted (`status: 'drafted'`) with exactly one
 * question/answer pair (no follow-ups) — `isInterviewComplete` only checks
 * every topic is `'drafted'` or `'skipped'`, so this is a genuinely valid,
 * complete `InterviewSession`, not a shortcut around the real shape.
 */
import type {
  DeliverableDraft,
  InterviewSession,
  InterviewTopic,
  TopicState,
} from './types.js';

const ACTOR = { id: 'guided-sample', kind: 'human' as const };

interface Beat {
  readonly topic: InterviewTopic;
  readonly question: string;
  readonly answer: string;
  readonly draftTitle: string;
}

const BEATS: readonly Beat[] = [
  {
    topic: { phaseId: 0, deliverableId: 'docs/VISION.md' },
    question: 'In one sentence, what does this product do and for whom?',
    answer:
      'A link shortener with per-user accounts, so a small team can create branded ' +
      'short links and see click counts without sharing one login.',
    draftTitle: 'Vision',
  },
  {
    topic: { phaseId: 1, deliverableId: 'docs/SCOPE.md' },
    question: "What's explicitly in scope for v1, and what's explicitly out?",
    answer:
      'In: create/manage short links, per-user auth, click counts. Out: custom ' +
      'domains, team roles, link expiration rules.',
    draftTitle: 'Scope',
  },
  {
    topic: { phaseId: 1, deliverableId: 'docs/RISKS.md' },
    question: "What's the biggest risk to this shipping on time?",
    answer:
      'Auth is the only genuinely hard part — if we scope-creep into SSO or ' +
      'social login, v1 slips.',
    draftTitle: 'Risks',
  },
  {
    topic: { phaseId: 1, deliverableId: 'docs/CONSTRAINTS.md' },
    question: 'Any hard constraints — budget, timeline, tech stack, compliance?',
    answer:
      'Local-first: SQLite, no hosted auth provider — it should run offline as a ' +
      'fair test of the local-model story.',
    draftTitle: 'Constraints',
  },
  {
    topic: { phaseId: 1, deliverableId: 'docs/USER_PERSONAS.md' },
    question: "Who's the primary user?",
    answer:
      'A solo developer or small team who wants a self-hosted link shortener ' +
      'instead of paying for a SaaS one.',
    draftTitle: 'User personas',
  },
  {
    topic: { phaseId: 2, deliverableId: 'docs/SRS.md' },
    question: "What's the one non-negotiable functional requirement?",
    answer:
      'A signed-in user can create a short link and see how many times it has ' +
      'been clicked.',
    draftTitle: 'SRS',
  },
  {
    topic: { phaseId: 2, deliverableId: 'docs/USER_STORIES.md' },
    question: 'Give one user story that captures the core loop.',
    answer:
      'As a signed-in user, I want to paste a long URL and get a short one back, ' +
      'so I can share it without exposing the original.',
    draftTitle: 'User stories',
  },
  {
    topic: { phaseId: 2, deliverableId: 'docs/USE_CASES.md' },
    question: 'Walk through the primary flow, start to finish.',
    answer:
      'Sign up, log in, paste a URL, get a short link, click it, redirect and the ' +
      'click count increments.',
    draftTitle: 'Use cases',
  },
];

function draftFor(beat: Beat, questionId: string): DeliverableDraft {
  return {
    topic: beat.topic,
    content: `## ${beat.draftTitle}\n\n${beat.answer}`,
    basedOnQuestionIds: [questionId],
  };
}

function topicStateFor(beat: Beat): TopicState {
  const questionId = `${beat.topic.deliverableId}#1`;
  return {
    topic: beat.topic,
    status: 'drafted',
    questionsAsked: [
      {
        id: questionId,
        topic: beat.topic,
        prompt: beat.question,
        depth: 1,
        provenance: { producingRole: 'pm-interviewer' },
      },
    ],
    answers: [{ questionId, actor: ACTOR, text: beat.answer }],
    draft: draftFor(beat, questionId),
  };
}

export const SAMPLE_BLUEPRINT_TITLE = 'Link Shortener with Auth';

export const SAMPLE_INTERVIEW_SESSION: InterviewSession = {
  id: 'guided-sample-link-shortener',
  topics: BEATS.map(topicStateFor),
  activeTopicIndex: null,
};

export interface SampleInterviewBeat {
  readonly deliverableId: string;
  readonly question: string;
  readonly answer: string;
  readonly draftTitle: string;
  readonly draftContent: string;
}

/** Ordered playback script for the "watch the interview" beat's UI. */
export const SAMPLE_INTERVIEW_BEATS: readonly SampleInterviewBeat[] = BEATS.map(
  (beat) => ({
    deliverableId: beat.topic.deliverableId,
    question: beat.question,
    answer: beat.answer,
    draftTitle: beat.draftTitle,
    draftContent: `## ${beat.draftTitle}\n\n${beat.answer}`,
  }),
);
