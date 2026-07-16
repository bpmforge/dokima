import { describe, expect, it } from 'vitest';
import { groupSpendByRung } from './escalationRoi.js';
import type { RungLedgerEntry } from './types.js';

describe('groupSpendByRung', () => {
  it('empty entries yields an empty group list, not a fabricated all-rung table', () => {
    expect(groupSpendByRung([])).toEqual([]);
  });

  it('groups by rung in RUNG_ORDER, summing per-ticket spend within a rung', () => {
    const entries: RungLedgerEntry[] = [
      { ticketId: 'W0-02', rung: 'R3', costUsd: 0.41, outcome: 'done' },
      { ticketId: 'W0-05', rung: 'R1', costUsd: 0.02, outcome: 'done' },
      // same ticket + rung across two calls collapses into one row
      { ticketId: 'W0-02', rung: 'R3', costUsd: 0.05, outcome: 'done' },
      { ticketId: 'W1-01', rung: 'R1', costUsd: 0.03, outcome: 'blocked' },
    ];
    const groups = groupSpendByRung(entries);
    expect(groups.map((g) => g.rung)).toEqual(['R1', 'R3']);

    const r1 = groups.find((g) => g.rung === 'R1');
    expect(r1?.totalUsd).toBeCloseTo(0.05);
    expect(r1?.tickets).toEqual([
      { ticketId: 'W0-05', spendUsd: 0.02, outcome: 'done' },
      { ticketId: 'W1-01', spendUsd: 0.03, outcome: 'blocked' },
    ]);

    const r3 = groups.find((g) => g.rung === 'R3');
    expect(r3?.totalUsd).toBeCloseTo(0.46);
    expect(r3?.tickets).toHaveLength(1);
    const r3Ticket = r3?.tickets.find((t) => t.ticketId === 'W0-02');
    expect(r3Ticket?.ticketId).toBe('W0-02');
    expect(r3Ticket?.spendUsd).toBeCloseTo(0.46);
    expect(r3Ticket?.outcome).toBe('done');
  });

  it('every escalated ticket row carries its outcome beside its spend (US-309 AC-2)', () => {
    const entries: RungLedgerEntry[] = [
      { ticketId: 'W0-09', rung: 'R2', costUsd: 0.12, outcome: 'in_progress' },
    ];
    const groups = groupSpendByRung(entries);
    const ticket = groups
      .find((g) => g.rung === 'R2')
      ?.tickets.find((t) => t.ticketId === 'W0-09');
    expect(ticket).toEqual({
      ticketId: 'W0-09',
      spendUsd: 0.12,
      outcome: 'in_progress',
    });
  });
});
