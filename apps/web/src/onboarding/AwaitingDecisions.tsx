import { useState } from 'react';
import { DecisionsBoard } from '../decisions/DecisionsBoard.js';
import { FailureNotice } from './FailureNotice.js';
import type { FriendlyFailure } from './friendly-error.js';
import { RUN_PHASES, type PipelineAwaitingDecisions } from './types.js';

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
  readonly resumeError: FriendlyFailure | null;
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
  // W17-12: the screen notices when you are done — after the last answer the
  // ask-header kept asking. Counted from this session's decide clicks; a
  // reloaded page shows the ask until Continue, which is honest enough.
  const [decidedCount, setDecidedCount] = useState(0);
  const allDecided =
    awaiting.decisions.length > 0 && decidedCount >= awaiting.decisions.length;

  return (
    <div className="interview" data-testid="interview-awaiting-decisions">
      <h3 data-testid="awaiting-header">
        {allDecided ? 'All answered — continue when ready' : 'Your decision is needed'}
      </h3>
      {allDecided ? (
        <p>
          Every question has your answer, recorded in the ledger. Continue picks
          the run back up from the kept blueprint.
        </p>
      ) : (
        <p>
          The blueprint is written and kept. Before the board can be built,{' '}
          {awaiting.decisions.length === 1
            ? 'one question needs'
            : `${String(awaiting.decisions.length)} questions need`}{' '}
          your answer — these are choices only you can make, so nothing was guessed on
          your behalf.
        </p>
      )}
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
        <DecisionsBoard
          projectId={projectId}
          token={token}
          onDecided={() => {
            setDecidedCount((count) => count + 1);
            onDecided();
          }}
        />
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
      {/* W17-12: minutes of a dead button on local hardware. The blueprint is
          already done and KEPT (mechanism-true: the resume never rebuilds it);
          the remaining stages are what the model is working through now. */}
      {resuming && (
        <ol className="interview__phases" data-testid="resume-phases">
          {RUN_PHASES.map((phase) => (
            <li key={phase.name} data-phase={phase.name}>
              {phase.name === 'blueprint' ? '✓' : '…'} {phase.label}
              {phase.name === 'blueprint' ? ' (kept — not rebuilt)' : ''}
            </li>
          ))}
        </ol>
      )}
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
        <FailureNotice failure={resumeError} testId="interview-resume-error" />
      )}
    </div>
  );
}
