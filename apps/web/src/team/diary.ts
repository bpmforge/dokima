/**
 * The work diary (W20-03): what a member actually did, from their own slice of
 * the append-only log.
 *
 * The diary is the receipts wearing a face. Nothing here summarises, ranks or
 * infers — it filters the ledger to one actor, humanises each event through
 * the SAME map the trace view uses (W16-08), and keeps the raw event type so
 * every line can be checked against the evidence it came from. An event kind
 * nobody has humanised yet renders its kind label rather than being hidden:
 * a diary that silently drops what it cannot phrase would be lying by
 * omission (D-028).
 */
import { classifyTraceEvent, describeTraceEvent } from '../trace/classify.js';
import type { TraceEvent } from '../board/drawer/types.js';

export interface DiaryEntry {
  readonly seq: number;
  readonly at: string;
  /** Humanised line — never invented, always from the shared event map. */
  readonly line: string;
  /** The raw event type, so a reader can verify the phrasing against the log. */
  readonly eventType: string;
  readonly ticketId: string | null;
  /** Receipt id when this event minted one — the diary's proof, when it exists. */
  readonly receiptId: string | null;
}

function receiptIdOf(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  for (const key of ['receipt_id', 'receiptId', 'gate_receipt_id']) {
    const v = p[key];
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

function matchesActor(eventActor: string, actorId: string): boolean {
  return eventActor === actorId || eventActor.endsWith(`:${actorId}`);
}

/**
 * One member's events, newest first. `limit` caps what is RENDERED, never what
 * is counted — callers show the total so a trimmed view never reads as the
 * whole story.
 */
export function buildWorkDiary(
  events: readonly TraceEvent[],
  actorId: string,
  limit = 12,
): { entries: DiaryEntry[]; total: number } {
  const mine = events
    .filter((e) => matchesActor(e.actor_id, actorId))
    .sort((a, b) => b.seq - a.seq);
  const entries = mine.slice(0, limit).map((e) => ({
    seq: e.seq,
    at: e.created_at,
    line: describeTraceEvent(e.event_type),
    eventType: e.event_type,
    ticketId: e.ticket_id,
    receiptId: receiptIdOf(e.payload),
  }));
  return { entries, total: mine.length };
}

/** Coarse grouping for the diary's left rail, reusing the trace taxonomy. */
export function diaryKind(entry: DiaryEntry): string {
  return classifyTraceEvent(entry.eventType);
}
