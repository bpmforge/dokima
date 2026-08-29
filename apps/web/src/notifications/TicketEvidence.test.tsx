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
import type { BoardTicket, TicketHistoryEntry } from '../board/types.js';
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

/**
 * W22-13. W21-90 made the close RECORD that it reversed a rejection nobody
 * addressed; recording it on the ticket is not showing it to the person about
 * to accept. These pin the other half: the fact reaches the Decide card,
 * before the accept control, in the reviewer's own words — and it goes away
 * when the rejection was actually addressed.
 */
const NOTICE =
  'THIS CLOSE REVERSES A REJECTION THAT WAS NOT ADDRESSED. The reviewer asked ' +
  'for .gitignore, and this close changes none of them. The rejection said: ' +
  '"the .gitignore entry is still missing". The gate did not block on this — ' +
  'only the gate decides done (C-2) — but accepting now overrules that ' +
  'rejection, so read it before you do.';

function entry(
  verb: TicketHistoryEntry['verb'],
  body?: string,
  at = '2026-08-29T00:00:00.000Z',
): TicketHistoryEntry {
  return body === undefined ? { verb, actorId: 'a', at } : { verb, actorId: 'a', at, body };
}

describe('TicketEvidence — a close that reversed a rejection (W22-13)', () => {
  it('RED FIXTURE: the reversal is on the card, in the reviewer own words, with the files they named', async () => {
    vi.mocked(boardApi.fetchBoardTickets).mockResolvedValue({
      ok: true,
      data: [ticket({ history: [entry('reject'), entry('close'), entry('comment', NOTICE)] })],
    });
    render(<TicketEvidence projectId="p1" ticketId="PLAN-auth-setup" />);

    const warning = await screen.findByTestId('reversal-PLAN-auth-setup');
    const text = warning.textContent ?? '';
    // A2: the reviewer's words, and the file they named.
    expect(text).toContain('the .gitignore entry is still missing');
    expect(text).toContain('.gitignore');
  });

  it('A1: it renders before the accept control — inside the evidence, which the card puts above the buttons', async () => {
    vi.mocked(boardApi.fetchBoardTickets).mockResolvedValue({
      ok: true,
      data: [ticket({ history: [entry('reject'), entry('close'), entry('comment', NOTICE)] })],
    });
    render(<TicketEvidence projectId="p1" ticketId="PLAN-auth-setup" />);

    const evidence = await screen.findByTestId('evidence-PLAN-auth-setup');
    const warning = screen.getByTestId('reversal-PLAN-auth-setup');
    expect(evidence.contains(warning)).toBe(true);
    // C-2, and W21-90's own note: the notice exists so a person overruling
    // their own rejection sees that they are doing it — not so the card can
    // refuse. This component offers no control of its own to disable.
    expect(evidence.querySelectorAll('button')).toHaveLength(0);
    // It comes before the manifest, so it is read first rather than found
    // underneath the file list.
    expect(warning.compareDocumentPosition(evidence.querySelector('ul')!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('A3: a close that addressed the rejection shows nothing extra', async () => {
    vi.mocked(boardApi.fetchBoardTickets).mockResolvedValue({
      ok: true,
      data: [ticket({ history: [entry('reject'), entry('close')] })],
    });
    render(<TicketEvidence projectId="p1" ticketId="PLAN-auth-setup" />);

    await screen.findByTestId('evidence-PLAN-auth-setup');
    expect(screen.queryByTestId('reversal-PLAN-auth-setup')).toBeNull();
  });

  it('A3, the round-two case: a notice answered by a later rejection is history, not a live warning', async () => {
    // reject -> close (unaddressed, notice) -> reject again -> close that DID
    // touch the file. No new notice is written, and the old one must not be
    // dredged up: searching the whole history would warn about a complaint
    // that was answered two closes ago.
    vi.mocked(boardApi.fetchBoardTickets).mockResolvedValue({
      ok: true,
      data: [
        ticket({
          history: [
            entry('reject'),
            entry('close'),
            entry('comment', NOTICE),
            entry('reject'),
            entry('close'),
          ],
        }),
      ],
    });
    render(<TicketEvidence projectId="p1" ticketId="PLAN-auth-setup" />);

    await screen.findByTestId('evidence-PLAN-auth-setup');
    expect(screen.queryByTestId('reversal-PLAN-auth-setup')).toBeNull();
  });

  it('an ordinary comment is not a reversal — the marker is the signal, not the verb', async () => {
    vi.mocked(boardApi.fetchBoardTickets).mockResolvedValue({
      ok: true,
      data: [
        ticket({
          history: [entry('reject'), entry('close'), entry('comment', 'looks fine to me now')],
        }),
      ],
    });
    render(<TicketEvidence projectId="p1" ticketId="PLAN-auth-setup" />);

    await screen.findByTestId('evidence-PLAN-auth-setup');
    expect(screen.queryByTestId('reversal-PLAN-auth-setup')).toBeNull();
  });
});
