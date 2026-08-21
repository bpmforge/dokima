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

  it("RED FIXTURE (W13-59): 'Start a run' states its consequence — what a run is, what it uses, what it will not touch", () => {
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
    const hint = screen.getByTestId('board-runbar-hint');
    expect(hint.textContent).toContain('one pass of the agent working the board');
    expect(hint.textContent).toContain('Settings → Models');
    expect(hint.textContent).toContain('nothing else is contacted');
  });

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

describe('the run can be STOPPED from the board (W17-07)', () => {
  it('RED FIXTURE: while a run is in progress a working Stop control appears, states the boundary consequence, and calls the stop route', async () => {
    mockedUseBoardData.mockReturnValue(
      boardData({ tickets: [makeBoardTicket({ id: 'E2E-1' })] }),
    );
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      calls.push(String(url));
      if (String(url).endsWith('/build-runs')) {
        return new Response(JSON.stringify({ run_id: 'run-x', status: 'running' }), {
          status: 202,
        });
      }
      if (String(url).endsWith('/stop')) {
        return new Response(JSON.stringify({ status: 'stopping' }), { status: 202 });
      }
      // status poll: stays running so the Stop control stays visible.
      return new Response(
        JSON.stringify({ run_id: 'run-x', status: 'running' }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchImpl);
    try {
      render(
        <BoardView
          baseUrl="/api/v1"
          token="t"
          projectId="p1"
          wsUrl="ws://x"
          onSelectTicket={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Start a run' }));
      const stop = await screen.findByTestId('board-runbar-stop');
      expect(stop.getAttribute('title')).toContain('next ticket boundary');
      fireEvent.click(stop);
      await vi.waitFor(() =>
        expect(calls.some((u) => u.endsWith('/build-runs/run-x/stop'))).toBe(true),
      );
      expect((await screen.findByTestId('board-runbar-stop')).textContent).toContain(
        'Stopping at the next ticket',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the park is worn on the card face (W17-07)', () => {
  it('RED FIXTURE: a parked ticket shows its count and one-line reason on the face — evidence at a glance, not an archaeology dig', () => {
    const parked = makeBoardTicket({
      id: 'P-1',
      status: 'ready',
      history: [
        { verb: 'comment', body: 'Parked with evidence — ladder attempt cap (2) reached without a close.\nattempt 1/2: exitCode=1 no completion manifest returned — budget (12) exceeded' },
        { verb: 'release' },
        { verb: 'comment', body: 'Parked with evidence — ladder attempt cap (2) reached without a close.\nattempt 2/2: exitCode=1 no completion manifest returned — budget (12) exceeded' },
        { verb: 'release' },
      ] as never,
    });
    mockedUseBoardData.mockReturnValue(boardData({ tickets: [parked] }));
    render(
      <BoardView
        baseUrl="/api/v1"
        token="t"
        projectId="p1"
        wsUrl="ws://x"
        onSelectTicket={vi.fn()}
      />,
    );
    const why = screen.getByTestId('park-why-P-1');
    expect(why.textContent).toContain('Parked 2 times');
    expect(why.textContent).toContain('no completion manifest');
  });

  it('an in-progress ticket says an agent is working it, with the raw actor id as the hover detail', () => {
    const working = makeBoardTicket({
      id: 'W-1',
      status: 'in_progress',
      ownerId: 'operator',
    });
    mockedUseBoardData.mockReturnValue(boardData({ tickets: [working] }));
    render(
      <BoardView
        baseUrl="/api/v1"
        token="t"
        projectId="p1"
        wsUrl="ws://x"
        onSelectTicket={vi.fn()}
      />,
    );
    const owner = screen.getByTestId('owner-W-1');
    expect(owner.textContent).toBe('an agent is working this');
    expect(owner.getAttribute('title')).toBe('operator');
  });
});
