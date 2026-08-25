/**
 * The interview surface — where a user describes their own idea and gets a board.
 *
 * W10-54. Before this, creating a product from the Fleet produced a workspace
 * with no control that could start anything: the only code path that called
 * `POST .../pipeline/run` was the guided sample, on a hardcoded idea. The
 * README's premise ("you describe what you want, Dokima interviews you,
 * decomposes it into a ticket board") had no entry point.
 *
 * Errors are shown, never swallowed. The guided sample catches a failed run
 * into a "degraded" stage, which is why a pipeline run that produced zero
 * events surfaced nowhere (W10-55). Here the real reason is rendered.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AwaitingDecisions } from './AwaitingDecisions.js';
import './onboarding.css';
import {
  OnboardingApiError,
  fetchPlannedTicketCount,
  resumePipeline,
  runGuidedPipeline,
} from './api.js';
import { describeHeading, describeSubhead } from '../team/personaCopy.js';
import { FailureNotice } from './FailureNotice.js';
import {
  describeResumeFailure,
  describeRunFailure,
  describeStillWaiting,
  type FriendlyFailure,
} from './friendly-error.js';
import { recoverActiveRun } from './run-recovery.js';
import { INTERVIEW_QUESTIONS } from './interview-topics.js';
import { followUpKey, MAX_FOLLOWUP_DEPTH, useFollowUps } from './useFollowUps.js';

/**
 * The name a project carries when it has none of its own. Named here rather
 * than compared as a bare literal so the title field and the placeholder can
 * never drift apart (W13-02).
 */
const UNNAMED = 'Untitled';
import { buildInterviewSession, hasAnyAnswer } from './buildInterviewSession.js';
import {
  isAwaitingDecisions,
  RUN_PHASES,
  type PipelineAwaitingDecisions,
  type PipelineRunPhase,
  type PipelineRunResult,
} from './types.js';

export interface InterviewPanelProps {
  readonly projectId: string;
  readonly projectName: string;
  /** Called after a successful run so the workspace can refresh its board. */
  readonly onComplete?: () => void;
  /**
   * Bearer token for the inline Decisions board. Absent means the slates
   * cannot be rendered here, and the awaiting screen says so rather than
   * showing an empty list that looks like "no questions after all".
   */
  readonly token?: string;
}

type Stage = 'asking' | 'running' | 'awaiting' | 'done' | 'failed';

export function InterviewPanel({
  projectId,
  projectName,
  onComplete,
  token,
}: InterviewPanelProps): React.JSX.Element {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  /**
   * W13-02: THE TITLE TRAP. This was `useState(projectName)`, and a project
   * with no name of its own arrives here as the literal string "Untitled" —
   * seeded as the field's VALUE. The field then read as answered, while the
   * primary stayed disabled telling you to give it a title. A placeholder
   * pretending to be a value is a trap, not a default. A real name is still
   * offered, because that one IS an answer.
   */
  const [title, setTitle] = useState(projectName === UNNAMED ? '' : projectName);
  // W13-18 (AC-1): the adaptive half — see useFollowUps.ts.
  const followUps = useFollowUps(projectId);
  const [stage, setStage] = useState<Stage>('asking');
  const [error, setError] = useState<FriendlyFailure | null>(null);
  // W10-67: the run paused on a founder decision. Not an error — the gate is
  // working, and the next step belongs to the founder.
  const [awaiting, setAwaiting] = useState<PipelineAwaitingDecisions | null>(null);
  const [result, setResult] = useState<PipelineRunResult | null>(null);
  // W10-72: resuming that paused run. `stillWaiting` is deliberately separate
  // from `error` — a 409 means the gate re-ran server-side and found a slate
  // still open, which is the same correct refusal W10-67 stopped rendering as
  // a crash. Reusing the error style here would reintroduce that mistake one
  // screen later.
  const [resuming, setResuming] = useState(false);
  const [stillWaiting, setStillWaiting] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<FriendlyFailure | null>(null);
  // W10-58: the stages the run has actually finished, as the job reports them.
  const [phases, setPhases] = useState<readonly PipelineRunPhase[]>([]);
  // W18-02: an already-described project must never greet its founder with a
  // blank first-contact form — that reads as "your answers were lost".
  const [plannedCount, setPlannedCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void fetchPlannedTicketCount(projectId).then((count) => {
      if (!cancelled) setPlannedCount(count);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  /**
   * W13-38: recover a run that is already waiting on this founder.
   *
   * Before this, `awaiting.run_id` reached React state and died there — so
   * answering the founder decisions anywhere but inline, which is exactly what
   * the guided sample told a first-run user to do, stranded a run that was on
   * disk and resumable the whole time. The describe screen then showed a blank
   * interview form, as though the run had never happened.
   *
   * Recovery only DISCOVERS; it never resumes. Continue stays a button a human
   * presses (Law 4) — a background resume triggered by "the last slate was
   * decided" would be a durable state change nobody asked for.
   */
  useEffect(() => {
    let cancelled = false;
    // W13-38/39: rejoin whatever run was already active — but only from the
    // untouched describe form; a founder mid-answer must not have the screen
    // pulled out from under them by a poll that landed late. The stage
    // transitions gate on 'asking' for exactly that reason.
    void recoverActiveRun(projectId, {
      cancelled: () => cancelled,
      onAwaiting: (found) => {
        setAwaiting(found);
        // From the untouched form OR from a rejoined run — the extraction's
        // first cut gated on 'asking' alone, so a recovered RUNNING run could
        // never reach its pause screen. The e2e mid-run fixture caught it.
        setStage((current) =>
          current === 'asking' || current === 'running' ? 'awaiting' : current,
        );
      },
      onRejoinRunning: () =>
        setStage((current) => (current === 'asking' ? 'running' : current)),
      onPhases: setPhases,
      onDone: (result) => {
        setResult(result);
        setStage('done');
        onComplete?.();
      },
      onFailed: (failure) => {
        setError(failure);
        setStage('failed');
      },
    });
    return () => {
      cancelled = true;
    };
  }, [onComplete, projectId]);

  const answered = useMemo(
    () =>
      INTERVIEW_QUESTIONS.filter(
        (q) => (answers[q.topic.deliverableId] ?? '').trim() !== '',
      ).length,
    [answers],
  );
  const ready = useMemo(
    () => hasAnyAnswer(answers) && title.trim() !== '',
    [answers, title],
  );
  /**
   * W13-02: the disabled primary names the precondition that is ACTUALLY
   * unmet. The old copy said "Answer at least one question and give it a
   * title" regardless of which half was missing — and because the title was
   * pre-filled, the title half was usually already satisfied, so it blamed the
   * user for something they had done.
   */
  const blockedBecause = useMemo(() => {
    if (ready || stage === 'running') return null;
    const needsAnswer = !hasAnyAnswer(answers);
    const needsTitle = title.trim() === '';
    if (needsAnswer && needsTitle) return 'Add a title and answer any one question.';
    if (needsAnswer) return 'Answer any one question below.';
    return 'Give this a title.';
  }, [answers, ready, stage, title]);

  const run = useCallback(async () => {
    setStage('running');
    setError(null);
    setAwaiting(null);
    setPhases([]);
    try {
      const runResult = await runGuidedPipeline(
        projectId,
        {
          interviewSession: buildInterviewSession(
            `interview-${projectId}`,
            answers,
            followUps.byTopic,
          ),
          blueprintTitle: title.trim(),
        },
        { onProgress: (progress) => setPhases(progress.phases) },
      );
      if (isAwaitingDecisions(runResult)) {
        setAwaiting(runResult);
        setStage('awaiting');
        return;
      }
      setResult(runResult);
      setStage('done');
      onComplete?.();
    } catch (err) {
      // Shown, not swallowed — see the module header. W16-06: plain words
      // first, the raw string demoted to the disclosure, never the headline.
      setError(describeRunFailure(err));
      setStage('failed');
    }
  }, [answers, onComplete, projectId, title]);

  const resume = useCallback(async () => {
    if (!awaiting) return;
    setResuming(true);
    setStillWaiting(null);
    setResumeError(null);
    try {
      const runResult = await resumePipeline(projectId, awaiting.run_id);
      setResult(runResult);
      setStage('done');
      onComplete?.();
    } catch (err) {
      if (err instanceof OnboardingApiError && err.status === 409) {
        // W16-06: 409 here means "decisions still unanswered" — say that in
        // the screen's own words, not the server's problem+json detail.
        setStillWaiting(describeStillWaiting());
      } else {
        setResumeError(describeResumeFailure(err));
      }
    } finally {
      setResuming(false);
    }
  }, [awaiting, onComplete, projectId]);

  if (stage === 'awaiting' && awaiting) {
    return (
      <AwaitingDecisions
        awaiting={awaiting}
        projectId={projectId}
        token={token}
        resuming={resuming}
        stillWaiting={stillWaiting}
        resumeError={resumeError}
        onDecided={() => setStillWaiting(null)}
        onContinue={() => void resume()}
      />
    );
  }

  if (stage === 'done') {
    return (
      <div className="interview" data-testid="interview-done">
        <h3>Board built</h3>
        <p>
          {result?.plan.tickets.length ?? 0} ticket(s) from your answers. The board is on
          the right.
        </p>
      </div>
    );
  }

  return (
    <div className="interview" data-testid="interview-panel">
      {plannedCount > 0 && (
        <div className="surface interview__recap" data-testid="interview-described-recap">
          <h3>Already described</h3>
          <p>
            This project's description produced the plan on the board —{' '}
            {plannedCount} ticket{plannedCount === 1 ? '' : 's'}. Nothing was lost.
            Answering below describes it again; the board stays until a new run changes it.
          </p>
        </div>
      )}
      {/* W20-05: briefing the team should feel like briefing a person. */}
      <h3>{describeHeading(plannedCount > 0)}</h3>
      <p className="interview__hint">{describeSubhead()}</p>
      {/* W13-02: how long this is, and how far in you are. Nine questions with
          no count and no progress meant the only signal you had finished was a
          disabled button at the bottom. */}
      <p className="interview__progress" data-testid="interview-progress">
        {INTERVIEW_QUESTIONS.length} questions, all optional
        {answered > 0 && ` · ${answered} of ${INTERVIEW_QUESTIONS.length} answered`}
      </p>

      <label className="interview__field">
        <span>Working title</span>
        <input
          type="text"
          value={title}
          placeholder={UNNAMED}
          data-testid="interview-title"
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      {INTERVIEW_QUESTIONS.map((entry) => (
        <label className="interview__field" key={entry.topic.deliverableId}>
          <span>{entry.question}</span>
          <textarea
            rows={2}
            value={answers[entry.topic.deliverableId] ?? ''}
            data-testid={`interview-answer-${entry.topic.deliverableId}`}
            onChange={(e) =>
              setAnswers((prev) => ({
                ...prev,
                [entry.topic.deliverableId]: e.target.value,
              }))
            }
          />
          {/* W13-18: asked for, never automatic — see useFollowUps.ts. */}
          {(answers[entry.topic.deliverableId] ?? '').trim() !== '' &&
            (followUps.byTopic[entry.topic.deliverableId] ?? []).length <
              MAX_FOLLOWUP_DEPTH - 1 && (
              <button
                type="button"
                className="btn-quiet"
                data-testid={`interview-more-${entry.topic.deliverableId}`}
                disabled={followUps.asking === entry.topic.deliverableId}
                onClick={() =>
                  void followUps.ask(entry.topic.deliverableId, entry.question, answers)
                }
              >
                {followUps.asking === entry.topic.deliverableId
                  ? 'Thinking…'
                  : 'Ask me more about this'}
              </button>
            )}
          {(followUps.byTopic[entry.topic.deliverableId] ?? []).map((q, i) => (
            <label
              className="interview__followup"
              key={`${entry.topic.deliverableId}-${i}`}
            >
              <span>{q}</span>
              <textarea
                rows={2}
                value={answers[followUpKey(entry.topic.deliverableId, i)] ?? ''}
                data-testid={`interview-followup-${entry.topic.deliverableId}-${i}`}
                onChange={(e) =>
                  setAnswers((prev) => ({
                    ...prev,
                    [followUpKey(entry.topic.deliverableId, i)]: e.target.value,
                  }))
                }
              />
            </label>
          ))}
        </label>
      ))}

      {error !== null && <FailureNotice failure={error} testId="interview-error" />}

      {/* W13-02: this is THE action of the screen and had no class at all, so
          it inherited the plain-button pill and never read as the primary —
          not even when enabled. `btn-primary` dimmed to 0.55 still reads as
          the accent-coloured main action waiting on something, rather than as
          a disabled input, which is what "a disabled primary must still read
          as the primary" means in practice. */}
      <button
        type="button"
        className="btn-primary"
        disabled={!ready || stage === 'running'}
        data-testid="interview-run"
        onClick={() => void run()}
      >
        {stage === 'running' ? 'Building the board…' : 'Build the board'}
      </button>
      {stage === 'running' && (
        <ol className="interview__phases" data-testid="interview-phases">
          {RUN_PHASES.map((phase) => {
            const done = phases.some((p) => p.name === phase.name);
            return (
              <li
                key={phase.name}
                data-phase={phase.name}
                data-done={done ? 'true' : 'false'}
              >
                {done ? '✓' : '…'} {phase.label}
              </li>
            );
          })}
        </ol>
      )}
      {blockedBecause !== null && (
        <small className="interview__blocked" data-testid="interview-blocked">
          {blockedBecause}
        </small>
      )}
    </div>
  );
}
