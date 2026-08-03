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
import { useCallback, useMemo, useState } from 'react';
import './onboarding.css';
import { OnboardingApiError, runGuidedPipeline } from './api.js';
import { INTERVIEW_QUESTIONS } from './interview-topics.js';
import { buildInterviewSession, hasAnyAnswer } from './buildInterviewSession.js';
import type { PipelineRunResult } from './types.js';

export interface InterviewPanelProps {
  readonly projectId: string;
  readonly projectName: string;
  /** Called after a successful run so the workspace can refresh its board. */
  readonly onComplete?: () => void;
}

type Stage = 'asking' | 'running' | 'done' | 'failed';

export function InterviewPanel({
  projectId,
  projectName,
  onComplete,
}: InterviewPanelProps): React.JSX.Element {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [title, setTitle] = useState(projectName);
  const [stage, setStage] = useState<Stage>('asking');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineRunResult | null>(null);

  const ready = useMemo(
    () => hasAnyAnswer(answers) && title.trim() !== '',
    [answers, title],
  );

  const run = useCallback(async () => {
    setStage('running');
    setError(null);
    try {
      const runResult = await runGuidedPipeline(projectId, {
        interviewSession: buildInterviewSession(`interview-${projectId}`, answers),
        blueprintTitle: title.trim(),
      });
      setResult(runResult);
      setStage('done');
      onComplete?.();
    } catch (err) {
      // Shown, not swallowed — see the module header.
      setError(
        err instanceof OnboardingApiError
          ? `${err.message} (HTTP ${String(err.status)})`
          : err instanceof Error
            ? err.message
            : String(err),
      );
      setStage('failed');
    }
  }, [answers, onComplete, projectId, title]);

  if (stage === 'done') {
    return (
      <div className="interview" data-testid="interview-done">
        <h3>Board built</h3>
        <p>
          {result?.plan.tickets.length ?? 0} ticket(s) from your answers. The board is on the
          right.
        </p>
      </div>
    );
  }

  return (
    <div className="interview" data-testid="interview-panel">
      <h3>Describe your product</h3>
      <p className="interview__hint">
        Answer what you can — anything you leave blank is skipped, not guessed at. Your
        answers become the phase 0–2 deliverables the blueprint is built from.
      </p>

      <label className="interview__field">
        <span>Working title</span>
        <input
          type="text"
          value={title}
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
          <small>Drafts: {entry.drafts}</small>
        </label>
      ))}

      {error !== null && (
        <p className="interview__error" role="alert" data-testid="interview-error">
          The run failed: {error}
        </p>
      )}

      <button
        type="button"
        disabled={!ready || stage === 'running'}
        data-testid="interview-run"
        onClick={() => void run()}
      >
        {stage === 'running' ? 'Building the board…' : 'Build the board'}
      </button>
      {!ready && (
        <small className="interview__hint">
          Answer at least one question and give it a title.
        </small>
      )}
    </div>
  );
}
