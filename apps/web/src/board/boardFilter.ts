import { isParked } from './badges.js';
import { COLUMN_LABEL } from './transitions.js';
import type { BoardTicket, TicketStatus } from './types.js';

/**
 * Board status filter. One status at a time (or all): the board keeps its
 * lanes × columns layout and only the cards that match stay visible, so a
 * filtered board still reads as the same board.
 *
 * `parked` is not a status of its own — a parked ticket is a Ready ticket
 * whose last word was a park comment (`isParked`, W13-63) — so "Parked" is a
 * subset of "Ready", and the Ready chip counts parked tickets too, matching
 * the Ready column and the Fleet card's Ready count.
 */
export type BoardFilter = 'all' | 'parked' | Exclude<TicketStatus, 'waived'>;

/** `?filter=` — the URL carries the filter when something links to a filtered board (the Fleet card's Blocked count). */
export const BOARD_FILTER_PARAM = 'filter';

export const BOARD_FILTER_OPTIONS: readonly {
  filter: Exclude<BoardFilter, 'all'>;
  label: string;
}[] = [
  { filter: 'ready', label: COLUMN_LABEL.ready },
  { filter: 'parked', label: 'Parked' },
  { filter: 'claimed', label: COLUMN_LABEL.claimed },
  { filter: 'in_progress', label: COLUMN_LABEL.in_progress },
  { filter: 'in_review', label: COLUMN_LABEL.in_review },
  { filter: 'blocked', label: COLUMN_LABEL.blocked },
  { filter: 'done', label: COLUMN_LABEL.done },
];

const VALID = new Set<string>(['all', ...BOARD_FILTER_OPTIONS.map((o) => o.filter)]);

/** A filter from untrusted text (URL, storage); anything unknown is null. */
export function parseBoardFilter(raw: string | null | undefined): BoardFilter | null {
  return raw !== null && raw !== undefined && VALID.has(raw)
    ? (raw as BoardFilter)
    : null;
}

export function matchesBoardFilter(ticket: BoardTicket, filter: BoardFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'parked') return isParked(ticket);
  return ticket.status === filter;
}

export function filterTickets(
  tickets: readonly BoardTicket[],
  filter: BoardFilter,
): BoardTicket[] {
  return tickets.filter((t) => matchesBoardFilter(t, filter));
}

/** How many tickets each chip would show, plus `all`. */
export function countByFilter(
  tickets: readonly BoardTicket[],
): Record<BoardFilter, number> {
  const counts = { all: tickets.length } as Record<BoardFilter, number>;
  for (const { filter } of BOARD_FILTER_OPTIONS) {
    counts[filter] = tickets.filter((t) => matchesBoardFilter(t, filter)).length;
  }
  return counts;
}

export function boardFilterStorageKey(projectId: string): string {
  return `dokima.board.filter.${projectId}`;
}

/** Storage can throw (private mode, blocked site data) — a filter is a convenience, so a failure just means "all". */
export function readStoredBoardFilter(
  projectId: string,
  storage: Storage | undefined,
): BoardFilter | null {
  try {
    return parseBoardFilter(storage?.getItem(boardFilterStorageKey(projectId)));
  } catch {
    return null;
  }
}

export function writeStoredBoardFilter(
  projectId: string,
  filter: BoardFilter,
  storage: Storage | undefined,
): void {
  try {
    if (filter === 'all') storage?.removeItem(boardFilterStorageKey(projectId));
    else storage?.setItem(boardFilterStorageKey(projectId), filter);
  } catch {
    // Not persisted; the filter still applies for this visit.
  }
}

/** The URL wins (a link asked for this view); otherwise the project's remembered choice; otherwise all. */
export function initialBoardFilter(
  projectId: string,
  search: string,
  storage: Storage | undefined,
): BoardFilter {
  return (
    parseBoardFilter(new URLSearchParams(search).get(BOARD_FILTER_PARAM)) ??
    readStoredBoardFilter(projectId, storage) ??
    'all'
  );
}
