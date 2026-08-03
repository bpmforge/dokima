// @vitest-environment jsdom
/**
 * W10-33 red fixtures: a rendered `<button>` with no wired callback passes
 * every test that only checks it exists — these assert the board's
 * controls actually invoke their handlers.
 *
 * - DEAD CONTROL 1: the shipped-ticker pill (`ShippedTickerStrip.tsx`)
 *   rendered as a real, focusable `<button>` next to the claim-now pill,
 *   but `BoardView` never passed it an `onSelectTicket` — clicking it did
 *   nothing (UX_SPEC.md:102: "linked to their tickets").
 * - WITHHELD ACTION 2: the board-empty state's "View current phase" button
 *   (`BoardEmptyState.tsx` / `emptyState.ts`) only renders when
 *   `onViewCurrentPhase` is supplied — this guards `BoardView` actually
 *   forwards it (the App.tsx call site is covered by `onViewCurrentPhase`
 *   now being a required prop, enforced at typecheck).
 *
 * Mocks `./useBoardData.js` so the component renders from canned data
 * instead of a real fetch/WebSocket round trip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BoardView } from './BoardView.js';
import { makeBoardTicket } from './test-helpers.js';
import * as useBoardDataModule from './useBoardData.js';
import type { UseBoardDataResult } from './useBoardData.js';

vi.mock('./useBoardData.js', () => ({
  useBoardData: vi.fn(),
}));

const mockedUseBoardData = vi.mocked(useBoardDataModule.useBoardData);

function baseResult(overrides: Partial<UseBoardDataResult> = {}): UseBoardDataResult {
  return {
    tickets: [],
    heartbeats: new Map(),
    loading: false,
    refusal: null,
    dismissRefusal: vi.fn(),
    fireVerb: vi.fn(),
    handleDrop: vi.fn(),
    ...overrides,
  };
}

function doneTicketWithCommit(id: string, sha: string) {
  const closedAt = new Date().toISOString();
  return makeBoardTicket({
    id,
    status: 'done',
    claimable: false,
    closedAt,
    manifest: {
      files: ['x.ts'],
      verify: { command: 'pnpm test', exitCode: 0 },
      commits: [sha],
      closeReceipt: {
        ticketId: id,
        ownerId: 'agent-1',
        verify: { command: 'pnpm test', exitCode: 0 },
        commits: [sha],
        files: ['x.ts'],
        mintedAt: closedAt,
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('BoardView (W10-33)', () => {
  it('clicking a shipped-ticker pill invokes onSelectTicket with the ticket id', () => {
    mockedUseBoardData.mockReturnValue(
      baseResult({ tickets: [doneTicketWithCommit('W4-01', 'a1b2c3d')] }),
    );
    const onSelectTicket = vi.fn();

    render(
      <BoardView
        baseUrl=""
        token=""
        projectId="p1"
        wsUrl=""
        onSelectTicket={onSelectTicket}
        onViewCurrentPhase={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /a1b2c3d/ }));

    expect(onSelectTicket).toHaveBeenCalledWith('W4-01');
  });

  it('clicking "View current phase" in the board-empty state invokes onViewCurrentPhase', () => {
    mockedUseBoardData.mockReturnValue(baseResult({ tickets: [] }));
    const onViewCurrentPhase = vi.fn();

    render(
      <BoardView
        baseUrl=""
        token=""
        projectId="p1"
        wsUrl=""
        onSelectTicket={vi.fn()}
        onViewCurrentPhase={onViewCurrentPhase}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'View current phase' }));

    expect(onViewCurrentPhase).toHaveBeenCalledTimes(1);
  });
});
