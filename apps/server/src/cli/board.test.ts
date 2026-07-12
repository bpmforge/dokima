import { describe, expect, it } from 'vitest';
import type { Ticket } from '@shipwright/tickets';
import { renderBoard } from './board.js';

function fixtureTicket(overrides: Partial<Ticket>): Ticket {
  return {
    id: 'W9-01',
    type: 'task',
    title: 'Sample',
    lane: 'core',
    ownerId: null,
    status: 'ready',
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

describe('renderBoard', () => {
  it('reports an empty log distinctly from an empty column', () => {
    expect(renderBoard([])).toBe('(no tickets)');
  });

  it('groups tickets into lane sections with one line per status column', () => {
    const tickets = [
      fixtureTicket({ id: 'W1-01', lane: 'core', status: 'ready', title: 'Ready one' }),
      fixtureTicket({ id: 'W1-02', lane: 'core', status: 'in_progress', title: 'Doing' }),
      fixtureTicket({ id: 'W1-03', lane: 'infra', status: 'done', title: 'Shipped' }),
    ];
    const board = renderBoard(tickets);

    expect(board).toContain('LANE: core');
    expect(board).toContain('LANE: infra');
    expect(board).toMatch(/ready\s+: W1-01 Ready one/);
    expect(board).toMatch(/in_progress\s+: W1-02 Doing/);
    expect(board).toMatch(/done\s+: W1-03 Shipped/);
    // A status with no tickets in a lane is rendered, not omitted.
    expect(board).toMatch(/LANE: infra\n(?:.*\n)*?\s+ready\s+: \(none\)/);
  });

  it('sorts lanes and within-column tickets deterministically', () => {
    const tickets = [
      fixtureTicket({ id: 'W2-02', lane: 'zeta', status: 'ready' }),
      fixtureTicket({ id: 'W1-02', lane: 'alpha', status: 'ready' }),
      fixtureTicket({ id: 'W1-01', lane: 'alpha', status: 'ready' }),
    ];
    const board = renderBoard(tickets);
    const alphaIdx = board.indexOf('LANE: alpha');
    const zetaIdx = board.indexOf('LANE: zeta');
    expect(alphaIdx).toBeLessThan(zetaIdx);

    const alphaSection = board.slice(alphaIdx, zetaIdx);
    expect(alphaSection.indexOf('W1-01')).toBeLessThan(alphaSection.indexOf('W1-02'));
  });
});
