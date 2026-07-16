import { claimNowEntries } from './claimStrip.js';
import type { BoardTicket } from './types.js';

export interface ClaimNowStripProps {
  tickets: readonly BoardTicket[];
  onClaim: (ticketId: string) => void;
}

/** Claim-now strip (UX_SPEC §4): the smallest ready ticket per lane, one click to claim. */
export function ClaimNowStrip({ tickets, onClaim }: ClaimNowStripProps) {
  const entries = claimNowEntries(tickets);
  if (entries.length === 0) return null;
  return (
    <section className="board-strip board-strip--claim-now" aria-label="Claim now">
      {entries.map((ticket) => (
        <button
          key={ticket.id}
          type="button"
          className="board-strip__item"
          onClick={() => onClaim(ticket.id)}
        >
          {ticket.lane}: {ticket.id} — {ticket.title}
        </button>
      ))}
    </section>
  );
}
