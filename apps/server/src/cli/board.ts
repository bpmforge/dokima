import type { Ticket, TicketStatus } from '@shipwright/tickets';

/** Column order for the text board (DATABASE.md §3 `tickets.status`). */
const STATUS_COLUMNS: readonly TicketStatus[] = [
  'ready',
  'claimed',
  'in_progress',
  'in_review',
  'blocked',
  'done',
  'waived',
];

function formatTicketEntry(ticket: Ticket): string {
  return `${ticket.id} ${ticket.title}`;
}

/** Text board: one lane section per row, one status column per line (W0 exit criterion). */
export function renderBoard(tickets: readonly Ticket[]): string {
  if (tickets.length === 0) return '(no tickets)';

  const lanes = Array.from(new Set(tickets.map((t) => t.lane))).sort();
  const lines: string[] = [];
  for (const lane of lanes) {
    lines.push(`LANE: ${lane}`);
    const inLane = tickets.filter((t) => t.lane === lane);
    for (const status of STATUS_COLUMNS) {
      const inColumn = inLane
        .filter((t) => t.status === status)
        .sort((a, b) => a.id.localeCompare(b.id));
      const label = status.padEnd(12, ' ');
      lines.push(
        inColumn.length === 0
          ? `  ${label}: (none)`
          : `  ${label}: ${inColumn.map(formatTicketEntry).join(', ')}`,
      );
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}
