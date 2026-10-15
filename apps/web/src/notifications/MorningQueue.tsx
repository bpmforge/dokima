import { useCallback, useEffect, useRef, useState } from 'react';
import { decideSlate, fetchSlates } from '../decisions/api.js';
import { SlateCard } from '../decisions/SlateCard.js';
import type { SlateRecord } from '../decisions/types.js';
import {
  decideApproval,
  dismissNotification,
  fetchMorningQueue,
  NotificationsApiError,
} from './api.js';
import { McpApprovalEvidence, type McpApprovalBody } from './McpApprovalEvidence.js';
import { TicketEvidence } from './TicketEvidence.js';
import { NotificationCard } from './NotificationCard.js';
import type { NotificationItem } from './types.js';

/** Live-update substitute (WS push deferred — same precedent as `fleet/FleetHome.tsx`). */
const POLL_INTERVAL_MS = 5_000;
const REVIEW_TARGET_MS = 10 * 60 * 1000;
const LAST_REVIEWED_KEY = 'dokima:morning-queue:last-reviewed-at';

function readLastReviewedAt(): string | null {
  try {
    return window.localStorage.getItem(LAST_REVIEWED_KEY);
  } catch {
    return null;
  }
}

function writeLastReviewedAt(iso: string): void {
  try {
    window.localStorage.setItem(LAST_REVIEWED_KEY, iso);
  } catch {
    // Storage unavailable (private mode/disabled) — the empty-state nudge just degrades to generic copy.
  }
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function hoursAgo(iso: string, nowMs: number): number {
  return Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 3_600_000));
}

/** Review Q2: any Error's own message (the server's detail), not only NotificationsApiError's. */
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof NotificationsApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export interface MorningQueueProps {
  projectId?: string;
}

/**
 * The morning queue (UX_SPEC §7 signature screen): leverage-sorted,
 * Decide/Review only, answerable with no navigation required. The
 * elapsed-review timer is the design's own "ten-minute review" nudge,
 * tracked client-side since there is no session concept on the server.
 *
 * W10-80: a Decide card backed by a decision SLATE is answered inline, not
 * approved or rejected. Measured in a browser the day slate-backed cards first
 * became reachable (W10-73): Approve resolved the card, and the reconcile pass
 * correctly brought the same card straight back a second later, because
 * `decideNotification` closes the notification and never touches the slate —
 * which is still open, and still needs an answer. The behaviour was right and
 * the buttons were not: a founder slate offers 2-4 named options with
 * tradeoffs and a recommendation, so answering means CHOOSING one.
 *
 * Answering here rather than linking to the Decisions board keeps the screen's
 * own promise ("no navigation required"), and needs no new endpoint: the card
 * already carries `refId` and `projectId`, and `decisions/api.ts` already has
 * the fetch and the decide call the board itself uses. Nothing resolves the
 * notification by hand afterwards — W10-73's reconcile pass closes any card
 * whose slate is no longer open, so a refresh is the whole of it.
 */
export function MorningQueue({ projectId }: MorningQueueProps) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /**
   * Review Q1: a failed decision's error belongs to ITS card and stays until
   * that card's next attempt (or Dismiss). It used to share the page's error
   * line, which the next 5 s poll cleared — gone in under four seconds.
   */
  const [decideErrors, setDecideErrors] = useState<Record<string, string>>({});
  const clearDecideError = useCallback((id: string) => {
    setDecideErrors((current) => {
      if (!(id in current)) return current;
      const rest = { ...current };
      delete rest[id];
      return rest;
    });
  }, []);
  const [elapsedMs, setElapsedMs] = useState(0);
  const sessionStartRef = useRef(Date.now());
  const previousReviewRef = useRef<string | null>(null);

  useEffect(() => {
    previousReviewRef.current = readLastReviewedAt();
    writeLastReviewedAt(new Date().toISOString());
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - sessionStartRef.current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const queue = await fetchMorningQueue({ projectId });
      setItems(queue);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load the morning queue'));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const decide = useCallback(
    async (
      item: NotificationItem,
      decision: 'approved' | 'rejected',
      note?: string,
    ): Promise<boolean> => {
      setBusyId(item.id);
      clearDecideError(item.id);
      try {
        await decideApproval(item.id, item.projectId, decision, {}, note);
      } catch (err) {
        setDecideErrors((current) => ({
          ...current,
          [item.id]: `Your ${decision === 'approved' ? 'approval' : 'rejection'} was not recorded: ${errorMessage(err, 'the request failed')}`,
        }));
        setBusyId(null);
        return false;
      }
      setBusyId(null);
      await refresh();
      return true;
    },
    [refresh, clearDecideError],
  );

  const overTarget = elapsedMs > REVIEW_TARGET_MS;

  return (
    <div className="morning-queue" data-testid="morning-queue">
      <header className="morning-queue__header">
        <h2>Morning queue</h2>
        <span
          className="morning-queue__timer"
          data-over-target={overTarget}
          data-testid="morning-queue-elapsed"
        >
          {/* W13-53: the number gets its name — unlabeled, this read as an
              inexplicable countdown (A-5). It is the ten-minute morning-
              review budget the wizard's tomorrow card promises. */}
          review budget {formatElapsed(elapsedMs)} of 10:00
        </span>
      </header>

      {error && (
        <p className="morning-queue__error" role="alert">
          {error}
        </p>
      )}

      {!loading && items.length === 0 ? (
        <EmptyQueue lastReviewedAt={previousReviewRef.current} />
      ) : (
        <ul className="morning-queue__list" data-testid="morning-queue-list">
          {items.map((item) => (
            <NotificationCard
              key={item.id}
              item={item}
              actions={
                item.refType === 'slate' && item.refId ? (
                  <SlateAnswer
                    projectId={item.projectId}
                    slateId={item.refId}
                    onAnswered={() => void refresh()}
                  />
                ) : item.tier === 'decide' ? (
                  <DecideActions
                    item={item}
                    busy={busyId === item.id}
                    error={decideErrors[item.id] ?? null}
                    onDismissError={() => clearDecideError(item.id)}
                    onDecide={(decision, note) => decide(item, decision, note)}
                  />
                ) : item.tier === 'review' ? (
                  <div className="notification-card__actions">
                    {/* W13-61 (MEDIUM): review-tier cards had no exit — a
                        novice could not tell how the card ever left their
                        queue. It is informational; reading it is the action. */}
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      data-testid={`mark-read-${item.id}`}
                      onClick={() => {
                        setBusyId(item.id);
                        void dismissNotification(item.id, item.projectId)
                          .then(() => refresh())
                          .finally(() => setBusyId(null));
                      }}
                    >
                      Mark as read
                    </button>
                  </div>
                ) : undefined
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The slate behind a Decide card, answerable in place (W10-80).
 *
 * Reuses `SlateCard` rather than re-rendering options here: the board and the
 * queue must not drift on what a slate looks like or on what "decided" means.
 * A slate that has vanished (answered in another tab, or by a resumed run)
 * says so instead of offering a choice that would 409.
 */
/**
 * Approve / Reject for an ordinary Decide card.
 *
 * Review Q3: the consequence is read BEFORE the buttons (it used to follow
 * them), and Reject opens an optional reason recorded with the decision —
 * the route already accepted a `note` that the UI never sent.
 * Review Q4: Approve is disabled while the card itself says there is nothing
 * to approve (no manifest, still loading, or the request's details missing).
 * Reject always stays available.
 */
function DecideActions({
  item,
  busy,
  error,
  onDismissError,
  onDecide,
}: {
  item: NotificationItem;
  busy: boolean;
  error: string | null;
  onDismissError: () => void;
  onDecide: (decision: 'approved' | 'rejected', note?: string) => Promise<boolean>;
}) {
  const [ticketReady, setTicketReady] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const reasonId = `reject-reason-${item.id}`;
  const consequenceId = `decide-consequence-${item.id}`;

  const hasTicketEvidence = item.refType === 'ticket' && Boolean(item.refId);
  const mcpBody = item.body as McpApprovalBody | null;
  const mcpReady = Boolean(mcpBody) && typeof mcpBody === 'object';
  const approvable = hasTicketEvidence
    ? ticketReady
    : item.refType === 'mcp_tool_call'
      ? mcpReady
      : true;

  return (
    <div className="notification-card__actions">
      {/* W13-61 (novice audit, CRITICAL): the work, ON the card. This asked
          for a merge approval showing a title and a diff-stat string — no
          files, no verify result, no receipt. A review that cannot see the
          work is not a review. */}
      {hasTicketEvidence && (
        <TicketEvidence
          projectId={item.projectId}
          ticketId={item.refId!}
          onReadyChange={setTicketReady}
        />
      )}
      {/* W14-04: same standard for tool approvals — the exact request, on the card. */}
      {item.refType === 'mcp_tool_call' && <McpApprovalEvidence body={mcpBody} />}
      {/* Mechanism-true consequences (the HIGH finding): the click RECORDS —
          it does not merge or delete. Saying more than that would be
          promising machinery that does not run on this click. */}
      {item.refType === 'mcp_tool_call' ? (
        /* W14-04, mechanism-true (external-tools.ts): deciding records; the
           tool runs in a later pass, not on this click. */
        <p className="notification-card__consequence" id={consequenceId}>
          Approve records your decision, with your name — the tool then runs the
          next time an agent asks for it with exactly these arguments, and nowhere
          else. Reject records the refusal and nothing ever runs.
        </p>
      ) : (
        <p className="notification-card__consequence" id={consequenceId}>
          Either choice records your decision in the project's ledger, with your
          name, and clears this card. Nothing merges or is discarded by the click
          itself — the work stays on its branch, and the run waiting on this answer
          reads the ledger.
        </p>
      )}
      {error && (
        <div className="notification-card__error" role="alert" data-testid={`decide-error-${item.id}`}>
          <p>{error}</p>
          <button type="button" onClick={onDismissError}>
            Dismiss
          </button>
        </div>
      )}
      {rejecting ? (
        <div className="notification-card__reject" data-testid={`reject-form-${item.id}`}>
          <label htmlFor={reasonId}>Reason (optional — recorded with your decision)</label>
          <textarea
            id={reasonId}
            value={reason}
            rows={2}
            onChange={(event) => setReason(event.target.value)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void onDecide('rejected', reason.trim() || undefined).then((ok) => {
                if (ok) setRejecting(false);
              });
            }}
          >
            Confirm reject
          </button>
          <button type="button" disabled={busy} onClick={() => setRejecting(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            disabled={busy || !approvable}
            aria-describedby={consequenceId}
            title={approvable ? undefined : 'There is nothing on this card to approve yet.'}
            onClick={() => void onDecide('approved')}
          >
            Approve
          </button>
          <button
            type="button"
            disabled={busy}
            aria-describedby={consequenceId}
            onClick={() => setRejecting(true)}
          >
            Reject
          </button>
        </>
      )}
    </div>
  );
}

function SlateAnswer({
  projectId,
  slateId,
  onAnswered,
}: {
  projectId: string;
  slateId: string;
  onAnswered: () => void;
}) {
  const [record, setRecord] = useState<SlateRecord | null>(null);
  const [missing, setMissing] = useState(false);
  const [deciding, setDeciding] = useState(false);
  // Review Q2: a failed LOAD and a failed DECIDE are different. A failed
  // decide used to take the load-error branch and replace the options for
  // good; it now goes to SlateCard's own error line, options kept, retryable.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetchSlates(projectId, 'open')
      .then((slates) => {
        if (!live) return;
        const found = slates.find((s) => s.id === slateId) ?? null;
        setRecord(found);
        setMissing(found === null);
      })
      .catch((err: unknown) => {
        if (live) setLoadError(errorMessage(err, 'Could not load this decision'));
      });
    return () => {
      live = false;
    };
  }, [projectId, slateId]);

  if (loadError) {
    return (
      <p className="notification-card__error" role="alert">
        {loadError}
      </p>
    );
  }
  if (missing) {
    return (
      <p className="notification-card__hint" role="status">
        Already answered — this card will clear on the next refresh.
      </p>
    );
  }
  if (!record) return null;

  return (
    <div data-testid={`queue-slate-${slateId}`}>
      <SlateCard
        record={record}
        deciding={deciding}
        error={decideError}
        onDecide={async (chosen: string, rationale: string) => {
          setDeciding(true);
          setDecideError(null);
          try {
            await decideSlate(projectId, slateId, {
              chosen,
              rationale: rationale || undefined,
            });
            // No manual resolve: W10-73's reconcile pass closes the card once
            // the slate is no longer open, so refreshing is the whole of it.
            onAnswered();
          } catch (err) {
            setDecideError(
              `Could not record that decision: ${errorMessage(err, 'the request failed')}`,
            );
          } finally {
            setDeciding(false);
          }
        }}
      />
    </div>
  );
}

/** UX_SPEC §2b positive-quiet, no CTA. W13-51: the closing clause used to be
 * "next digest at wave gate" — an internal term defined nowhere a user can
 * see, as the last words of the calmest screen in the product. The digest
 * arrives when the current run finishes, so say that. */
function EmptyQueue({ lastReviewedAt }: { lastReviewedAt: string | null }) {
  const suffix = lastReviewedAt
    ? `Last review ${hoursAgo(lastReviewedAt, Date.now())} h ago; the next digest arrives when the current run finishes.`
    : 'The next digest arrives when the current run finishes.';
  return (
    <p className="morning-queue__empty" data-testid="morning-queue-empty">
      Nothing needs you. {suffix}
    </p>
  );
}
