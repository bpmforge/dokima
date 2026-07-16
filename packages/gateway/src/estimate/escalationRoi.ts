/**
 * Escalation-ROI rollup (US-309, R-A2, API_DESIGN "GET .../spend?group_by=
 * rung"): "what did escalation buy" — spend grouped by rung, per ticket,
 * beside that ticket's outcome. Pure aggregation over caller-supplied
 * ledger rows (see `types.ts`'s `RungLedgerEntry` for why the shape is
 * reproduced rather than imported from `budget/types.ts`).
 */

import { RUNG_ORDER } from '../escalation/types.js';
import type {
  EscalationRoiRungGroup,
  EscalationRoiTicketRow,
  RungLedgerEntry,
} from './types.js';

/** Sums cost per (rung, ticket) — a ticket that spent at the same rung across multiple entries collapses to one row. */
function rollupTickets(entries: readonly RungLedgerEntry[]): EscalationRoiTicketRow[] {
  const byTicket = new Map<string, EscalationRoiTicketRow>();
  for (const entry of entries) {
    const existing = byTicket.get(entry.ticketId);
    if (existing) {
      byTicket.set(entry.ticketId, {
        ...existing,
        spendUsd: existing.spendUsd + entry.costUsd,
      });
    } else {
      byTicket.set(entry.ticketId, {
        ticketId: entry.ticketId,
        spendUsd: entry.costUsd,
        outcome: entry.outcome,
      });
    }
  }
  return Array.from(byTicket.values()).sort((a, b) =>
    a.ticketId.localeCompare(b.ticketId),
  );
}

/**
 * Groups ledger rows by rung (`RUNG_ORDER`), summing spend and rolling up
 * each rung's per-ticket rows with their outcome (US-309 AC-2). Rungs with
 * no entries are omitted rather than rendered as a fabricated $0 row.
 */
export function groupSpendByRung(
  entries: readonly RungLedgerEntry[],
): EscalationRoiRungGroup[] {
  const byRung = new Map<string, RungLedgerEntry[]>();
  for (const entry of entries) {
    const group = byRung.get(entry.rung);
    if (group) {
      group.push(entry);
    } else {
      byRung.set(entry.rung, [entry]);
    }
  }
  return RUNG_ORDER.filter((rung) => byRung.has(rung)).map((rung) => {
    const rungEntries = byRung.get(rung) as RungLedgerEntry[];
    const tickets = rollupTickets(rungEntries);
    return {
      rung,
      totalUsd: tickets.reduce((sum, t) => sum + t.spendUsd, 0),
      tickets,
    };
  });
}
