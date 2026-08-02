import { describe, expect, it } from 'vitest';
import { AutoAnswerRefusedError, MAX_FOLLOWUP_DEPTH } from './depth-policy.js';
import {
  AnotherTopicActiveError,
  InvalidTopicTransitionError,
  UnknownQuestionError,
  UnknownTopicIndexError,
  beginTopic,
  collectDrafts,
  isInterviewComplete,
  resumeTopic,
  skipTopic,
  startSession,
  submitAnswer,
  type InterviewDeps,
} from './session.js';
import type { AnswerActor, InterviewAnswer, InterviewTopic } from './types.js';

const HUMAN: AnswerActor = { id: 'brad', kind: 'human' };
const AGENT: AnswerActor = { id: 'dokima-coder', kind: 'agent' };

const VISION: InterviewTopic = { phaseId: 0, deliverableId: 'docs/VISION.md' };
const SCOPE: InterviewTopic = { phaseId: 1, deliverableId: 'docs/SCOPE.md' };
const TOPICS: readonly InterviewTopic[] = [VISION, SCOPE];

/** Asks exactly `questionCount` follow-ups (including the opener) then signals done. */
function fakeDeps(questionCount: number): InterviewDeps {
  return {
    nextQuestion: (_topic, priorAnswers) =>
      priorAnswers.length < questionCount ? `question #${priorAnswers.length + 1}` : null,
    draftDeliverable: (topic, answers) =>
      `# Draft for ${topic.deliverableId}\n\n${answers.map((a) => a.text).join('\n')}`,
  };
}

describe('startSession', () => {
  it('starts every topic not-started with no active topic', () => {
    const session = startSession('s1', TOPICS);
    expect(session.activeTopicIndex).toBeNull();
    expect(session.topics.map((t) => t.status)).toEqual(['not-started', 'not-started']);
  });

  it('defaults to the real phase 0-2 pm-interviewer topic set', () => {
    const session = startSession('s1');
    expect(session.topics.length).toBeGreaterThan(0);
    expect(session.topics.every((t) => t.topic.phaseId <= 2)).toBe(true);
  });
});

describe('beginTopic', () => {
  it('asks the opening question at depth 1 and marks the topic in-progress', () => {
    const { session, card } = beginTopic(
      startSession('s1', TOPICS),
      0,
      HUMAN,
      fakeDeps(2),
    );
    expect(card).toEqual({
      id: 'docs/VISION.md#1',
      topic: VISION,
      prompt: 'question #1',
      depth: 1,
      provenance: { producingRole: 'pm-interviewer' },
    });
    expect(session.topics[0]?.status).toBe('in-progress');
    expect(session.activeTopicIndex).toBe(0);
  });

  it('drafts immediately from zero answers when nextQuestion has nothing to ask', () => {
    const { session, card } = beginTopic(
      startSession('s1', TOPICS),
      0,
      HUMAN,
      fakeDeps(0),
    );
    expect(card).toBeNull();
    expect(session.topics[0]?.status).toBe('drafted');
    expect(session.topics[0]?.draft?.content).toContain('docs/VISION.md');
    expect(session.activeTopicIndex).toBeNull();
  });

  it('RED FIXTURE — refuses an unknown topic index', () => {
    expect(() => beginTopic(startSession('s1', TOPICS), 99, HUMAN, fakeDeps(1))).toThrow(
      UnknownTopicIndexError,
    );
  });

  it('RED FIXTURE — refuses to begin a second topic while one is active', () => {
    const { session } = beginTopic(startSession('s1', TOPICS), 0, HUMAN, fakeDeps(2));
    expect(() => beginTopic(session, 1, HUMAN, fakeDeps(2))).toThrow(
      AnotherTopicActiveError,
    );
  });

  it('RED FIXTURE — refuses to re-begin an already-drafted topic', () => {
    const { session } = beginTopic(startSession('s1', TOPICS), 0, HUMAN, fakeDeps(0));
    expect(() => beginTopic(session, 0, HUMAN, fakeDeps(0))).toThrow(
      InvalidTopicTransitionError,
    );
  });

  it('RED FIXTURE (NA-1) — refuses an agent actor', () => {
    expect(() => beginTopic(startSession('s1', TOPICS), 0, AGENT, fakeDeps(2))).toThrow(
      AutoAnswerRefusedError,
    );
  });
});

describe('submitAnswer', () => {
  it('asks an adaptive follow-up while nextQuestion keeps returning a prompt', () => {
    const begun = beginTopic(startSession('s1', TOPICS), 0, HUMAN, fakeDeps(2));
    const step = submitAnswer(
      begun.session,
      0,
      'docs/VISION.md#1',
      HUMAN,
      'first answer',
      fakeDeps(2),
    );
    expect(step.card).toEqual({
      id: 'docs/VISION.md#2',
      topic: VISION,
      prompt: 'question #2',
      depth: 2,
      provenance: { producingRole: 'pm-interviewer' },
    });
    expect(step.session.topics[0]?.status).toBe('in-progress');
    expect(step.session.topics[0]?.answers).toEqual<InterviewAnswer[]>([
      { questionId: 'docs/VISION.md#1', actor: HUMAN, text: 'first answer' },
    ]);
  });

  it('drafts once nextQuestion signals enough signal (AC-2)', () => {
    const begun = beginTopic(startSession('s1', TOPICS), 0, HUMAN, fakeDeps(1));
    const step = submitAnswer(
      begun.session,
      0,
      'docs/VISION.md#1',
      HUMAN,
      'the whole idea',
      fakeDeps(1),
    );
    expect(step.card).toBeNull();
    expect(step.session.topics[0]?.status).toBe('drafted');
    expect(step.session.topics[0]?.draft?.content).toBe(
      '# Draft for docs/VISION.md\n\nthe whole idea',
    );
    expect(step.session.topics[0]?.draft?.basedOnQuestionIds).toEqual([
      'docs/VISION.md#1',
    ]);
    expect(step.session.activeTopicIndex).toBeNull();
  });

  it('drafts once MAX_FOLLOWUP_DEPTH is reached even if nextQuestion would keep asking', () => {
    const alwaysAsks: InterviewDeps = {
      nextQuestion: () => 'another question',
      draftDeliverable: (topic, answers) => `${topic.deliverableId}:${answers.length}`,
    };
    let result = beginTopic(startSession('s1', TOPICS), 0, HUMAN, alwaysAsks);
    for (let depth = 1; depth < MAX_FOLLOWUP_DEPTH; depth += 1) {
      const questionId = `docs/VISION.md#${depth}`;
      const step: ReturnType<typeof submitAnswer> = submitAnswer(
        result.session,
        0,
        questionId,
        HUMAN,
        `answer ${depth}`,
        alwaysAsks,
      );
      result = { session: step.session, card: step.card };
      expect(step.card).not.toBeNull();
    }
    const finalQuestionId = `docs/VISION.md#${MAX_FOLLOWUP_DEPTH}`;
    const final = submitAnswer(
      result.session,
      0,
      finalQuestionId,
      HUMAN,
      'last answer',
      alwaysAsks,
    );
    expect(final.card).toBeNull();
    expect(final.session.topics[0]?.status).toBe('drafted');
    expect(final.session.topics[0]?.answers).toHaveLength(MAX_FOLLOWUP_DEPTH);
  });

  it('RED FIXTURE — refuses an answer to a topic that is not active', () => {
    const session = startSession('s1', TOPICS);
    expect(() =>
      submitAnswer(session, 0, 'docs/VISION.md#1', HUMAN, 'x', fakeDeps(1)),
    ).toThrow(InvalidTopicTransitionError);
  });

  it('RED FIXTURE — refuses an answer to a stale/unknown question id', () => {
    const begun = beginTopic(startSession('s1', TOPICS), 0, HUMAN, fakeDeps(2));
    expect(() =>
      submitAnswer(begun.session, 0, 'docs/VISION.md#99', HUMAN, 'x', fakeDeps(2)),
    ).toThrow(UnknownQuestionError);
  });

  it('RED FIXTURE (NA-1) — refuses an agent actor', () => {
    const begun = beginTopic(startSession('s1', TOPICS), 0, HUMAN, fakeDeps(2));
    expect(() =>
      submitAnswer(begun.session, 0, 'docs/VISION.md#1', AGENT, 'x', fakeDeps(2)),
    ).toThrow(AutoAnswerRefusedError);
  });
});

describe('skipTopic / resumeTopic (AC-1: skip and return)', () => {
  it('skips a not-started topic, freeing the session to begin another', () => {
    const session = skipTopic(startSession('s1', TOPICS), 0, HUMAN);
    expect(session.topics[0]?.status).toBe('skipped');
    const { session: afterBegin } = beginTopic(session, 1, HUMAN, fakeDeps(1));
    expect(afterBegin.topics[1]?.status).toBe('in-progress');
  });

  it('skips an in-progress topic and clears the active index', () => {
    const begun = beginTopic(startSession('s1', TOPICS), 0, HUMAN, fakeDeps(2));
    const skipped = skipTopic(begun.session, 0, HUMAN);
    expect(skipped.topics[0]?.status).toBe('skipped');
    expect(skipped.activeTopicIndex).toBeNull();
  });

  it('resumes a skipped topic back to not-started, ready to begin again', () => {
    const skipped = skipTopic(startSession('s1', TOPICS), 0, HUMAN);
    const resumed = resumeTopic(skipped, 0, HUMAN);
    expect(resumed.topics[0]?.status).toBe('not-started');
    const { card } = beginTopic(resumed, 0, HUMAN, fakeDeps(1));
    expect(card?.prompt).toBe('question #1');
  });

  it('RED FIXTURE — refuses to skip an already-drafted topic', () => {
    const { session } = beginTopic(startSession('s1', TOPICS), 0, HUMAN, fakeDeps(0));
    expect(() => skipTopic(session, 0, HUMAN)).toThrow(InvalidTopicTransitionError);
  });

  it('RED FIXTURE — refuses to resume a topic that was never skipped', () => {
    expect(() => resumeTopic(startSession('s1', TOPICS), 0, HUMAN)).toThrow(
      InvalidTopicTransitionError,
    );
  });

  it.each([
    ['skip', () => skipTopic(startSession('s1', TOPICS), 0, AGENT)],
    [
      'resume',
      () => resumeTopic(skipTopic(startSession('s1', TOPICS), 0, HUMAN), 0, AGENT),
    ],
  ] as const)('RED FIXTURE (NA-1) — refuses an agent actor on %s', (_label, action) => {
    expect(action).toThrow(AutoAnswerRefusedError);
  });
});

describe('isInterviewComplete / collectDrafts', () => {
  it('is incomplete while any topic is not-started or in-progress', () => {
    expect(isInterviewComplete(startSession('s1', TOPICS))).toBe(false);
    const { session } = beginTopic(startSession('s1', TOPICS), 0, HUMAN, fakeDeps(1));
    expect(isInterviewComplete(session)).toBe(false);
  });

  it('is complete once every topic is drafted or skipped, and collects only drafts', () => {
    const draftedFirst = beginTopic(
      startSession('s1', TOPICS),
      0,
      HUMAN,
      fakeDeps(0),
    ).session;
    const skippedSecond = skipTopic(draftedFirst, 1, HUMAN);
    expect(isInterviewComplete(skippedSecond)).toBe(true);
    const drafts = collectDrafts(skippedSecond);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.topic).toEqual(VISION);
  });
});
