/**
 * The cost ledger (FR-G4): an append-only in-memory record of spend, keyed
 * by project/run/ticket, queryable at ticket/run/project granularity. Run
 * and project totals never filter by berth — that is what makes breakers
 * "aggregate across berths" (FR-H5) rather than something a caller has to
 * remember to do.
 */

import type { LedgerEntry, LedgerKey } from './types.js';

export class CostLedger {
  private readonly entries: LedgerEntry[] = [];

  record(entry: LedgerEntry): void {
    this.entries.push(entry);
  }

  allEntries(): readonly LedgerEntry[] {
    return this.entries;
  }

  totalForTicket(key: Pick<LedgerKey, 'projectId' | 'runId' | 'ticketId'>): number {
    return sumCost(
      this.entries.filter(
        (entry) =>
          entry.projectId === key.projectId &&
          entry.runId === key.runId &&
          entry.ticketId === key.ticketId,
      ),
    );
  }

  /** Aggregated across every ticket and berth in the run (FR-H5). */
  totalForRun(projectId: string, runId: string): number {
    return sumCost(
      this.entries.filter(
        (entry) => entry.projectId === projectId && entry.runId === runId,
      ),
    );
  }

  /** Aggregated across every run, ticket, and berth in the project (FR-G4: breakers apply "per project"). */
  totalForProject(projectId: string): number {
    return sumCost(this.entries.filter((entry) => entry.projectId === projectId));
  }
}

function sumCost(entries: readonly LedgerEntry[]): number {
  return entries.reduce((total, entry) => total + entry.costUsd, 0);
}
