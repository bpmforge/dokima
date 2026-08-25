/**
 * The founder queue, client side (W20-10) — Otto's funnel as the Team view
 * consumes it.
 *
 * The server (W20-09) owns the ordering and the guarantee that nothing is
 * dropped; this module only fetches and shapes. It deliberately does NOT
 * re-sort, re-rank or filter: doing any of those here would recreate on the
 * client exactly the suppression capability D-030 removed on the server.
 */
import type { BoardApiOptions } from '../board/api.js';
import { getJson } from '../board/drawer/api.js';

export interface FounderQueueRow {
  readonly id: string;
  readonly kind: string;
  readonly actorId: string;
  readonly title: string;
  readonly ticketId: string | null;
  readonly position: number;
  readonly reason: string;
}

export interface FounderQueue {
  /** The TRUE open count — always equal to `rows.length` (D-030). */
  readonly depth: number;
  readonly rows: readonly FounderQueueRow[];
}

interface Wire {
  depth: number;
  items: {
    id: string;
    kind: string;
    actor_id: string;
    title: string;
    ticket_id: string | null;
    position: number;
    reason: string;
  }[];
}

export async function fetchFounderQueue(
  opts: BoardApiOptions,
  projectId: string,
): Promise<FounderQueue> {
  const body = (await getJson(
    opts,
    `/projects/${encodeURIComponent(projectId)}/founder-queue`,
  )) as Wire;
  return {
    depth: body.depth,
    rows: body.items.map((i) => ({
      id: i.id,
      kind: i.kind,
      actorId: i.actor_id,
      title: i.title,
      ticketId: i.ticket_id,
      position: i.position,
      reason: i.reason,
    })),
  };
}

/**
 * Seat assignment for the waiting room: seat index IS queue position, so the
 * chairs read as the order Otto computed. Members waiting on a PEER are not in
 * this list at all — that absence is the visible difference between "blocked
 * on you" and merely "blocked" (OPERATIONS.md).
 */
export function seatOfActor(queue: FounderQueue, actorId: string): number | null {
  const row = queue.rows.find(
    (r) => r.actorId === actorId || r.actorId.endsWith(`:${actorId}`),
  );
  return row ? row.position : null;
}
