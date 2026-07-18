import { describe, expect, it } from 'vitest';
import type { Ticket, TicketStatus } from '@shipwright/tickets';
import { busyLanes, pickNextBerthTicket } from '../src/berths-scheduler.js';

function makeTicket(
  id: string,
  lane: string,
  status: TicketStatus,
  overrides: Partial<Ticket> = {},
): Ticket {
  return {
    id,
    type: 'task',
    title: id,
    lane,
    ownerId: status === 'ready' ? null : 'someone',
    status,
    interface: null,
    writeScope: ['packages/example/**'],
    dependsOn: [],
    acceptance: [],
    verify: null,
    manifest: null,
    history: [],
    evidence: [],
    claimedAt: null,
    closedAt: null,
    ...overrides,
  };
}

describe('busyLanes', () => {
  it('treats claimed/in_progress/in_review as busy, ready/done/blocked as free', () => {
    const tickets = [
      makeTicket('A', 'core', 'claimed'),
      makeTicket('B', 'infra', 'in_progress'),
      makeTicket('C', 'ui', 'in_review'),
      makeTicket('D', 'docs', 'ready'),
      makeTicket('E', 'ops', 'done'),
      makeTicket('F', 'perf', 'blocked'),
    ];
    expect(busyLanes(tickets)).toEqual(new Set(['core', 'infra', 'ui']));
  });

  it('a lane with any active ticket is busy even if other tickets in it are done', () => {
    const tickets = [
      makeTicket('A', 'core', 'done'),
      makeTicket('B', 'core', 'in_progress'),
    ];
    expect(busyLanes(tickets)).toEqual(new Set(['core']));
  });
});

describe('pickNextBerthTicket (D-010: at most one berth per lane)', () => {
  it('picks the lowest-id claimable ticket when no lane is busy', () => {
    const tickets = [
      makeTicket('W9-02', 'core', 'ready'),
      makeTicket('W9-01', 'infra', 'ready'),
    ];
    expect(pickNextBerthTicket(tickets, new Set())?.id).toBe('W9-01');
  });

  it('skips a ticket whose lane already has an active ticket, even a lower id', () => {
    const tickets = [
      makeTicket('W9-01', 'core', 'in_progress'),
      makeTicket('W9-02', 'core', 'ready'),
      makeTicket('W9-03', 'infra', 'ready'),
    ];
    expect(pickNextBerthTicket(tickets, new Set())?.id).toBe('W9-03');
  });

  it('an in_review ticket still occupies its lane (FR-T3 parity)', () => {
    const tickets = [
      makeTicket('W9-01', 'core', 'in_review'),
      makeTicket('W9-02', 'core', 'ready'),
    ];
    expect(pickNextBerthTicket(tickets, new Set())).toBeUndefined();
  });

  it('respects the skip set', () => {
    const tickets = [makeTicket('W9-01', 'core', 'ready')];
    expect(pickNextBerthTicket(tickets, new Set(['W9-01']))).toBeUndefined();
  });

  it('returns undefined when every claimable ticket is in a busy lane', () => {
    const tickets = [
      makeTicket('W9-01', 'core', 'in_progress'),
      makeTicket('W9-02', 'core', 'ready'),
    ];
    expect(pickNextBerthTicket(tickets, new Set())).toBeUndefined();
  });

  it('never returns an unclaimable ticket (owned, done, or dep-blocked)', () => {
    const tickets = [
      makeTicket('W9-01', 'core', 'done'),
      makeTicket('W9-02', 'infra', 'ready', { dependsOn: ['W9-99'] }),
    ];
    expect(pickNextBerthTicket(tickets, new Set())).toBeUndefined();
  });

  it('picking tickets for two different berths in sequence never yields the same lane twice while both stay active', () => {
    const tickets = [
      makeTicket('W9-01', 'core', 'ready'),
      makeTicket('W9-02', 'core', 'ready'),
      makeTicket('W9-03', 'infra', 'ready'),
    ];
    const skip = new Set<string>();
    const first = pickNextBerthTicket(tickets, skip);
    expect(first?.id).toBe('W9-01');
    // Simulate berth 1 claiming W9-01 (now active) before berth 2 picks.
    const afterFirstClaim = tickets.map((t) =>
      t.id === 'W9-01' ? { ...t, status: 'in_progress' as const, ownerId: 'berth-1' } : t,
    );
    const second = pickNextBerthTicket(afterFirstClaim, skip);
    // W9-02 shares W9-01's now-busy 'core' lane, so berth 2 must skip to infra.
    expect(second?.id).toBe('W9-03');
  });
});
