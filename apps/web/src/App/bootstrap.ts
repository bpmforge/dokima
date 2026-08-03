import { useEffect, useMemo, useState } from 'react';
import { readInjectedToken } from '../chat/api.js';
import { fetchNotifications } from '../notifications/api.js';

export function wsUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/api/v1/ws`;
}

export interface ApiOpts {
  baseUrl: string;
  token: string;
}

export interface ApiBootstrap {
  token: string | undefined;
  apiOpts: ApiOpts | null;
  wsUrl: string;
}

/** WS/token bootstrap chapter: the injected auth token, its derived API opts, and the WS URL every pane/portal needs. */
export function useApiBootstrap(): ApiBootstrap {
  const token = readInjectedToken();
  // Stable ref: TraceView's effects key off this by identity — an inline literal would refetch on every unrelated re-render.
  const apiOpts = useMemo(() => (token ? { baseUrl: '/api/v1', token } : null), [token]);
  return { token, apiOpts, wsUrl: wsUrl() };
}

/** Live-update substitute for the header bell's Decide badge (WS push deferred, same precedent as `fleet/FleetHome.tsx`). */
const DECIDE_BADGE_POLL_MS = 5_000;

export function useDecideBadgeCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      fetchNotifications({ tier: 'decide', status: 'open' })
        .then((items) => {
          if (!cancelled) setCount(items.length);
        })
        .catch(() => {
          if (!cancelled) setCount(0);
        });
    };
    refresh();
    const timer = window.setInterval(refresh, DECIDE_BADGE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  return count;
}
