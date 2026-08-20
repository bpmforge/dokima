import { useCallback, useEffect, useRef, useState } from 'react';
import { decideSlate, fetchSlates } from '../decisions/api.js';
import { SlateCard } from '../decisions/SlateCard.js';
import type { SlateRecord } from '../decisions/types.js';
import { decideApproval, fetchMorningQueue, NotificationsApiError } from './api.js';
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

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof NotificationsApiError ? err.message : fallback;
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
    async (item: NotificationItem, decision: 'approved' | 'rejected') => {
      setBusyId(item.id);
      try {
        await decideApproval(item.id, item.projectId, decision);
        await refresh();
      } catch (err) {
        setError(errorMessage(err, 'Failed to record decision'));
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
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
          {formatElapsed(elapsedMs)} elapsed (target 10:00)
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
                  <div className="notification-card__actions">
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => void decide(item, 'approved')}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => void decide(item, 'rejected')}
                    >
                      Reject
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
  const [error, setError] = useState<string | null>(null);

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
        if (live) setError(errorMessage(err, 'Could not load this decision'));
      });
    return () => {
      live = false;
    };
  }, [projectId, slateId]);

  if (error) {
    return (
      <p className="notification-card__error" role="alert">
        {error}
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
        error={null}
        onDecide={async (chosen: string, rationale: string) => {
          setDeciding(true);
          setError(null);
          try {
            await decideSlate(projectId, slateId, {
              chosen,
              rationale: rationale || undefined,
            });
            // No manual resolve: W10-73's reconcile pass closes the card once
            // the slate is no longer open, so refreshing is the whole of it.
            onAnswered();
          } catch (err) {
            setError(errorMessage(err, 'Could not record that decision'));
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
