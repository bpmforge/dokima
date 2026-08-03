// @vitest-environment jsdom
/**
 * W10-29: CommandPalette had zero test coverage before this ticket. Two
 * bugs shipped together: (1) `fetchArtifactList`/`fetchReceipts`/
 * `fetchReceipt` were called with `{ baseUrl: "/api/v1", ... }` while
 * `artifacts/api.js` already hardcodes `/api/v1` in every urlPath, doubling
 * the prefix and 404ing; (2) the open-time `fetchArtifactList`/
 * `fetchReceipts` calls had no `.catch`, so a rejection was an unhandled
 * promise rejection and the palette silently showed no docs and no
 * receipts. These tests exercise the real `artifacts/api.js` module
 * against a stubbed `global.fetch` (asserting the actual request URL,
 * not just a mocked response) — only `board/api.js` (whose baseUrl
 * convention is the opposite: its urlPaths never carry `/api/v1`, so it
 * needs the prefix from baseUrl) and `palette/codeIndex.js` (an unrelated,
 * separately-owned route) are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommandPalette } from './CommandPalette.js';
import * as boardApi from '../board/api.js';
import * as codeIndex from './codeIndex.js';

vi.mock('../board/api.js', async () => {
  const actual =
    await vi.importActual<typeof import('../board/api.js')>('../board/api.js');
  return { ...actual, fetchBoardTickets: vi.fn() };
});
vi.mock('./codeIndex.js', () => ({ queryCodeIndex: vi.fn() }));

const mockedBoardApi = vi.mocked(boardApi);
const mockedCodeIndex = vi.mocked(codeIndex);

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const RECEIPT_WIRE = {
  id: 'rcpt-1',
  kind: 'gate',
  project_id: 'proj-1',
  phase: 3,
  ticket_id: 'W4-05',
  validators: [],
  input_tree_hash: 'hash123',
  verify_command: 'pnpm test',
  verify_exit: 0,
  signed_by: null,
  payload: {},
  created_at: '2026-01-01T00:00:00Z',
};

let fetchSpy: MockInstance<typeof fetch>;

function openPalette() {
  render(
    <CommandPalette
      baseUrl="/api/v1"
      token="tok-123"
      projectId="proj-1"
      onJumpToTicket={vi.fn()}
      onSelectMode={vi.fn()}
    />,
  );
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedBoardApi.fetchBoardTickets.mockResolvedValue({ ok: true, data: [] });
  mockedCodeIndex.queryCodeIndex.mockResolvedValue(null);
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/receipts/rcpt-1')) return jsonResponse(RECEIPT_WIRE);
    if (url.includes('/receipts')) return jsonResponse({ items: [RECEIPT_WIRE] });
    if (url.includes('/artifacts')) return jsonResponse({ items: [] });
    return jsonResponse({ items: [] });
  });
});

afterEach(() => {
  cleanup();
  fetchSpy.mockRestore();
});

describe('CommandPalette request URLs (W10-29)', () => {
  it('does not double /api/v1 fetching the doc list on open', async () => {
    openPalette();
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/v1/projects/proj-1/artifacts',
        expect.anything(),
      ),
    );
  });

  it('does not double /api/v1 fetching receipts on open', async () => {
    openPalette();
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/v1/projects/proj-1/receipts',
        expect.anything(),
      ),
    );
  });

  it('does not double /api/v1 fetching a single receipt on selection', async () => {
    openPalette();
    await screen.findByTestId('command-palette');
    fireEvent.change(screen.getByTestId('command-palette-input'), {
      target: { value: 'rcpt-1' },
    });
    const result = await screen.findByTestId('palette-result-receipt:rcpt-1');
    fireEvent.click(result.querySelector('button')!);
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/v1/receipts/rcpt-1?project=proj-1',
        expect.anything(),
      ),
    );
  });
});

describe('CommandPalette silent-failure fix (W10-29)', () => {
  it('does not leave an unhandled promise rejection when the doc/receipt fetch fails on open', async () => {
    fetchSpy.mockImplementation(() => Promise.reject(new Error('network down')));
    const onUnhandledRejection = vi.fn();
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      openPalette();
      await screen.findByTestId('command-palette');
      // Flush the microtask queue so a rejected-and-uncaught promise from
      // the open effect has a chance to surface as unhandledRejection.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(onUnhandledRejection).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });
});
