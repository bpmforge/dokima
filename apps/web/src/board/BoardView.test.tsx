// @vitest-environment jsdom
/**
 * W10-33: two board controls that render as real, clickable buttons but
 * silently do nothing — the shipped-ticker pill (no onSelectTicket wired)
 * and the empty-state "Describe your product" action (no onViewCurrentPhase
 * wired at the call site). A rendered <button> with no callback passes
 * every test that only checks it exists, so these assert the click
 * actually reaches the handler.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BoardView } from './BoardView.js';
import { makeBoardTicket } from './test-helpers.js';
import { useBoardData } from './useBoardData.js';
import type { UseBoardDataResult } from './useBoardData.js';

vi.mock('./useBoardData.js', () => ({
  useBoardData: vi.fn(),
}));

const mockedUseBoardData = vi.mocked(useBoardData);

function boardData(overrides: Partial<UseBoardDataResult> = {}): UseBoardDataResult {
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BoardView shipped-ticker pill (UX_SPEC §4 "linked to their tickets")', () => {
  it('invokes onSelectTicket with the ticket id when a shipped commit pill is clicked', () => {
    const closedAt = new Date().toISOString();
    const shipped = makeBoardTicket({
      id: 'W4-01',
      status: 'done',
      closedAt,
      manifest: {
        files: ['x.ts'],
        verify: { command: 'pnpm test', exitCode: 0 },
        commits: ['a1b2c3d'],
        closeReceipt: {
          ticketId: 'W4-01',
          ownerId: 'agent-1',
          verify: { command: 'pnpm test', exitCode: 0 },
          commits: ['a1b2c3d'],
          files: ['x.ts'],
          mintedAt: closedAt,
        },
      },
    });
    mockedUseBoardData.mockReturnValue(boardData({ tickets: [shipped] }));
    const onSelectTicket = vi.fn();

    render(
      <BoardView
        baseUrl="/api/v1"
        token="t"
        projectId="p1"
        wsUrl="ws://x"
        onSelectTicket={onSelectTicket}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /a1b2c3d/ }));
    expect(onSelectTicket).toHaveBeenCalledWith('W4-01');
  });
});

describe('BoardView empty state "Describe your product" action (UX_SPEC §2b)', () => {
  it('invokes onViewCurrentPhase when clicked', () => {
    mockedUseBoardData.mockReturnValue(boardData({ tickets: [] }));
    const onViewCurrentPhase = vi.fn();

    render(
      <BoardView
        baseUrl="/api/v1"
        token="t"
        projectId="p1"
        wsUrl="ws://x"
        onSelectTicket={vi.fn()}
        onViewCurrentPhase={onViewCurrentPhase}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Describe your product' }));
    expect(onViewCurrentPhase).toHaveBeenCalledTimes(1);
  });

  it('renders no action when onViewCurrentPhase is not supplied (never a silent no-op button)', () => {
    mockedUseBoardData.mockReturnValue(boardData({ tickets: [] }));

    render(
      <BoardView
        baseUrl="/api/v1"
        token="t"
        projectId="p1"
        wsUrl="ws://x"
        onSelectTicket={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Describe your product' })).toBeNull();
  });
});

describe('BoardView start-run affordance (W12-28)', () => {
  it(
    'RED FIXTURE: the board offers a way to START the work. Every configuration ' +
      'surface was a GUI and the one action that mattered was a terminal command; ' +
      'W12-20 built the route and nothing called it',
    () => {
      mockedUseBoardData.mockReturnValue(boardData({ tickets: [makeBoardTicket({ id: 'E2E-1' })] }));
      render(
        <BoardView
          baseUrl="/api/v1"
          token="t"
          projectId="p1"
          wsUrl="ws://x"
          onSelectTicket={vi.fn()}
        />,
      );
      expect(screen.getByTestId('board-runbar')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Start a run' })).toBeTruthy();
    },
  );

  it('starts from where the work is visible — the runbar sits inside the board, not in Settings', () => {
    mockedUseBoardData.mockReturnValue(boardData({ tickets: [makeBoardTicket({ id: 'E2E-1' })] }));
    render(
      <BoardView
        baseUrl="/api/v1"
        token="t"
        projectId="p1"
        wsUrl="ws://x"
        onSelectTicket={vi.fn()}
      />,
    );
    const board = screen.getByTestId('board-view');
    expect(board.contains(screen.getByTestId('board-runbar'))).toBe(true);
  });
});
