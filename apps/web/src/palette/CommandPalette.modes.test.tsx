// @vitest-environment jsdom
/**
 * The palette on every screen: with no project open it is a navigator
 * (screens + Fleet projects) that says search needs a project; with one open
 * it keeps ticket/doc/receipt search and adds navigation. It also opens
 * without a keyboard, through the header's Search button event.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommandPalette } from './CommandPalette.js';
import { requestOpenPalette } from './openPalette.js';
import * as boardApi from '../board/api.js';
import * as codeIndex from './codeIndex.js';
import { makeBoardTicket } from '../board/test-helpers.js';

vi.mock('../board/api.js', async () => {
  const actual =
    await vi.importActual<typeof import('../board/api.js')>('../board/api.js');
  return { ...actual, fetchBoardTickets: vi.fn() };
});
vi.mock('./codeIndex.js', () => ({ queryCodeIndex: vi.fn() }));

const mockedBoardApi = vi.mocked(boardApi);
const mockedCodeIndex = vi.mocked(codeIndex);

function json(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response;
}

const PROJECT_WIRE = (id: string, name: string, available = true) => ({
  id,
  path: `/p/${id}`,
  name,
  archived: false,
  available,
  created_at: '2026-01-01T00:00:00Z',
  last_opened_at: '2026-01-01T00:00:00Z',
  phase: null,
  board: { ready: 0, blocked: 0, done: 0 },
  berths_running: 0,
  heartbeat_age_ms: null,
  pending_decide_count: 0,
  spend_today: 0,
});

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  vi.clearAllMocks();
  mockedBoardApi.fetchBoardTickets.mockResolvedValue({
    ok: true,
    data: [makeBoardTicket({ id: 'W1-01', title: 'Login form' })],
  });
  mockedCodeIndex.queryCodeIndex.mockResolvedValue(null);
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/api/v1/projects')) {
      return json({
        projects: [
          PROJECT_WIRE('p-alpha', 'Alpha'),
          PROJECT_WIRE('p-beta', 'Beta'),
          PROJECT_WIRE('p-gone', 'Gone', false),
        ],
      });
    }
    return json({ items: [] });
  });
});

afterEach(() => {
  cleanup();
  fetchSpy.mockRestore();
});

function renderPalette(projectId: string | null) {
  const props = {
    onJumpToTicket: vi.fn(),
    onSelectMode: vi.fn(),
    onNavigate: vi.fn(),
  };
  render(
    <CommandPalette baseUrl="/api/v1" token="tok" projectId={projectId} {...props} />,
  );
  return props;
}

function openWithKeys() {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
}

describe('CommandPalette with no project open (Fleet, Settings, Roster…)', () => {
  it('opens with Ctrl+K and says ticket/doc search needs a project', async () => {
    renderPalette(null);
    openWithKeys();
    expect(await screen.findByTestId('palette-no-project-hint')).toBeTruthy();
    expect(screen.getByRole('combobox').getAttribute('aria-label')).toBe(
      'Search projects and screens, or pick a mode',
    );
    expect(mockedBoardApi.fetchBoardTickets).not.toHaveBeenCalled();
  });

  it('lists screens and available Fleet projects, but no project-scoped screens', async () => {
    renderPalette(null);
    openWithKeys();
    await screen.findByTestId('palette-result-nav:project:p-alpha');
    expect(screen.getByTestId('palette-result-nav:settings')).toBeTruthy();
    expect(screen.getByTestId('palette-result-nav:notifications')).toBeTruthy();
    expect(screen.getByTestId('palette-result-nav:roster')).toBeTruthy();
    expect(screen.queryByTestId('palette-result-nav:board')).toBeNull();
    expect(screen.queryByTestId('palette-result-nav:plans')).toBeNull();
    expect(screen.queryByTestId('palette-result-nav:project:p-gone')).toBeNull();
  });

  it('opens a project from the list and closes', async () => {
    const props = renderPalette(null);
    openWithKeys();
    fireEvent.change(screen.getByTestId('command-palette-input'), {
      target: { value: 'beta' },
    });
    const row = await screen.findByTestId('palette-result-nav:project:p-beta');
    fireEvent.click(row.querySelector('button')!);
    expect(props.onNavigate).toHaveBeenCalledWith({
      kind: 'project',
      projectId: 'p-beta',
    });
    expect(screen.queryByTestId('command-palette')).toBeNull();
  });

  it('Enter on the top match navigates', async () => {
    const props = renderPalette(null);
    openWithKeys();
    const input = screen.getByTestId('command-palette-input');
    fireEvent.change(input, { target: { value: 'settings' } });
    await screen.findByTestId('palette-result-nav:settings');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onNavigate).toHaveBeenCalledWith({ kind: 'view', view: 'settings' });
  });
});

describe('CommandPalette with a project open', () => {
  it('keeps ticket search and adds navigation entries after it', async () => {
    const props = renderPalette('p-alpha');
    openWithKeys();
    expect(screen.queryByTestId('palette-no-project-hint')).toBeNull();
    fireEvent.change(screen.getByTestId('command-palette-input'), {
      target: { value: 'o' },
    });
    const ticket = await screen.findByTestId('palette-result-ticket:W1-01');
    const options = screen
      .getAllByRole('option')
      .map((o) => o.getAttribute('data-testid'));
    expect(options[0]).toBe('palette-result-ticket:W1-01');
    expect(options).toContain('palette-result-nav:board');
    // The open project is not offered as a place to go.
    expect(options).not.toContain('palette-result-nav:project:p-alpha');
    fireEvent.click(ticket.querySelector('button')!);
    expect(props.onJumpToTicket).toHaveBeenCalledWith('W1-01');
  });
});

describe('opening without a keyboard', () => {
  it('opens on the header Search button event', async () => {
    renderPalette(null);
    expect(screen.queryByTestId('command-palette')).toBeNull();
    act(() => requestOpenPalette());
    await waitFor(() => expect(screen.getByTestId('command-palette')).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByTestId('command-palette-input'));
  });
});
