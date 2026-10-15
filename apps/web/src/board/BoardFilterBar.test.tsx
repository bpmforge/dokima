// @vitest-environment jsdom
/**
 * The board's status filter, mounted in the real BoardView: chips above the
 * lanes (aria-pressed), counts per status, cards filtered across lanes with
 * the column structure kept, the choice remembered per project and mirrored
 * into `?filter=`, and `?filter=blocked` (the Fleet card's link) honoured.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { BoardView } from './BoardView.js';
import { boardFilterStorageKey } from './boardFilter.js';
import { makeBoardTicket } from './test-helpers.js';
import { useBoardData } from './useBoardData.js';
import type { UseBoardDataResult } from './useBoardData.js';

vi.mock('./useBoardData.js', () => ({ useBoardData: vi.fn() }));
const mockedUseBoardData = vi.mocked(useBoardData);

const tickets = [
  makeBoardTicket({ id: 'R-1', status: 'ready', lane: 'api' }),
  makeBoardTicket({ id: 'B-1', status: 'blocked', lane: 'api', claimable: false }),
  makeBoardTicket({ id: 'D-1', status: 'done', lane: 'docs' }),
];

function data(): UseBoardDataResult {
  return {
    tickets,
    heartbeats: new Map(),
    loading: false,
    loadError: null,
    retryLoad: vi.fn(),
    refusal: null,
    dismissRefusal: vi.fn(),
    fireVerb: vi.fn(),
    handleDrop: vi.fn(),
    announcement: '',
  };
}

function renderBoard(projectId = 'p1') {
  return render(
    <BoardView
      baseUrl="/api/v1"
      token="t"
      projectId={projectId}
      wsUrl="ws://x"
      onSelectTicket={vi.fn()}
    />,
  );
}

const lanesEl = () => document.querySelector('.board-view__lanes') as HTMLElement;

beforeEach(() => {
  mockedUseBoardData.mockReturnValue(data());
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
  );
  window.localStorage.clear();
  window.history.replaceState({}, '', '/?project=p1');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('board status filter', () => {
  it('shows chips with counts, "Show all" pressed by default and every card visible', () => {
    renderBoard();
    const bar = screen.getByTestId('board-filter');
    expect(within(bar).getByTestId('board-filter-all').getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(within(bar).getByTestId('board-filter-blocked').textContent).toBe('Blocked 1');
    expect(within(bar).getByTestId('board-filter-all').textContent).toBe('Show all 3');
    expect(within(lanesEl()).getByText('Ticket R-1')).toBeTruthy();
    expect(within(lanesEl()).getByText('Ticket D-1')).toBeTruthy();
  });

  it('filters cards across lanes, keeps columns, drops lanes with nothing to show', () => {
    renderBoard();
    fireEvent.click(screen.getByTestId('board-filter-blocked'));
    expect(screen.getByTestId('board-filter-blocked').getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(within(lanesEl()).queryByText('Ticket R-1')).toBeNull();
    expect(within(lanesEl()).getByText('Ticket B-1')).toBeTruthy();
    expect(screen.queryByTestId('lane-docs')).toBeNull();
    // The Ready column is still there, just empty.
    expect(
      within(screen.getByTestId('lane-api')).getByTestId('column-ready'),
    ).toBeTruthy();
  });

  it('remembers the choice per project and mirrors it into the URL; pressing again clears it', () => {
    renderBoard();
    fireEvent.click(screen.getByTestId('board-filter-done'));
    expect(window.localStorage.getItem(boardFilterStorageKey('p1'))).toBe('done');
    expect(new URLSearchParams(window.location.search).get('filter')).toBe('done');
    fireEvent.click(screen.getByTestId('board-filter-done'));
    expect(window.localStorage.getItem(boardFilterStorageKey('p1'))).toBeNull();
    expect(new URLSearchParams(window.location.search).get('filter')).toBeNull();
  });

  it('restores the remembered filter for that project only', () => {
    window.localStorage.setItem(boardFilterStorageKey('p1'), 'done');
    renderBoard('p1');
    expect(screen.getByTestId('board-filter-done').getAttribute('aria-pressed')).toBe(
      'true',
    );
    cleanup();
    renderBoard('p2');
    expect(screen.getByTestId('board-filter-all').getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('opens pre-filtered from ?filter=blocked (the Fleet card link)', () => {
    window.history.replaceState({}, '', '/?project=p1&filter=blocked');
    renderBoard();
    expect(screen.getByTestId('board-filter-blocked').getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(within(lanesEl()).queryByText('Ticket D-1')).toBeNull();
  });

  it('says so when nothing matches, with a way back', () => {
    renderBoard();
    fireEvent.click(screen.getByTestId('board-filter-in_review'));
    const empty = screen.getByTestId('board-filter-empty');
    fireEvent.click(within(empty).getByRole('button', { name: 'Show all' }));
    expect(screen.getByTestId('board-filter-all').getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});
