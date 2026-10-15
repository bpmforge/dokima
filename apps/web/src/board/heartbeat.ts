import type { HeartbeatData } from './types.js';

export type HeartbeatFreshness = 'fresh' | 'amber';

/**
 * Heartbeats run every 15s each direction, 2 missed → the socket closes
 * (API_DESIGN §3). Amber at 2 missed beats (30s) matches that same
 * contract — a stall visible in the UI at the exact point the transport
 * itself would give up (UX_SPEC §4 "stalls turn amber ... within seconds").
 * Measured against the AGENT's last activity, not the last message.
 */
export const AMBER_THRESHOLD_S = 30;

/**
 * Review R1: the run producer re-sends every active ticket every 5s
 * (API_DESIGN §3). Three missed beats and the line says so — the producer,
 * the socket or the process has gone quiet, and a frozen "working" line would
 * be a claim nobody is still making.
 */
export const STALE_AFTER_S = 15;

/** Plain words for the producer's `phase` values (API_DESIGN §3). */
const PHASE_TEXT: Record<string, string> = {
  claiming: 'Claiming the ticket',
  preparing: 'Preparing a workspace',
  working: 'Working',
  waiting_on_model: 'Waiting on the model',
  retrying_provider: 'Retrying the model provider',
  escalating: 'Moving to a stronger model',
  verifying: 'Checking the work',
  reviewing: 'In review',
  paused: 'Paused at a limit',
};

export function heartbeatFreshness(ageSeconds: number): HeartbeatFreshness {
  return ageSeconds >= AMBER_THRESHOLD_S ? 'amber' : 'fresh';
}

/** Whole seconds since this heartbeat arrived; 0 when the arrival time is unknown. */
export function secondsSinceReceived(hb: HeartbeatData, nowMs?: number): number {
  if (nowMs === undefined || hb.receivedAtMs === undefined) return 0;
  return Math.max(0, Math.floor((nowMs - hb.receivedAtMs) / 1000));
}

/** `age_s` ticked forward locally, so a stalled agent's age keeps growing (review R2). */
export function currentAgeSeconds(hb: HeartbeatData, nowMs?: number): number {
  return hb.age_s + secondsSinceReceived(hb, nowMs);
}

/** No heartbeat for `STALE_AFTER_S` — the live line can no longer be trusted. */
export function isHeartbeatStale(hb: HeartbeatData, nowMs?: number): boolean {
  return secondsSinceReceived(hb, nowMs) >= STALE_AFTER_S;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/**
 * The live status line. With a run producer's `phase`:
 * `"Working (write_file) · fake-model · rung R1 · 2m 5s in · last activity 3s ago"`.
 * Only fields the server sent appear. A legacy beat keeps the UX_SPEC §4
 * `"pass 2/3 · 40s ago"` form.
 */
export function formatHeartbeat(hb: HeartbeatData, nowMs?: number): string {
  const age = currentAgeSeconds(hb, nowMs);
  const stale = isHeartbeatStale(hb, nowMs)
    ? ` · no update for ${formatDuration(secondsSinceReceived(hb, nowMs))}`
    : '';
  if (!hb.phase) {
    const head = hb.pass ? `pass ${hb.pass} · ` : '';
    return `${head}${age}s ago${stale}`;
  }
  const parts = [
    `${PHASE_TEXT[hb.phase] ?? hb.phase.replaceAll('_', ' ')}${hb.step ? ` (${hb.step})` : ''}`,
  ];
  if (hb.model) parts.push(hb.model);
  if (hb.rung) parts.push(`rung ${hb.rung}`);
  if (hb.berth) parts.push(hb.berth);
  if (hb.elapsed_s !== undefined) {
    parts.push(`${formatDuration(hb.elapsed_s + secondsSinceReceived(hb, nowMs))} in`);
  }
  parts.push(`last activity ${formatDuration(age)} ago`);
  return parts.join(' · ') + stale;
}

export interface Berth {
  ticketId: string;
  heartbeat: HeartbeatData;
  freshness: HeartbeatFreshness;
  stale: boolean;
}

/** Active-berths strip (UX_SPEC §4): one entry per ticket with a live heartbeat. */
export function activeBerths(
  heartbeats: ReadonlyMap<string, HeartbeatData>,
  nowMs?: number,
): Berth[] {
  return Array.from(heartbeats.entries())
    .map(([ticketId, heartbeat]) => ({
      ticketId,
      heartbeat,
      freshness: heartbeatFreshness(currentAgeSeconds(heartbeat, nowMs)),
      stale: isHeartbeatStale(heartbeat, nowMs),
    }))
    .sort((a, b) => a.ticketId.localeCompare(b.ticketId));
}
