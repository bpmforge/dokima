import { describe, expect, it } from 'vitest';
import { CostLedger } from './ledger.js';
import type { LedgerEntry } from './types.js';

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    projectId: 'proj-1',
    runId: 'run-1',
    ticketId: 'W2-07',
    berthId: 'berth-1',
    costUsd: 1,
    promptTokens: 100,
    completionTokens: 50,
    model: 'claude-opus-4-8',
    recordedAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

describe('CostLedger', () => {
  it('totals a single ticket', () => {
    const ledger = new CostLedger();
    ledger.record(entry({ costUsd: 0.5 }));
    ledger.record(entry({ costUsd: 0.25 }));
    ledger.record(entry({ ticketId: 'W2-08', costUsd: 100 }));
    expect(
      ledger.totalForTicket({ projectId: 'proj-1', runId: 'run-1', ticketId: 'W2-07' }),
    ).toBe(0.75);
  });

  it('totals a run across every ticket and berth (FR-H5: aggregate across berths)', () => {
    const ledger = new CostLedger();
    ledger.record(entry({ ticketId: 'W2-07', berthId: 'berth-1', costUsd: 1 }));
    ledger.record(entry({ ticketId: 'W2-08', berthId: 'berth-2', costUsd: 2 }));
    ledger.record(entry({ runId: 'run-2', costUsd: 100 }));
    expect(ledger.totalForRun('proj-1', 'run-1')).toBe(3);
  });

  it('totals a project across every run, ticket, and berth', () => {
    const ledger = new CostLedger();
    ledger.record(entry({ runId: 'run-1', costUsd: 1 }));
    ledger.record(entry({ runId: 'run-2', costUsd: 2 }));
    ledger.record(entry({ projectId: 'proj-2', costUsd: 100 }));
    expect(ledger.totalForProject('proj-1')).toBe(3);
  });

  it('starts empty', () => {
    const ledger = new CostLedger();
    expect(ledger.totalForRun('proj-1', 'run-1')).toBe(0);
    expect(ledger.totalForProject('proj-1')).toBe(0);
    expect(ledger.allEntries()).toEqual([]);
  });
});
