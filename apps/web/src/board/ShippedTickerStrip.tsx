import { shippedSinceMidnight } from './shippedTicker.js';
import type { BoardTicket } from './types.js';

export interface ShippedTickerProps {
  tickets: readonly BoardTicket[];
  now: Date;
  onSelectTicket?: (ticketId: string) => void;
}

/** Shipped-today ticker (UX_SPEC §4): commits landed since midnight, linked to their tickets. */
export function ShippedTicker({ tickets, now, onSelectTicket }: ShippedTickerProps) {
  const commits = shippedSinceMidnight(tickets, now);
  if (commits.length === 0) return null;
  return (
    <section className="board-strip board-strip--shipped" aria-label="Shipped today">
      {commits.map((commit) => (
        <button
          key={commit.sha}
          type="button"
          className="board-strip__item"
          onClick={() => onSelectTicket?.(commit.ticketId)}
        >
          {commit.sha.slice(0, 7)} → {commit.ticketId} {commit.ticketTitle}
        </button>
      ))}
    </section>
  );
}
