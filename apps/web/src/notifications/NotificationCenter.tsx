import { useCallback, useEffect, useState } from 'react';
import { dismissNotification, fetchNotifications, NotificationsApiError } from './api.js';
import { NotificationCard } from './NotificationCard.js';
import type { NotificationItem, NotificationTier } from './types.js';

const POLL_INTERVAL_MS = 5_000;
const TIER_FILTERS: readonly (NotificationTier | 'all')[] = [
  'all',
  'decide',
  'review',
  'record',
];

function tierLabel(tier: NotificationTier | 'all'): string {
  return tier === 'all' ? 'All' : `${tier[0]?.toUpperCase()}${tier.slice(1)}`;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof NotificationsApiError ? err.message : fallback;
}

export interface NotificationCenterProps {
  projectId?: string;
}

/** The notification center feed (UX_SPEC §7): every tier, Record included (feed-only, never pops). */
export function NotificationCenter({ projectId }: NotificationCenterProps) {
  const [tierFilter, setTierFilter] = useState<NotificationTier | 'all'>('all');
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await fetchNotifications({
        tier: tierFilter === 'all' ? undefined : tierFilter,
        projectId,
      });
      setItems(list);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load notifications'));
    } finally {
      setLoading(false);
    }
  }, [tierFilter, projectId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const dismiss = useCallback(
    async (item: NotificationItem) => {
      setBusyId(item.id);
      try {
        await dismissNotification(item.id, item.projectId);
        await refresh();
      } catch (err) {
        setError(errorMessage(err, 'Failed to dismiss'));
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  return (
    <div className="notification-center" data-testid="notification-center">
      <header className="notification-center__header">
        <h2>Notifications</h2>
        <div
          className="notification-center__filters"
          role="group"
          aria-label="Filter by tier"
        >
          {TIER_FILTERS.map((tier) => (
            <button
              key={tier}
              type="button"
              className="notification-center__filter"
              aria-pressed={tierFilter === tier}
              onClick={() => setTierFilter(tier)}
            >
              {tierLabel(tier)}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <p className="notification-center__error" role="alert">
          {error}
        </p>
      )}

      {!loading && items.length === 0 ? (
        <EmptyCenter />
      ) : (
        <ul className="notification-center__list" data-testid="notification-center-list">
          {items.map((item) => (
            <NotificationCard
              key={item.id}
              item={item}
              actions={
                item.status === 'open' ? (
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => void dismiss(item)}
                  >
                    Dismiss
                  </button>
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
 * UX_SPEC §2b: "Notifications, empty | activity-feed link only." No
 * activity-feed screen exists in this codebase yet (grep-verified) — plain
 * text instead of a link into a route that would 404, same discipline as
 * `apps/server/src/api/server.ts`'s chat-route header on undelivered
 * producers.
 */
function EmptyCenter() {
  return (
    <p className="notification-center__empty" data-testid="notification-center-empty">
      Nothing here yet. Activity will appear as your programs run.
    </p>
  );
}
