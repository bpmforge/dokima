// @vitest-environment jsdom
/**
 * W13-61. The queue asked for merge approval showing a title and a
 * diff-stat string. These pin the new contract: the verified work is ON the
 * card, and a card that cannot load its work says where to look instead of
 * offering a decision on nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import * as boardApi from '../board/api.js';
import type { BoardTicket } from '../board/types.js';
import { TicketEvidence } from './TicketEvidence.js';

vi.mock('../board/api.js', async () => {
  const actual = await vi.importActual<typeof import('../board/api.js')>('../board/api.js');
  return { ...actual, fetchBoardTickets: vi.fn() };
});

afterEach(() => cleanup());

function ticket(overrides: Partial<BoardTicket> = {}): BoardTicket {
  return {
    id: 'PLAN-auth-setup',
    type: 'task',
    title: 'Set up auth',
    lane: 'auth-setup',
    ownerId: null,
    status: 'in_review',
    dependsOn: [],
    acceptance: [],
    manifest: {
      files: ['src/auth.ts', 'src/auth.test.ts'],
      verify: { command: 'pnpm test', exitCode: 0 },
      commits: ['abc123'],
      closeReceipt: { id: 'rcpt-1', mintedAt: 'now' } as never,
    },
    history: [],
    claimedAt: null,
    closedAt: null,
    claimable: false,
    staleBlocked: false,
    wave: 1,
    sortKey: '1',
    ...overrides,
  };
}

describe('TicketEvidence (W13-61)', () => {
  it('RED FIXTURE: the verified work is ON the card — files, verify verdict, receipt', async () => {
    vi.mocked(boardApi.fetchBoardTickets).mockResolvedValue({ ok: true, data: [ticket()] });
    render(<TicketEvidence projectId="p1" ticketId="PLAN-auth-setup" />);

    const evidence = await screen.findByTestId('evidence-PLAN-auth-setup');
    const text = evidence.textContent ?? '';
    expect(text).toContain('2 files changed');
    expect(text).toContain('pnpm test');
    expect(text).toContain('passed');
    expect(text).toContain('receipt on file');
    expect(text).toContain('src/auth.ts');
  });

  it('a failing verify is said plainly — approving red work should not read like approving green work', async () => {
    vi.mocked(boardApi.fetchBoardTickets).mockResolvedValue({
      ok: true,
      data: [
        ticket({
          manifest: {
            files: ['src/auth.ts'],
            verify: { command: 'pnpm test', exitCode: 1 },
            commits: [],
            closeReceipt: null as never,
          },
        }),
      ],
    });
    render(<TicketEvidence projectId="p1" ticketId="PLAN-auth-setup" />);

    const evidence = await screen.findByTestId('evidence-PLAN-auth-setup');
    expect(evidence.textContent).toContain('failed (exit 1)');
  });

  it('a ticket with no manifest offers no false decision surface', async () => {
    vi.mocked(boardApi.fetchBoardTickets).mockResolvedValue({
      ok: true,
      data: [ticket({ manifest: null })],
    });
    render(<TicketEvidence projectId="p1" ticketId="PLAN-auth-setup" />);

    const evidence = await screen.findByTestId('evidence-PLAN-auth-setup');
    expect(evidence.textContent).toContain('no Completion Manifest');
    expect(evidence.textContent).toContain('nothing to approve');
  });

  it('an unloadable ticket says where to look instead of shrugging', async () => {
    vi.mocked(boardApi.fetchBoardTickets).mockResolvedValue({ ok: true, data: [] });
    render(<TicketEvidence projectId="p1" ticketId="gone" />);

    const missing = await screen.findByTestId('evidence-missing-gone');
    expect(missing.textContent).toContain("open the project's board");
  });
});
