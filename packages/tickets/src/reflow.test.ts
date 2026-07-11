import { describe, expect, it } from 'vitest';
import { computeBoard, effectiveStatus, isClaimable, isStaleBlocked } from './reflow.js';
import type { Ticket } from './types.js';

function ticket(overrides: Partial<Ticket> & Pick<Ticket, 'id'>): Ticket {
  return {
    type: 'task',
    title: overrides.id,
    lane: 'core',
    ownerId: null,
    status: 'ready',
    interface: null,
    writeScope: [`packages/${overrides.id}/**`],
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

function byId(tickets: Ticket[]): ReadonlyMap<string, Ticket> {
  return new Map(tickets.map((t) => [t.id, t]));
}

describe('effectiveStatus / isClaimable (FR-T3 claimable-set reflow)', () => {
  it('a ready ticket with no deps is claimable and effectively ready', () => {
    const t = ticket({ id: 'T-A' });
    const map = byId([t]);
    expect(effectiveStatus(t, map)).toBe('ready');
    expect(isClaimable(t, map)).toBe(true);
  });

  it('a ready ticket with an unmet dependency is effectively blocked and not claimable', () => {
    const dep = ticket({ id: 'T-DEP', status: 'in_progress', ownerId: 'agent-1' });
    const t = ticket({ id: 'T-A', dependsOn: ['T-DEP'] });
    const map = byId([dep, t]);
    expect(effectiveStatus(t, map)).toBe('blocked');
    expect(isClaimable(t, map)).toBe(false);
  });

  it('a ready ticket depending on a missing ticket id is blocked, not claimable', () => {
    const t = ticket({ id: 'T-A', dependsOn: ['T-GHOST'] });
    const map = byId([t]);
    expect(effectiveStatus(t, map)).toBe('blocked');
    expect(isClaimable(t, map)).toBe(false);
  });

  it('blocked auto-resolves to ready the moment all deps are done — no event needed', () => {
    const dep = ticket({ id: 'T-DEP', status: 'in_progress', ownerId: 'agent-1' });
    const t = ticket({ id: 'T-A', dependsOn: ['T-DEP'] });
    const before = byId([dep, t]);
    expect(effectiveStatus(t, before)).toBe('blocked');

    const doneDep = { ...dep, status: 'done' as const };
    const after = byId([doneDep, t]);
    expect(effectiveStatus(t, after)).toBe('ready');
    expect(isClaimable(t, after)).toBe(true);
  });

  it('an owned ticket is never claimable even if technically ready-shaped', () => {
    const t = ticket({ id: 'T-A', status: 'claimed', ownerId: 'agent-1' });
    const map = byId([t]);
    expect(isClaimable(t, map)).toBe(false);
  });

  it('a ticket with multiple deps needs all of them done', () => {
    const depA = ticket({
      id: 'T-DEP-A',
      status: 'done',
      closedAt: '2026-01-01T00:00:00.000Z',
    });
    const depB = ticket({ id: 'T-DEP-B', status: 'in_progress', ownerId: 'agent-1' });
    const t = ticket({ id: 'T-A', dependsOn: ['T-DEP-A', 'T-DEP-B'] });
    const map = byId([depA, depB, t]);
    expect(effectiveStatus(t, map)).toBe('blocked');
  });
});

describe('isStaleBlocked (board UI badge)', () => {
  it('true when the stored status is literally blocked but blockers are all done', () => {
    const dep = ticket({
      id: 'T-DEP',
      status: 'done',
      closedAt: '2026-01-01T00:00:00.000Z',
    });
    const t = ticket({ id: 'T-A', status: 'blocked', dependsOn: ['T-DEP'] });
    const map = byId([dep, t]);
    expect(isStaleBlocked(t, map)).toBe(true);
  });

  it('false when stored status is blocked and blockers are genuinely unmet', () => {
    const dep = ticket({ id: 'T-DEP', status: 'in_progress', ownerId: 'agent-1' });
    const t = ticket({ id: 'T-A', status: 'blocked', dependsOn: ['T-DEP'] });
    const map = byId([dep, t]);
    expect(isStaleBlocked(t, map)).toBe(false);
  });

  it('false for a ticket that is not stored as blocked at all', () => {
    const t = ticket({ id: 'T-A' });
    const map = byId([t]);
    expect(isStaleBlocked(t, map)).toBe(false);
  });
});

describe('computeBoard', () => {
  it('recomputes claimable + status + staleBlocked fresh from the full ticket set', () => {
    const dep = ticket({ id: 'T-DEP', status: 'in_progress', ownerId: 'agent-1' });
    const blockedChild = ticket({ id: 'T-CHILD', dependsOn: ['T-DEP'] });
    const readyLeaf = ticket({ id: 'T-LEAF' });
    const owned = ticket({ id: 'T-OWNED', status: 'claimed', ownerId: 'agent-2' });

    const board = computeBoard([dep, blockedChild, readyLeaf, owned]);
    const byTicketId = new Map(board.map((b) => [b.ticketId, b]));

    expect(byTicketId.get('T-DEP')).toEqual({
      ticketId: 'T-DEP',
      status: 'in_progress',
      claimable: false,
      staleBlocked: false,
    });
    expect(byTicketId.get('T-CHILD')).toEqual({
      ticketId: 'T-CHILD',
      status: 'blocked',
      claimable: false,
      staleBlocked: false,
    });
    expect(byTicketId.get('T-LEAF')).toEqual({
      ticketId: 'T-LEAF',
      status: 'ready',
      claimable: true,
      staleBlocked: false,
    });
    expect(byTicketId.get('T-OWNED')).toEqual({
      ticketId: 'T-OWNED',
      status: 'claimed',
      claimable: false,
      staleBlocked: false,
    });
  });
});
