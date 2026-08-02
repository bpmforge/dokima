import type { BoardTicket } from '../types.js';

/**
 * `board-wire.ts`'s `toWireBoardTicket` spreads the full
 * `@dokima/tickets` `Ticket` (which has `writeScope`) onto the wire
 * payload, but `board/types.ts`'s hand-mirrored `Ticket` interface omits
 * it (apps/web may not import `@dokima/tickets` directly, so it can
 * only declare what it chooses to read) — the field really is on every
 * response, just untyped there. The drawer's "full contract" (UX_SPEC §4)
 * needs it, so this widens the type locally rather than editing
 * `board/types.ts` (outside this ticket's write_scope).
 */
export interface ContractTicket extends BoardTicket {
  writeScope?: string[];
}

/** `GET /projects/{id}/spend?group_by=rung` row shape (API_DESIGN "budgets & spend"). */
export interface SpendRow {
  rung: string;
  amount_usd: number;
}

export interface SpendByRung {
  items: SpendRow[];
  assumptions: string[];
}

/** `GET /runs/{id}/trace` row shape (API_DESIGN "session trace: events for replay UI"). */
export interface TraceEvent {
  seq: number;
  event_type: string;
  actor_id: string;
  ticket_id: string | null;
  run_id: string | null;
  payload: unknown;
  created_at: string;
}

export type DagEditResult =
  | { kind: 'refused'; rule: string; detail: string }
  | { kind: 'not-persisted'; detail: string }
  | { kind: 'error'; detail: string };
