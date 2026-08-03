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

function topicStateFor(entry: InterviewQuestion, answer: string): TopicState {
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
  return {
    topic: entry.topic,
    status: 'drafted',
    questionsAsked: [
      {
        id: questionId,
        topic: entry.topic,
        prompt: entry.question,
        depth: 1,
        provenance: { producingRole: 'pm-interviewer' },
      },
    ],
    answers: [{ questionId, actor: ACTOR, text: trimmed }],
    draft: {
      topic: entry.topic,
      content: `## ${entry.drafts}\n\n${trimmed}`,
      basedOnQuestionIds: [questionId],
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
): InterviewSession {
  return {
    id,
    topics: INTERVIEW_QUESTIONS.map((entry) =>
      topicStateFor(entry, answers[entry.topic.deliverableId] ?? ''),
    ),
    activeTopicIndex: null,
  };
}

/** At least one answered topic — otherwise there is nothing for the pipeline to build from. */
export function hasAnyAnswer(answers: Readonly<Record<string, string>>): boolean {
  return INTERVIEW_QUESTIONS.some(
    (entry) => (answers[entry.topic.deliverableId] ?? '').trim() !== '',
  );
}
