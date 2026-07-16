import { BOARD_COLUMNS } from './transitions.js';
import type { BoardTicket, TicketStatus } from './types.js';

export interface BoardColumn {
  status: TicketStatus;
  tickets: BoardTicket[];
}

export interface BoardLane {
  lane: string;
  columns: BoardColumn[];
}

/**
 * Swimlanes = lanes; columns = the fixed lifecycle statuses (UX_SPEC §4).
 * Lanes sort alphabetically for a stable layout; within a column, tickets
 * sort by the board projection's `sortKey` (DATABASE.md §3).
 */
export function groupIntoLanes(tickets: readonly BoardTicket[]): BoardLane[] {
  const laneNames = Array.from(new Set(tickets.map((t) => t.lane))).sort();
  return laneNames.map((lane) => {
    const inLane = tickets.filter((t) => t.lane === lane);
    return {
      lane,
      columns: BOARD_COLUMNS.map((status) => ({
        status,
        tickets: inLane
          .filter((t) => t.status === status)
          .slice()
          .sort((a, b) => a.sortKey.localeCompare(b.sortKey)),
      })),
    };
  });
}
