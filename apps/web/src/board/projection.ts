import type { ServerEnvelope } from '../lib/ws-client.js';
import type { BoardTicket, HeartbeatData } from './types.js';

/**
 * WS reducer for the `board:{projectId}` subscription (API_DESIGN §3): the
 * server streams **projection deltas**, so each `ticket.*` envelope's
 * `data` is the full updated board row (upsert by id) — correctness never
 * depends on the stream (every subscription also has the `GET .../tickets`
 * REST read, which callers use to reconcile on reconnect/`resume`).
 *
 * The exact delta shape is fixed by API_DESIGN but not yet implemented
 * server-side (see this ticket's block-note); this reducer is written
 * against the documented contract and is the integration point once
 * `apps/server/src/api/tickets*` publishes onto the hub.
 */
export function isBoardTicketRow(data: unknown): data is BoardTicket {
  return typeof data === 'object' && data !== null && 'id' in data && 'status' in data;
}

export function applyBoardEnvelope(
  tickets: ReadonlyMap<string, BoardTicket>,
  envelope: ServerEnvelope,
): ReadonlyMap<string, BoardTicket> {
  if (!envelope.type.startsWith('ticket.') || !isBoardTicketRow(envelope.data)) {
    return tickets;
  }
  const next = new Map(tickets);
  next.set(envelope.data.id, envelope.data);
  return next;
}

export function isHeartbeatData(data: unknown): data is HeartbeatData {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as Record<string, unknown>).ticket === 'string' &&
    typeof (data as Record<string, unknown>).age_s === 'number'
  );
}

/** `run:{runId}` subscription's `loop.heartbeat` envelopes, keyed by ticket (UX_SPEC §4). */
export function applyHeartbeatEnvelope(
  heartbeats: ReadonlyMap<string, HeartbeatData>,
  envelope: ServerEnvelope,
): ReadonlyMap<string, HeartbeatData> {
  if (envelope.type !== 'loop.heartbeat' || !isHeartbeatData(envelope.data)) {
    return heartbeats;
  }
  const next = new Map(heartbeats);
  next.set(envelope.data.ticket, envelope.data);
  return next;
}

export function boardSubscription(projectId: string): string {
  return `board:${projectId}`;
}

export function runSubscription(runId: string): string {
  return `run:${runId}`;
}
