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

/** A ticket's state in words: the phase label when it is one, otherwise every `_` read as a space. */
export function ticketStateLabel(state: string): string {
  return (PHASE_LABEL as Record<string, string | undefined>)[state] ?? state.replaceAll('_', ' ');
}

export interface ApprovedBuildPanelProps {
  readonly apiOpts: BoardApiOptions;
  readonly projectId: string;
  /**
   * The project's configured run limit (Settings → Autonomy), or `null` when no
   * cap is set. Review A2: this defaulted to `0` and nobody passed it, so every
   * approval read "a budget of $0.00" — a number the person never chose.
   */
  readonly budgetUsd?: number | null;
  /** Whether `budgetUsd` is known yet. Nothing is offered for approval until it is. */
  readonly budgetStatus?: 'loading' | 'ready' | 'error';
  /**
   * Review UX-04: set when the board already knows no maker model exists. A
   * new approval cannot build anything, so Set up / Approve are disabled with
   * this reason, and Resume (which would fail the same way) is hidden.
   */
  readonly noModelReason?: string | null;
  readonly onSelectTicket?: (ticketId: string) => void;
  /** Injectable so the tests are not timing tests. Omitted, the panel polls. */
  readonly pollMs?: number | null;
}

export function ApprovedBuildPanel({
  apiOpts,
  projectId,
  budgetUsd = null,
  budgetStatus = 'ready',
  noModelReason = null,
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
      // Review A1/R3: only an APPROVED build belongs in this panel. Adopting
      // the newest run of any kind put a refused unapproved "Start a run"
      // here as "Did not finish", with a Resume that approved a new build.
      setProgress(runs.data.find((run) => run.approvedBuild) ?? null);
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

  // The wire takes a number; no cap is sent as 0, exactly as the server's
  // digest already reads an absent budget. What the PERSON reads is the
  // honest version: "no budget cap is set", never "a budget of $0.00".
  const wireBudget = budgetUsd ?? 0;

  const openPreview = async () => {
    setProblem(null);
    if (budgetStatus === 'loading') {
      setProblem("Still reading this project's budget setting — try again in a moment.");
      return;
    }
    if (budgetStatus === 'error') {
      setProblem(
        "Couldn't read this project's budget setting, so there is nothing exact to approve yet. Check Settings → Autonomy, then try again.",
      );
      return;
    }
    try {
      const result = await fetchApprovedBuildPreview(apiOpts, projectId, wireBudget);
      if (!result.ok) {
        setProblem(result.problem.detail ?? 'the approval details could not be read');
        return;
      }
      setPreview(result.data);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'the approval details could not be read');
    }
  };

  const approveAndStart = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const approved = await approveBuild(apiOpts, projectId, wireBudget);
      if (!approved.ok) {
        setProblem(approved.problem.detail ?? 'the approval could not be recorded');
        return;
      }
      const started = await startApprovedBuildRun(apiOpts, projectId, wireBudget);
      if (!started.ok) {
        setProblem(started.problem.detail ?? 'the run could not start');
        return;
      }
      setPreview(null);
      await refresh();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'the run could not start');
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!progress) return;
    setBusy(true);
    setProblem(null);
    try {
      // Review R4: the stop result was discarded, so a refused stop looked
      // exactly like an accepted one.
      const stopped = await stopBuildRun(apiOpts, projectId, progress.runId);
      if (!stopped.ok) {
        setProblem(
          `The run could not be stopped: ${stopped.problem.detail ?? stopped.problem.title}`,
        );
        return;
      }
      await refresh();
    } catch (err) {
      setProblem(
        `The run could not be stopped: ${err instanceof Error ? err.message : String(err)}`,
      );
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
                — {ticketStateLabel(ticket.state)}
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
          {!live && !preview && noModelReason === null && (
            <button
              type="button"
              className="btn-quiet"
              data-testid="approved-build-resume"
              disabled={busy}
              onClick={() => void openPreview()}
              title="A stopped run stays stopped — this shows what a new run would cover, and starts it only after you approve that."
            >
              Resume (starts a new run)
            </button>
          )}
        </div>
      )}

      {!live && !preview && !progress && (
        <button
          type="button"
          className="btn-primary"
          data-testid="approved-build-review"
          disabled={noModelReason !== null}
          aria-describedby={noModelReason !== null ? 'board-run-blocked-reason' : undefined}
          onClick={() => void openPreview()}
        >
          Set up an approved run
        </button>
      )}

      {preview && (
        <div data-testid="approved-build-preview">
          <p data-testid="approved-build-summary">
            You are approving {preview.tickets.length} ticket(s),{' '}
            {budgetUsd === null
              ? 'with no budget cap set for this project (set a run limit in Settings → Autonomy)'
              : `a budget of $${budgetUsd.toFixed(2)} (this project's run limit)`}
            , and this exact specification (
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
          {(preview.makerModel === null || noModelReason !== null) && (
            <p id="approved-build-no-model" data-testid="approved-build-no-model">
              {noModelReason ??
                'Nothing can build yet: no model is set up for the coding agent. Add a provider in Settings → Providers, then pick a model in Settings → Models.'}
            </p>
          )}
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
            disabled={busy || preview.makerModel === null || noModelReason !== null}
            aria-describedby={
              preview.makerModel === null || noModelReason !== null
                ? 'approved-build-no-model'
                : undefined
            }
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
