/**
 * Assembles a complete `InterviewSession` from the answers a user typed.
 *
 * W10-54. `POST .../pipeline/run` requires a session where every topic is
 * `drafted` or `skipped` (`isInterviewComplete`), and until now the only thing
 * that could produce one was the hardcoded `SAMPLE_INTERVIEW_SESSION`. This is
 * the same shape, built from real input instead of a script.
 *
 * An unanswered topic becomes `skipped`, not an empty draft: `collectDrafts`
 * omits skipped topics entirely, so the downstream phases receive nothing
 * rather than a deliverable whose body is the empty string. Fabricating an
 * empty draft would hand the blueprint phase a document that says nothing while
 * claiming the user authored it (C-1).
 */
import type { InterviewAnswer, InterviewSession, TopicState } from './types.js';
import { INTERVIEW_QUESTIONS, type InterviewQuestion } from './interview-topics.js';

/** The human answering. `submitAnswer` refuses a non-human actor by design. */
const ACTOR: InterviewAnswer['actor'] = { id: 'interview', kind: 'human' };

function topicStateFor(
  entry: InterviewQuestion,
  answer: string,
  followUps: readonly { readonly question: string; readonly answer: string }[] = [],
): TopicState {
  const trimmed = answer.trim();
  if (trimmed === '') {
    return {
      topic: entry.topic,
      status: 'skipped',
      questionsAsked: [],
      answers: [],
      draft: null,
    };
  }

  const questionId = `${entry.topic.deliverableId}#1`;
  /**
   * W13-18: the adaptive follow-ups become REAL questions on the topic, at
   * increasing depth — which is exactly what `TopicState` models and what the
   * engine's depth ceiling counts.
   *
   * This function read `answers[deliverableId]` and nothing else, so when
   * follow-ups were first wired their answers were silently dropped: a person
   * could answer three extra questions and none of them reached the draft. The
   * feature would have looked like it worked and changed nothing.
   */
  const answered = followUps
    .map((f) => ({ question: f.question, answer: f.answer.trim() }))
    .filter((f) => f.answer !== '');

  const questionsAsked = [
    {
      id: questionId,
      topic: entry.topic,
      prompt: entry.question,
      depth: 1,
      provenance: { producingRole: 'pm-interviewer' as const },
    },
    ...answered.map((f, i) => ({
      id: `${entry.topic.deliverableId}#${i + 2}`,
      topic: entry.topic,
      prompt: f.question,
      depth: i + 2,
      provenance: { producingRole: 'pm-interviewer' as const },
    })),
  ];

  return {
    topic: entry.topic,
    status: 'drafted',
    questionsAsked,
    answers: [
      { questionId, actor: ACTOR, text: trimmed },
      ...answered.map((f, i) => ({
        questionId: `${entry.topic.deliverableId}#${i + 2}`,
        actor: ACTOR,
        text: f.answer,
      })),
    ],
    draft: {
      topic: entry.topic,
      // Follow-ups carry their question, because "who is it for: developers"
      // is only meaningful next to the question that produced it.
      content: [
        `## ${entry.drafts}`,
        '',
        trimmed,
        ...answered.flatMap((f) => ['', `**${f.question}**`, '', f.answer]),
      ].join('\n'),
      basedOnQuestionIds: questionsAsked.map((q) => q.id),
    },
  };
}

/**
 * `answers` is keyed by `deliverableId`. Missing or blank entries are skipped,
 * which is a legitimate complete session — the interview is allowed to be
 * partial, it just is not allowed to invent content.
 */
export function buildInterviewSession(
  id: string,
  answers: Readonly<Record<string, string>>,
  /** W13-18: adaptive follow-ups per topic, in the order they were asked. */
  followUps: Readonly<Record<string, readonly string[]>> = {},
): InterviewSession {
  return {
    id,
    topics: INTERVIEW_QUESTIONS.map((entry) => {
      const id = entry.topic.deliverableId;
      return topicStateFor(
        entry,
        answers[id] ?? '',
        (followUps[id] ?? []).map((question, i) => ({
          question,
          answer: answers[`${id}#${i}`] ?? '',
        })),
      );
    }),
    activeTopicIndex: null,
  };
}

/** At least one answered topic — otherwise there is nothing for the pipeline to build from. */
export function hasAnyAnswer(answers: Readonly<Record<string, string>>): boolean {
  return INTERVIEW_QUESTIONS.some(
    (entry) => (answers[entry.topic.deliverableId] ?? '').trim() !== '',
  );
}
