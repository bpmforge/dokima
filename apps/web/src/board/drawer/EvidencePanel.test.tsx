// @vitest-environment jsdom
/**
 * W9-02: the receipts pane must never freeze on "Loading receipts…".
 * Root cause (verified): `fetchReceipts(...).then(setReceipts)` had no
 * `.catch` — a rejected fetch (network error, non-2xx response) left
 * `receipts` stuck at its initial `null` forever with an unhandled
 * promise rejection, so the loading string never resolved. The
 * zero-receipts ternary itself (`receipts.length === 0` -> "No gates
 * have run yet.") was already correct once the promise actually
 * resolves — covered here too, so a regression on either path fails.
 *
 * W10-29: these tests exercise the real `artifacts/api.js` module against
 * a stubbed `global.fetch` rather than mocking `fetchReceipts` itself, so
 * the actual request URL is asserted — the doubled-`/api/v1` prefix bug
 * shipped broken with every consumer test mocking the whole api module
 * away and none of them ever looking at the URL that was built.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EvidencePanel } from './EvidencePanel.js';
import type { ContractTicket } from './types.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const TICKET: ContractTicket = {
  id: 'E2E-1',
  type: 'task',
  title: 'Wire the board',
  lane: 'ui',
  ownerId: null,
  status: 'ready',
  dependsOn: [],
  acceptance: [],
  manifest: null,
  history: [],
  claimedAt: null,
  closedAt: null,
  claimable: true,
  staleBlocked: false,
  wave: 1,
  sortKey: '1',
};

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  cleanup();
  fetchSpy.mockRestore();
});

describe('EvidencePanel receipts loading state', () => {
  it('shows an honest empty state for a ticket with zero receipts, never a perpetual loading string', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ items: [] }));
    render(
      <EvidencePanel baseUrl="/api/v1" token="tok" projectId="proj-1" ticket={TICKET} />,
    );

    expect(screen.getByText('Loading receipts…')).toBeTruthy();
    await screen.findByText('No gates have run yet.');
    expect(screen.queryByText('Loading receipts…')).toBeNull();
  });

  it('surfaces a fetch failure instead of freezing on "Loading receipts…" forever', async () => {
    // Worst case: a 500 with no `detail` in the body — the client's
    // ArtifactApiError still guarantees a non-empty message
    // ("Artifact API request failed with status 500"), so the alert is
    // never a blank tag.
    fetchSpy.mockResolvedValue(jsonResponse({}, 500));
    render(
      <EvidencePanel baseUrl="/api/v1" token="tok" projectId="proj-1" ticket={TICKET} />,
    );

    expect(screen.getByText('Loading receipts…')).toBeTruthy();
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toBe(
      'Artifact API request failed with status 500',
    );
    expect(screen.queryByText('Loading receipts…')).toBeNull();
  });
});

describe('EvidencePanel receipts request URL (W10-29)', () => {
  it("does not double /api/v1 when baseUrl already carries it, matching App.tsx's real prop value", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ items: [] }));
    render(
      <EvidencePanel baseUrl="/api/v1" token="tok" projectId="proj-1" ticket={TICKET} />,
    );

    await screen.findByText('No gates have run yet.');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/v1/projects/proj-1/receipts?ticket=E2E-1',
      expect.anything(),
    );
  });
});
