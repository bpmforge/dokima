import type { HeartbeatData } from './types.js';

export type HeartbeatFreshness = 'fresh' | 'amber';

/**
 * Heartbeats run every 15s each direction, 2 missed → the socket closes
 * (API_DESIGN §3). Amber at 2 missed beats (30s) matches that same
 * contract — a stall visible in the UI at the exact point the transport
 * itself would give up (UX_SPEC §4 "stalls turn amber ... within seconds").
 */
export const AMBER_THRESHOLD_S = 30;

export function heartbeatFreshness(ageSeconds: number): HeartbeatFreshness {
  return ageSeconds >= AMBER_THRESHOLD_S ? 'amber' : 'fresh';
}

/** `"pass 2/3 · 40s ago"` (UX_SPEC §4 card contents). */
export function formatHeartbeat(hb: HeartbeatData): string {
  return `pass ${hb.pass} · ${hb.age_s}s ago`;
}

export interface Berth {
  ticketId: string;
  heartbeat: HeartbeatData;
  freshness: HeartbeatFreshness;
}

/** Active-berths strip (UX_SPEC §4): one entry per ticket with a live heartbeat. */
export function activeBerths(heartbeats: ReadonlyMap<string, HeartbeatData>): Berth[] {
  return Array.from(heartbeats.entries())
    .map(([ticketId, heartbeat]) => ({
      ticketId,
      heartbeat,
      freshness: heartbeatFreshness(heartbeat.age_s),
    }))
    .sort((a, b) => a.ticketId.localeCompare(b.ticketId));
}
