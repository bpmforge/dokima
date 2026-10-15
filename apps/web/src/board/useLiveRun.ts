import { useEffect, useState } from 'react';
import type { BoardApiOptions } from './api.js';
import { fetchBuildRuns } from './approvedBuildApi.js';

/** How often the board asks which run is live, while it holds none. */
export const LIVE_RUN_POLL_MS = 5_000;
/** Re-render period for heartbeat ages and the stale marker. */
export const HEARTBEAT_CLOCK_MS = 1_000;

/**
 * Review R1: which build run is live in this project, so the board can
 * subscribe to its `run:{id}` heartbeats (API_DESIGN §3). An explicit `runId`
 * wins and is not polled. Otherwise the newest run with no outcome yet is the
 * live one — read from `GET .../build-runs`, the same durable record the
 * approved-build panel reads, so a reload or a run started elsewhere in the
 * product is still found. A failed read keeps the last answer: this only
 * chooses what to listen to, it decides nothing.
 */
export function useLiveRunId(
  opts: BoardApiOptions,
  projectId: string,
  explicitRunId?: string,
): string | undefined {
  const [liveRunId, setLiveRunId] = useState<string | undefined>(undefined);
  const { baseUrl, token, fetchImpl } = opts;

  useEffect(() => {
    if (explicitRunId) return;
    let cancelled = false;
    const read = () => {
      fetchBuildRuns({ baseUrl, token, fetchImpl }, projectId)
        .then((result) => {
          if (cancelled || !result.ok || !Array.isArray(result.data)) return;
          const live = result.data.find((run) => run && run.outcome === null);
          setLiveRunId(live?.runId);
        })
        .catch(() => undefined);
    };
    read();
    const timer = setInterval(read, LIVE_RUN_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [baseUrl, token, fetchImpl, projectId, explicitRunId]);

  return explicitRunId ?? liveRunId;
}

/** `Date.now()`, refreshed every second while `enabled` — ages tick on screen (review R2). */
export function useHeartbeatClock(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), HEARTBEAT_CLOCK_MS);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}
