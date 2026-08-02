/**
 * The discovery-interview session engine (BLUEPRINT §3.2/§4, FR-P3, US-101).
 * Drives one topic (`InterviewTopic`, phases 0–2's pm-interviewer
 * deliverables) at a time through an adaptive-depth question loop —
 * ask → answer → ask-again-or-draft — and produces chat cards (FR-C2) plus
 * a `DeliverableDraft` per topic (AC-2: "Drafted deliverables appear in the
 * artifact viewer as I answer").
 *
 * "Ask a question" and "draft from answers" are both real LLM work — out of
 * this write_scope's reach (no `@dokima/gateway` dependency declared
 * for this package, see `../phases/types.ts`'s write_scope note for the
 * identical wiring-gap precedent). Both are injected seams (`InterviewDeps`)
 * this module calls but never implements; the wiring ticket binds them to
 * the real gateway call. Unit tests inject deterministic fakes — no network,
 * per docs/TESTING.md's fake-model-gateway discipline.
 *
 * NA-1 (NEVER-AUTO): every state-changing call takes an `AnswerActor` and
 * refuses via `assertHumanActor` unless `kind === 'human'` — mirrored on
 * `beginTopic`, `submitAnswer`, `skipTopic`, and `resumeTopic` alike, since
 * each is a point where an `auto`-mode caller could otherwise drive the
 * interview without a human present.
 */
import { assertHumanActor, MAX_FOLLOWUP_DEPTH } from './depth-policy.js';
import { INTERVIEW_TOPICS } from './topics.js';
import type {
  AnswerActor,
  ChatCardQuestion,
  DeliverableDraft,
  InterviewAnswer,
  InterviewSession,
  InterviewTopic,
  TopicState,
} from './types.js';

export interface InterviewDeps {
  /** Next follow-up prompt for `topic` given its answers so far, or `null`
   * when the topic has enough signal to draft (adaptive depth, AC-1). */
  readonly nextQuestion: (
    topic: InterviewTopic,
    priorAnswers: readonly InterviewAnswer[],
  ) => string | null;
  /** Synthesizes the deliverable's markdown draft from its answers. */
  readonly draftDeliverable: (
    topic: InterviewTopic,
    answers: readonly InterviewAnswer[],
  ) => string;
}

export class UnknownTopicIndexError extends Error {
  constructor(index: number, topicCount: number) {
    super(`no interview topic at index ${index} (session has ${topicCount})`);
    this.name = 'UnknownTopicIndexError';
  }
}

export class InvalidTopicTransitionError extends Error {
  constructor(from: TopicState['status'], action: string) {
    super(`cannot ${action} a topic in status "${from}"`);
    this.name = 'InvalidTopicTransitionError';
  }
}

export class AnotherTopicActiveError extends Error {
  constructor(activeIndex: number) {
    super(`topic ${activeIndex} is already active — finish, draft, or skip it first`);
    this.name = 'AnotherTopicActiveError';
  }
}

export class UnknownQuestionError extends Error {
  constructor(questionId: string) {
    super(`"${questionId}" is not the active topic's current question`);
    this.name = 'UnknownQuestionError';
  }
}

export interface TopicStepResult {
  readonly session: InterviewSession;
  /** The next chat card to render, or `null` when the topic just drafted. */
  readonly card: ChatCardQuestion | null;
}

function requireTopic(session: InterviewSession, index: number): TopicState {
  const state = session.topics[index];
  if (!state) throw new UnknownTopicIndexError(index, session.topics.length);
  return state;
}

function replaceTopic(
  session: InterviewSession,
  index: number,
  next: TopicState,
  activeTopicIndex: number | null,
): InterviewSession {
  return {
    ...session,
    topics: session.topics.map((state, i) => (i === index ? next : state)),
    activeTopicIndex,
  };
}

function makeCard(
  topic: InterviewTopic,
  prompt: string,
  depth: number,
): ChatCardQuestion {
  return {
    id: `${topic.deliverableId}#${depth}`,
    topic,
    prompt,
    depth,
    provenance: { producingRole: 'pm-interviewer' },
  };
}

function draftFrom(
  topic: InterviewTopic,
  answers: readonly InterviewAnswer[],
  deps: InterviewDeps,
): DeliverableDraft {
  return {
    topic,
    content: deps.draftDeliverable(topic, answers),
    basedOnQuestionIds: answers.map((answer) => answer.questionId),
  };
}

/** A fresh session over `topics` (defaults to the real phase-0–2 pm-interviewer set). */
export function startSession(
  id: string,
  topics: readonly InterviewTopic[] = INTERVIEW_TOPICS,
): InterviewSession {
  return {
    id,
    topics: topics.map((topic) => ({
      topic,
      status: 'not-started',
      questionsAsked: [],
      answers: [],
      draft: null,
    })),
    activeTopicIndex: null,
  };
}

/**
 * Opens topic `topicIndex` and asks its first question (depth 1), or drafts
 * immediately from zero answers if `deps.nextQuestion` has nothing to ask.
 * Refuses if another topic is already active, or `topicIndex`'s topic isn't
 * `'not-started'`/`'skipped'` (AC-1's "skip and return").
 */
export function beginTopic(
  session: InterviewSession,
  topicIndex: number,
  actor: AnswerActor,
  deps: InterviewDeps,
): TopicStepResult {
  assertHumanActor(actor);
  const state = requireTopic(session, topicIndex);
  if (state.status !== 'not-started' && state.status !== 'skipped') {
    throw new InvalidTopicTransitionError(state.status, 'begin');
  }
  if (session.activeTopicIndex !== null) {
    throw new AnotherTopicActiveError(session.activeTopicIndex);
  }

  const prompt = deps.nextQuestion(state.topic, []);
  if (prompt === null) {
    const draft = draftFrom(state.topic, [], deps);
    const next: TopicState = {
      topic: state.topic,
      status: 'drafted',
      questionsAsked: [],
      answers: [],
      draft,
    };
    return { session: replaceTopic(session, topicIndex, next, null), card: null };
  }

  const card = makeCard(state.topic, prompt, 1);
  const next: TopicState = {
    topic: state.topic,
    status: 'in-progress',
    questionsAsked: [card],
    answers: [],
    draft: null,
  };
  return { session: replaceTopic(session, topicIndex, next, topicIndex), card };
}

/**
 * Records a human answer to the active topic's current question, then either
 * asks the adaptive follow-up (depth + 1, capped at `MAX_FOLLOWUP_DEPTH`) or
 * drafts the deliverable (AC-2) when `deps.nextQuestion` signals enough
 * signal or the depth cap is reached.
 */
export function submitAnswer(
  session: InterviewSession,
  topicIndex: number,
  questionId: string,
  actor: AnswerActor,
  text: string,
  deps: InterviewDeps,
): TopicStepResult {
  assertHumanActor(actor);
  const state = requireTopic(session, topicIndex);
  if (state.status !== 'in-progress') {
    throw new InvalidTopicTransitionError(state.status, 'answer');
  }
  const currentCard = state.questionsAsked[state.questionsAsked.length - 1];
  if (!currentCard || currentCard.id !== questionId) {
    throw new UnknownQuestionError(questionId);
  }

  const answer: InterviewAnswer = { questionId, actor, text };
  const answers = [...state.answers, answer];

  const atDepthCap = currentCard.depth >= MAX_FOLLOWUP_DEPTH;
  const prompt = atDepthCap ? null : deps.nextQuestion(state.topic, answers);

  if (prompt === null) {
    const draft = draftFrom(state.topic, answers, deps);
    const next: TopicState = {
      topic: state.topic,
      status: 'drafted',
      questionsAsked: state.questionsAsked,
      answers,
      draft,
    };
    return { session: replaceTopic(session, topicIndex, next, null), card: null };
  }

  const card = makeCard(state.topic, prompt, currentCard.depth + 1);
  const next: TopicState = {
    topic: state.topic,
    status: 'in-progress',
    questionsAsked: [...state.questionsAsked, card],
    answers,
    draft: null,
  };
  return { session: replaceTopic(session, topicIndex, next, topicIndex), card };
}

/** Skips a not-yet-drafted topic (AC-1's "I can skip"). */
export function skipTopic(
  session: InterviewSession,
  topicIndex: number,
  actor: AnswerActor,
): InterviewSession {
  assertHumanActor(actor);
  const state = requireTopic(session, topicIndex);
  if (state.status !== 'not-started' && state.status !== 'in-progress') {
    throw new InvalidTopicTransitionError(state.status, 'skip');
  }
  const next: TopicState = {
    topic: state.topic,
    status: 'skipped',
    questionsAsked: [],
    answers: [],
    draft: null,
  };
  return replaceTopic(session, topicIndex, next, null);
}

/** Reopens a skipped topic back to `'not-started'` (AC-1's "and return"). */
export function resumeTopic(
  session: InterviewSession,
  topicIndex: number,
  actor: AnswerActor,
): InterviewSession {
  assertHumanActor(actor);
  const state = requireTopic(session, topicIndex);
  if (state.status !== 'skipped') {
    throw new InvalidTopicTransitionError(state.status, 'resume');
  }
  const next: TopicState = {
    topic: state.topic,
    status: 'not-started',
    questionsAsked: [],
    answers: [],
    draft: null,
  };
  return replaceTopic(session, topicIndex, next, session.activeTopicIndex);
}

/** True once every topic is `'drafted'` or `'skipped'` — nothing left to interview. */
export function isInterviewComplete(session: InterviewSession): boolean {
  return session.topics.every(
    (state) => state.status === 'drafted' || state.status === 'skipped',
  );
}

/** All drafted deliverables so far, in topic order (skipped topics have none). */
export function collectDrafts(session: InterviewSession): readonly DeliverableDraft[] {
  return session.topics
    .map((state) => state.draft)
    .filter((draft): draft is DeliverableDraft => draft !== null);
}
