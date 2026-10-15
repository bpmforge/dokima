import { activeBerths, formatHeartbeat } from './heartbeat.js';
import type { HeartbeatData } from './types.js';
import { useHeartbeatClock } from './useLiveRun.js';

export interface ActiveBerthsStripProps {
  heartbeats: ReadonlyMap<string, HeartbeatData>;
}

/**
 * Active-berths strip (UX_SPEC §4): who works on what, heartbeat-fresh;
 * stalls turn amber (§7.1). Quiet (nothing rendered) when no berth runs —
 * the badge is informational, not an alarm.
 */
export function ActiveBerthsStrip({ heartbeats }: ActiveBerthsStripProps) {
  const now = useHeartbeatClock(heartbeats.size > 0);
  const berths = activeBerths(heartbeats, now);
  if (berths.length === 0) return null;
  return (
    <section className="board-strip board-strip--berths" aria-label="Active berths">
      {berths.map((berth) => (
        <span
          key={berth.ticketId}
          className="board-strip__item"
          data-freshness={berth.freshness}
          data-stale={berth.stale ? 'true' : undefined}
          data-testid={`berth-${berth.ticketId}`}
        >
          {berth.ticketId} · {formatHeartbeat(berth.heartbeat, now)}
        </span>
      ))}
    </section>
  );
}
