import { activeBerths, formatHeartbeat } from './heartbeat.js';
import type { HeartbeatData } from './types.js';

export interface ActiveBerthsStripProps {
  heartbeats: ReadonlyMap<string, HeartbeatData>;
}

/**
 * Active-berths strip (UX_SPEC §4): who works on what, heartbeat-fresh;
 * stalls turn amber (§7.1). Quiet (nothing rendered) when no berth runs —
 * the badge is informational, not an alarm.
 */
export function ActiveBerthsStrip({ heartbeats }: ActiveBerthsStripProps) {
  const berths = activeBerths(heartbeats);
  if (berths.length === 0) return null;
  return (
    <section className="board-strip board-strip--berths" aria-label="Active berths">
      {berths.map((berth) => (
        <span
          key={berth.ticketId}
          className="board-strip__item"
          data-freshness={berth.freshness}
          data-testid={`berth-${berth.ticketId}`}
        >
          {berth.ticketId} · {formatHeartbeat(berth.heartbeat)}
        </span>
      ))}
    </section>
  );
}
