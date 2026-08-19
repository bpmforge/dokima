/**
 * W10-54. `POST .../pipeline/run` refuses any session where a topic is neither
 * `drafted` nor `skipped` (`isInterviewComplete`). Until this ticket the only
 * thing that could satisfy that was the hardcoded `SAMPLE_INTERVIEW_SESSION`,
 * so these assertions are what stand between a user's answers and a 400.
 */
import { describe, expect, it } from 'vitest';
import { buildInterviewSession, hasAnyAnswer } from './buildInterviewSession.js';
import { INTERVIEW_QUESTIONS } from './interview-topics.js';
import { SAMPLE_INTERVIEW_SESSION } from './sample-data.js';

const oneAnswer = { 'docs/VISION.md': 'A CLI that converts dropped CSV files to JSON.' };

describe('buildInterviewSession (W10-54)', () => {
  it('produces a session the server will accept — every topic drafted or skipped', () => {
    const session = buildInterviewSession('s1', oneAnswer);
    // Mirrors isInterviewComplete in @dokima/pipeline. apps/web cannot import
    // that package (ARCHITECTURE §4), so the rule is restated, not re-exported.
    for (const topic of session.topics) {
      expect(['drafted', 'skipped']).toContain(topic.status);
    }
    expect(session.activeTopicIndex).toBeNull();
  });

  it('covers exactly the same topic set the guided sample proved works', () => {
    // The sample session is the one payload known to be accepted end to end, so
    // matching its shape is the cheapest available proof this one is valid too.
    const built = buildInterviewSession('s1', oneAnswer);
    expect(built.topics.map((t) => t.topic.deliverableId)).toEqual(
      SAMPLE_INTERVIEW_SESSION.topics.map((t) => t.topic.deliverableId),
    );
  });

  it('SKIPS an unanswered topic rather than drafting an empty deliverable', () => {
    // The honesty rule (C-1): a blank answer must not become a document that
    // says nothing while claiming the user authored it. collectDrafts drops
    // skipped topics, so the blueprint phase simply never sees them.
    const session = buildInterviewSession('s1', oneAnswer);
    const answered = session.topics.filter((t) => t.status === 'drafted');
    const skipped = session.topics.filter((t) => t.status === 'skipped');
    expect(answered).toHaveLength(1);
    expect(skipped).toHaveLength(INTERVIEW_QUESTIONS.length - 1);
    for (const t of skipped) {
      expect(t.draft).toBeNull();
      expect(t.answers).toEqual([]);
    }
  });

  it('treats whitespace as unanswered', () => {
    const session = buildInterviewSession('s1', { 'docs/VISION.md': '   \n  ' });
    expect(session.topics.every((t) => t.status === 'skipped')).toBe(true);
    expect(hasAnyAnswer({ 'docs/VISION.md': '   ' })).toBe(false);
    expect(hasAnyAnswer(oneAnswer)).toBe(true);
  });

  it('carries the answer text into the draft, verbatim and trimmed', () => {
    const session = buildInterviewSession('s1', {
      'docs/VISION.md': '  a watcher tool  ',
    });
    const vision = session.topics.find((t) => t.topic.deliverableId === 'docs/VISION.md');
    expect(vision?.answers[0]?.text).toBe('a watcher tool');
    expect(vision?.draft?.content).toContain('a watcher tool');
    // The draft must cite the question it came from, or provenance is lost.
    expect(vision?.draft?.basedOnQuestionIds).toEqual([vision?.questionsAsked[0]?.id]);
  });

  it('answers are attributed to a HUMAN actor — the pipeline refuses otherwise', () => {
    const session = buildInterviewSession('s1', oneAnswer);
    const drafted = session.topics.find((t) => t.status === 'drafted');
    expect(drafted?.answers[0]?.actor.kind).toBe('human');
  });
});

/**
 * W13-18. When follow-ups were first wired, `buildInterviewSession` still read
 * `answers[deliverableId]` and nothing else — so a person could answer three
 * adaptive questions and none of them reached the draft. The feature would
 * have looked like it worked and changed nothing.
 */
describe('adaptive follow-ups reach the deliverable (W13-18)', () => {
  const opening = 'docs/VISION.md';

  it('RED FIXTURE: a follow-up answer is in the draft, not silently dropped', () => {
    const session = buildInterviewSession(
      's1',
      { [opening]: 'A tool that proves its work.', [`${opening}#0`]: 'Developers.' },
      { [opening]: ['Who is it for?'] },
    );
    const topic = session.topics.find((t) => t.topic.deliverableId === opening)!;
    expect(topic.draft?.content).toContain('Developers.');
    // The QUESTION travels with the answer — "Developers." alone is not
    // meaningful without what was asked.
    expect(topic.draft?.content).toContain('Who is it for?');
  });

  it('records follow-ups as real questions at increasing depth, which is what the engine counts', () => {
    const session = buildInterviewSession(
      's1',
      {
        [opening]: 'A tool.',
        [`${opening}#0`]: 'Developers.',
        [`${opening}#1`]: 'Solo ones.',
      },
      { [opening]: ['Who is it for?', 'How many of them?'] },
    );
    const topic = session.topics.find((t) => t.topic.deliverableId === opening)!;
    expect(topic.questionsAsked.map((q) => q.depth)).toEqual([1, 2, 3]);
    expect(topic.answers).toHaveLength(3);
    expect(topic.draft?.basedOnQuestionIds).toHaveLength(3);
  });

  it('an unanswered follow-up is left out rather than emitting an empty section', () => {
    const session = buildInterviewSession(
      's1',
      { [opening]: 'A tool.', [`${opening}#0`]: '   ' },
      { [opening]: ['Who is it for?'] },
    );
    const topic = session.topics.find((t) => t.topic.deliverableId === opening)!;
    expect(topic.questionsAsked).toHaveLength(1);
    expect(topic.draft?.content).not.toContain('Who is it for?');
  });

  it('no follow-ups at all is exactly the old behaviour — every existing caller passes none', () => {
    const before = buildInterviewSession('s1', { [opening]: 'A tool.' });
    const after = buildInterviewSession('s1', { [opening]: 'A tool.' }, {});
    expect(after).toEqual(before);
  });
});
