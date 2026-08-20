import { DecisionsBoard } from '../decisions/DecisionsBoard.js';
import type { PipelineAwaitingDecisions } from './types.js';

/**
 * The screen a founder sees when a creation run stops on a decision only they
 * can make (W10-67, W10-72).
 *
 * Extracted from `InterviewPanel.tsx` verbatim when W13-38 added run recovery
 * and the file crossed the 400-line cap — a move, not a rewrite. Every state
 * it renders still lives in the panel; this file owns the markup, not the run.
 *
 * ONE THING DID CHANGE, and it is the point of W13-38: this screen is no
 * longer reachable only from the POST that started the run. `InterviewPanel`
 * recovers a waiting run on open (`fetchAwaitingRun`), so answering the slates
 * on the standalone Decisions board and coming back now works. The inline
 * board below stays regardless — answering here is still the shortest path,
 * and it is the one this screen can guarantee.
 */
export interface AwaitingDecisionsProps {
  readonly awaiting: PipelineAwaitingDecisions;
  readonly projectId: string;
  /** Absent means the inline board cannot load — said plainly rather than rendered empty. */
  readonly token?: string;
  readonly resuming: boolean;
  /**
   * The gate re-ran server-side and found a slate still open. Deliberately not
   * an error: it is a correct refusal, and rendering it in the error style is
   * the mistake W10-67 fixed one screen earlier.
   */
  readonly stillWaiting: string | null;
  readonly resumeError: string | null;
  readonly onDecided: () => void;
  readonly onContinue: () => void;
}

export function AwaitingDecisions({
  awaiting,
  projectId,
  token,
  resuming,
  stillWaiting,
  resumeError,
  onDecided,
  onContinue,
}: AwaitingDecisionsProps) {
  return (
    <div className="interview" data-testid="interview-awaiting-decisions">
      <h3>Your decision is needed</h3>
      <p>
        The blueprint is written and kept. Before the board can be built,{' '}
        {awaiting.decisions.length === 1
          ? 'one question needs'
          : `${String(awaiting.decisions.length)} questions need`}{' '}
        your answer — these are choices only you can make, so nothing was guessed on your
        behalf.
      </p>
      <ul>
        {awaiting.decisions.map((d) => (
          <li key={d.slate_id}>{d.title}</li>
        ))}
      </ul>
      {token === undefined ? (
        <p className="interview__error" role="alert">
          Your decisions were saved, but this session has no API token to load them —
          reopen this project to answer them.
        </p>
      ) : (
        <DecisionsBoard projectId={projectId} token={token} onDecided={onDecided} />
      )}
      <p className="interview__hint">
        Answer each one above, then continue — the blueprint will not be rebuilt.
      </p>
      <button
        type="button"
        disabled={resuming}
        data-testid="interview-continue"
        onClick={onContinue}
      >
        {resuming ? 'Continuing…' : 'Continue'}
      </button>
      {stillWaiting !== null && (
        <p
          className="interview__hint"
          role="status"
          data-testid="interview-still-waiting"
        >
          {stillWaiting}
        </p>
      )}
      {resumeError !== null && (
        <p className="interview__error" role="alert" data-testid="interview-resume-error">
          Could not continue: {resumeError}
        </p>
      )}
    </div>
  );
}
