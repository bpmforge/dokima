/**
 * One approval, and a build a person can read (W23-14, AB-14).
 *
 * BEFORE THIS the board had one button and two words. "Start a run" started an
 * unapproved run, and the only thing it ever said back was `running` and then
 * a terminal status — so a person watching for forty minutes could not tell
 * work from a hang, and `approved-build-v1` (W23-02), the policy that lets the
 * machine finish anything by itself, had no entrance a human could reach.
 *
 * THE PREVIEW IS THE APPROVAL. What the digest covers is shown before the
 * button that records it: the tickets and their scopes, the two models, the
 * budget, and the things that will stop and ask however this is set (C-5). A
 * confirmation over an unstated specification is a click, not a decision.
 *
 * AND IT IS ASKED ONCE. After the approval, the run's own progress replaces
 * it — no per-ticket confirmations, which is the whole point of the card, and
 * anything that still needs a person is named with the policy rule that
 * refused it rather than a generic "needs review".
 */

import { useCallback, useEffect, useState } from 'react';
import type { BoardApiOptions } from './api.js';
import { stopBuildRun } from './api.js';
import {
  approveBuild,
  fetchApprovedBuildPreview,
  fetchBuildProgress,
  fetchBuildRuns,
  startApprovedBuildRun,
  type ApprovedBuildPreview,
  type BuildPhase,
  type BuildRunProgress,
} from './approvedBuildApi.js';

/** The words a person reads. Six from AB-14 step 3, plus the two the six cannot say. */
const PHASE_LABEL: Record<BuildPhase, string> = {
  not_started: 'Not started',
  building: 'Building',
  checking: 'Checking',
  fixing: 'Fixing',
  ready_to_review: 'Ready to review',
  needs_decision: 'Needs your decision',
  stopped: 'Stopped',
  failed: 'Did not finish',
};

export interface ApprovedBuildPanelProps {
  readonly apiOpts: BoardApiOptions;
  readonly projectId: string;
  readonly budgetUsd?: number;
  readonly onSelectTicket?: (ticketId: string) => void;
  /** Injectable so the tests are not timing tests. Omitted, the panel polls. */
  readonly pollMs?: number | null;
}

export function ApprovedBuildPanel({
  apiOpts,
  projectId,
  budgetUsd = 0,
  onSelectTicket,
  pollMs = 2000,
}: ApprovedBuildPanelProps) {
  const [preview, setPreview] = useState<ApprovedBuildPreview | null>(null);
  const [progress, setProgress] = useState<BuildRunProgress | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * A RELOAD READS THE SERVER, not this component's memory. The board's older
   * poll kept its run in React state, so a refresh mid-run showed nothing at
   * all and the person concluded it had stopped.
   */
  const refresh = useCallback(async () => {
    try {
      const runs = await fetchBuildRuns(apiOpts, projectId);
      if (!runs.ok) return;
      setProgress(runs.data[0] ?? null);
    } catch {
      // A core that is not answering is not a reason to take the board down
      // with an unhandled rejection. The panel simply shows nothing yet.
    }
  }, [apiOpts, projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (pollMs === null) return;
    const live =
      progress !== null && progress.outcome === null && !progress.stopRequested;
    if (!live) return;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const polled = await fetchBuildProgress(apiOpts, projectId, progress.runId);
          if (polled.ok) setProgress(polled.data);
        } catch {
          // Same as the mount read: a failed poll leaves the last known phase
          // on screen rather than throwing.
        }
      })();
    }, pollMs);
    return () => clearTimeout(timer);
  }, [apiOpts, projectId, progress, pollMs]);

  const openPreview = async () => {
    setProblem(null);
    const result = await fetchApprovedBuildPreview(apiOpts, projectId, budgetUsd);
    if (!result.ok) {
      setProblem(result.problem.detail ?? 'the approval details could not be read');
      return;
    }
    setPreview(result.data);
  };

  const approveAndStart = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const approved = await approveBuild(apiOpts, projectId, budgetUsd);
      if (!approved.ok) {
        setProblem(approved.problem.detail ?? 'the approval could not be recorded');
        return;
      }
      const started = await startApprovedBuildRun(apiOpts, projectId, budgetUsd);
      if (!started.ok) {
        setProblem(started.problem.detail ?? 'the run could not start');
        return;
      }
      setPreview(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!progress) return;
    setBusy(true);
    try {
      await stopBuildRun(apiOpts, projectId, progress.runId);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const live = progress !== null && progress.outcome === null;
  const needsDecision = (progress?.tickets ?? []).filter(
    (t) => t.state === 'needs_decision',
  );

  return (
    <section className="approved-build" data-testid="approved-build-panel">
      <h3>Approved build</h3>

      {progress && (
        <div data-testid="approved-build-progress">
          <p>
            <strong data-testid="approved-build-phase">
              {PHASE_LABEL[progress.phase]}
            </strong>{' '}
            — <span data-testid="approved-build-detail">{progress.detail}</span>
          </p>
          <ul data-testid="approved-build-tickets">
            {progress.tickets.map((ticket) => (
              <li key={ticket.ticketId}>
                <button
                  type="button"
                  className="btn-quiet"
                  onClick={() => onSelectTicket?.(ticket.ticketId)}
                >
                  {ticket.ticketId}
                </button>{' '}
                — {ticket.state.replace('_', ' ')}
                {ticket.repairRounds > 0 && ` · ${ticket.repairRounds} repair round(s)`}
                {ticket.reason && (
                  <>
                    {' · '}
                    <span data-testid={`approved-build-reason-${ticket.ticketId}`}>
                      {ticket.reason}
                      {ticket.ruleId ? ` (${ticket.ruleId})` : ''}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
          {needsDecision.length > 0 && (
            <p data-testid="approved-build-decisions">
              {needsDecision.length} ticket(s) need your decision. Open one to read the
              review, its checks and the receipt behind them.
            </p>
          )}
          {/*
            AB-14 step 4. There is no running-app preview in this product, and
            inventing one would be a second IDE. Said plainly rather than left
            as an empty pane a person waits on.
          */}
          <p data-testid="approved-build-preview-unavailable">
            No live preview: Dokima does not run your app. What it can show is the
            evidence — open a ticket for its review, checks and signed receipt.
          </p>
          {live && (
            <button
              type="button"
              className="btn-quiet"
              data-testid="approved-build-stop"
              disabled={busy}
              onClick={() => void stop()}
              title="The run stops at the next ticket boundary — work already in flight finishes or parks honestly."
            >
              Stop the run
            </button>
          )}
          {!live && (
            <button
              type="button"
              className="btn-quiet"
              data-testid="approved-build-resume"
              disabled={busy}
              onClick={() => void approveAndStart()}
              title="A stopped run stays stopped — this starts a new run under a fresh approval of the current specification."
            >
              Resume (starts a new run)
            </button>
          )}
        </div>
      )}

      {!live && !preview && (
        <button
          type="button"
          className="btn-primary"
          data-testid="approved-build-review"
          onClick={() => void openPreview()}
        >
          Set up an approved run
        </button>
      )}

      {preview && (
        <div data-testid="approved-build-preview">
          <p>
            You are approving {preview.tickets.length} ticket(s), a budget of $
            {preview.budgetUsd.toFixed(2)}, and this exact specification (
            <code>{preview.inputDigest.slice(0, 19)}…</code>). If any of it changes, the
            approval stops applying and the run refuses rather than proceeding.
          </p>
          <ul data-testid="approved-build-preview-tickets">
            {preview.tickets.map((ticket) => (
              <li key={ticket.id}>
                <strong>{ticket.id}</strong> {ticket.title} — writes{' '}
                {ticket.writeScope.join(', ') || '(nothing declared)'}
              </li>
            ))}
          </ul>
          <p data-testid="approved-build-models">
            Built by {preview.makerModel ?? 'no model configured'}, reviewed by{' '}
            {preview.reviewerModel ?? 'no model configured'}.
          </p>
          {!preview.independentReview && (
            <p role="alert" data-testid="approved-build-no-independent-review">
              This cannot finish without you: {preview.independentReviewReason}
            </p>
          )}
          <p data-testid="approved-build-still-asks">
            Whatever you approve, these always stop and ask:{' '}
            {preview.stillAsksYou.map((item) => item.label).join(', ')}. Merging to your
            main branch and publishing stay separate decisions.
          </p>
          <button
            type="button"
            className="btn-primary"
            data-testid="approved-build-approve"
            disabled={busy}
            onClick={() => void approveAndStart()}
          >
            Approve and start
          </button>
          <button
            type="button"
            className="btn-quiet"
            data-testid="approved-build-cancel"
            onClick={() => setPreview(null)}
          >
            Cancel
          </button>
        </div>
      )}

      {problem && (
        <p role="alert" data-testid="approved-build-problem">
          {problem}
        </p>
      )}
    </section>
  );
}
