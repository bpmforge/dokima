import { useCallback, useEffect, useRef, useState } from 'react';
import { decideApproval, fetchMorningQueue, NotificationsApiError } from './api.js';
import { NotificationCard } from './NotificationCard.js';
import type { NotificationItem } from './types.js';

/** Live-update substitute (WS push deferred — same precedent as `fleet/FleetHome.tsx`). */
const POLL_INTERVAL_MS = 5_000;
const REVIEW_TARGET_MS = 10 * 60 * 1000;
const LAST_REVIEWED_KEY = 'shipwright:morning-queue:last-reviewed-at';

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
 * Decide/Review only, Approve/Reject with no navigation required. The
 * elapsed-review timer is the design's own "ten-minute review" nudge,
 * tracked client-side since there is no session concept on the server.
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
                item.tier === 'decide' ? (
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

/** UX_SPEC §2b: "Nothing needs you. Last review N h ago; next digest at wave gate." (positive-quiet, no CTA). */
function EmptyQueue({ lastReviewedAt }: { lastReviewedAt: string | null }) {
  const suffix = lastReviewedAt
    ? `Last review ${hoursAgo(lastReviewedAt, Date.now())} h ago; next digest at wave gate.`
    : 'Next digest at wave gate.';
  return (
    <p className="morning-queue__empty" data-testid="morning-queue-empty">
      Nothing needs you. {suffix}
    </p>
  );
}
