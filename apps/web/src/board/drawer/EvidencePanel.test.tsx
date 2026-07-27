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
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EvidencePanel } from './EvidencePanel.js';
import * as artifactsApi from '../../artifacts/api.js';
import { ArtifactApiError } from '../../artifacts/api.js';
import type { ContractTicket } from './types.js';

vi.mock('../../artifacts/api.js', async () => {
  const actual = await vi.importActual<typeof import('../../artifacts/api.js')>(
    '../../artifacts/api.js',
  );
  return { ...actual, fetchReceipts: vi.fn() };
});

const mockedApi = vi.mocked(artifactsApi);

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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('EvidencePanel receipts loading state', () => {
  it('shows an honest empty state for a ticket with zero receipts, never a perpetual loading string', async () => {
    mockedApi.fetchReceipts.mockResolvedValue([]);
    render(
      <EvidencePanel baseUrl="http://x" token="tok" projectId="proj-1" ticket={TICKET} />,
    );

    expect(screen.getByText('Loading receipts…')).toBeTruthy();
    await screen.findByText('No gates have run yet.');
    expect(screen.queryByText('Loading receipts…')).toBeNull();
  });

  it('surfaces a fetch failure instead of freezing on "Loading receipts…" forever', async () => {
    // Worst case: a real ArtifactApiError with no `detail` from the server —
    // its constructor still guarantees a non-empty message
    // ("Artifact API request failed with status 500"), so the alert is
    // never a blank tag.
    mockedApi.fetchReceipts.mockRejectedValue(new ArtifactApiError(500));
    render(
      <EvidencePanel baseUrl="http://x" token="tok" projectId="proj-1" ticket={TICKET} />,
    );

    expect(screen.getByText('Loading receipts…')).toBeTruthy();
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toBe(
      'Artifact API request failed with status 500',
    );
    expect(screen.queryByText('Loading receipts…')).toBeNull();
  });
});
