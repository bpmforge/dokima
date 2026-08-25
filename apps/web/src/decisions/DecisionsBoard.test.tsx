// @vitest-environment jsdom
/**
 * Slate-card rendering + choose flow (this ticket's acceptance): founder
 * 2-4 option cards with trade-offs/recommended default, the technical 3x6
 * grid, and that choosing an option calls the W5-13 decide route and
 * reflects the recorded decision in place. Mocks `./api.js` so components
 * are exercised without a real server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as api from './api.js';
import { DecisionsBoard } from './DecisionsBoard.js';
import type { SlateRecord } from './types.js';

vi.mock('./api.js', () => ({
  fetchSlates: vi.fn(),
  decideSlate: vi.fn(),
}));

const mockedApi = vi.mocked(api);

const FOUNDER_RECORD: SlateRecord = {
  id: 'slate-founder',
  status: 'open',
  slate: {
    kind: 'founder',
    title: 'Product name',
    options: [
      { id: 'opt-a', label: 'Dokima', tradeoffs: 'Nautical theme, memorable.' },
      { id: 'opt-b', label: 'Buildbot', tradeoffs: 'Generic, unmemorable.' },
    ],
    recommendedId: 'opt-a',
    recommendedReasoning: 'Distinct in the crowded dev-tools space.',
  },
  chosen: null,
  rationale: null,
  d_id: null,
  decided_by: null,
  decided_at: null,
  created_at: '2026-07-19T00:00:00Z',
};

const TECHNICAL_RECORD: SlateRecord = {
  id: 'slate-technical',
  status: 'open',
  slate: {
    kind: 'technical',
    title: 'Auth session storage',
    options: [
      {
        label: 'Minimal',
        summary: 'In-memory sessions.',
        dimensions: {
          time: 'fast',
          maintainability: 'low',
          scalability: 'low',
          'team-fit': 'ok',
          risk: 'high',
          reversibility: 'easy',
        },
      },
      {
        label: 'Clean',
        summary: 'Redis-backed sessions.',
        dimensions: {
          time: 'medium',
          maintainability: 'high',
          scalability: 'high',
          'team-fit': 'good',
          risk: 'low',
          reversibility: 'medium',
        },
      },
      {
        label: 'Pragmatic',
        summary: 'SQLite-backed sessions.',
        dimensions: {
          time: 'medium',
          maintainability: 'medium',
          scalability: 'medium',
          'team-fit': 'good',
          risk: 'medium',
          reversibility: 'easy',
        },
      },
    ],
    recommendedLabel: 'Pragmatic',
    recommendedConstraint: 'No Redis in the local-first deployment (C-1).',
  },
  chosen: null,
  rationale: null,
  d_id: null,
  decided_by: null,
  decided_at: null,
  created_at: '2026-07-19T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('DecisionsBoard empty state', () => {
  it('says nothing needs deciding, and what would put something here (W21-05)', async () => {
    mockedApi.fetchSlates.mockResolvedValue([]);
    render(<DecisionsBoard projectId="proj-1" token="tok-1" />);
    await screen.findByRole('status');
    expect(screen.getByRole('status').textContent).toContain('Nothing needs deciding');
    // An empty page must still say what fills it — otherwise it reads as a
    // failed load rather than an honest empty state.
    const panel = screen.getByTestId('decisions-empty');
    expect(panel.textContent).toContain('fork');
    expect(panel.className).toContain('empty-state');
    // …and it must sit on something, not float on the page background.
    expect(panel.className).toContain('surface');
  });

  it('the page names itself, so an empty view is still recognisably Decisions', async () => {
    mockedApi.fetchSlates.mockResolvedValue([]);
    render(<DecisionsBoard projectId="proj-1" token="tok-1" />);
    await screen.findByRole('status');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Decisions');
  });
});

describe('DecisionsBoard founder slate', () => {
  it('renders 2-4 options with trade-offs and marks the recommended default', async () => {
    mockedApi.fetchSlates.mockResolvedValue([FOUNDER_RECORD]);
    render(<DecisionsBoard projectId="proj-1" token="tok-1" />);

    await screen.findByText('Product name');
    expect(screen.getByText('Nautical theme, memorable.')).toBeTruthy();
    expect(screen.getByText('Generic, unmemorable.')).toBeTruthy();
    expect(screen.getByText('Recommended')).toBeTruthy();
  });

  it('choosing an option calls the decide route and reflects the recorded decision', async () => {
    mockedApi.fetchSlates.mockResolvedValue([FOUNDER_RECORD]);
    mockedApi.decideSlate.mockResolvedValue({
      id: 'slate-founder',
      d_id: 'D-021',
      date: '2026-07-19',
      decision: 'Product name: Dokima',
      options_considered: 'Dokima, Buildbot',
      rationale: 'Distinct branding.',
    });
    render(<DecisionsBoard projectId="proj-1" token="tok-1" />);
    await screen.findByText('Product name');

    fireEvent.click(screen.getByRole('radio', { name: /Dokima/ }));
    fireEvent.change(screen.getByLabelText('Rationale for Product name'), {
      target: { value: 'Distinct branding.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));

    await waitFor(() => expect(mockedApi.decideSlate).toHaveBeenCalledTimes(1));
    expect(mockedApi.decideSlate).toHaveBeenCalledWith(
      'proj-1',
      'slate-founder',
      { chosen: 'opt-a', rationale: 'Distinct branding.' },
      expect.anything(),
    );

    await waitFor(() => expect(screen.getByText(/Decided/)).toBeTruthy());
    expect(screen.getByText('D-021', { exact: false })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Choose' })).toBeNull();
  });

  it('shows an error and stays in the open form when deciding fails', async () => {
    mockedApi.fetchSlates.mockResolvedValue([FOUNDER_RECORD]);
    mockedApi.decideSlate.mockRejectedValue(new Error('slate already decided'));
    render(<DecisionsBoard projectId="proj-1" token="tok-1" />);
    await screen.findByText('Product name');

    fireEvent.click(screen.getByRole('radio', { name: /Dokima/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('slate already decided');
    expect(screen.getByRole('button', { name: 'Choose' })).toBeTruthy();
  });
});

describe('DecisionsBoard technical slate', () => {
  it('renders the 3-option x 6-dimension comparison grid', async () => {
    mockedApi.fetchSlates.mockResolvedValue([TECHNICAL_RECORD]);
    render(<DecisionsBoard projectId="proj-1" token="tok-1" />);

    await screen.findByText('Auth session storage');
    for (const label of ['Minimal', 'Clean', 'Pragmatic']) {
      expect(screen.getByRole('radio', { name: new RegExp(label) })).toBeTruthy();
    }
    for (const dimension of [
      'time',
      'maintainability',
      'scalability',
      'team-fit',
      'risk',
      'reversibility',
    ]) {
      expect(screen.getByText(dimension)).toBeTruthy();
    }
    expect(screen.getByText(/No Redis in the local-first deployment/)).toBeTruthy();
  });

  it('choosing a column posts the option label as the chosen value', async () => {
    mockedApi.fetchSlates.mockResolvedValue([TECHNICAL_RECORD]);
    mockedApi.decideSlate.mockResolvedValue({
      id: 'slate-technical',
      d_id: 'D-022',
      date: '2026-07-19',
      decision: 'Auth session storage: Pragmatic',
      options_considered: 'Minimal, Clean, Pragmatic',
      rationale: '',
    });
    render(<DecisionsBoard projectId="proj-1" token="tok-1" />);
    await screen.findByText('Auth session storage');

    fireEvent.click(screen.getByRole('radio', { name: /Pragmatic/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));

    await waitFor(() => expect(mockedApi.decideSlate).toHaveBeenCalledTimes(1));
    expect(mockedApi.decideSlate).toHaveBeenCalledWith(
      'proj-1',
      'slate-technical',
      { chosen: 'Pragmatic', rationale: undefined },
      expect.anything(),
    );
  });
});
