// @vitest-environment jsdom
/**
 * Guided-sample run flow (BLUEPRINT §12.3, UX_SPEC §8): interview playback
 * -> real pipeline run -> board/receipts summary -> morning queue, and the
 * honest-degrade paths for the two known-missing-wiring cases (404 route
 * not mounted, 422 decision-incomplete). Mocks `./api.js` and
 * `../notifications/api.js` so the component is exercised without a real
 * server, same pattern as `../decisions/DecisionsBoard.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as onboardingApi from './api.js';
import { GuidedSample } from './GuidedSample.js';
import { SAMPLE_INTERVIEW_BEATS } from './sample-data.js';
import type { GateReceipt, PipelineRunResult } from './types.js';

vi.mock('./api.js', async () => {
  const actual = await vi.importActual<typeof import('./api.js')>('./api.js');
  return {
    ...actual,
    runGuidedPipeline: vi.fn(),
    fetchGateReceipts: vi.fn(),
  };
});

vi.mock('../notifications/api.js', () => ({
  fetchMorningQueue: vi.fn().mockResolvedValue([]),
  decideApproval: vi.fn(),
}));

const mockedApi = vi.mocked(onboardingApi);

const RUN_RESULT: PipelineRunResult = {
  run_id: 'run-1',
  plan: { tickets: [{ id: 'T-1' }, { id: 'T-2' }], violations: [], mermaid: 'graph TD' },
  plan_items: [
    {
      id: 'PLAN-1',
      catalog_id: 'CAT-1',
      state: 'accepted',
      ticket_id: 'T-1',
      ticket_created: true,
    },
    {
      id: 'PLAN-2',
      catalog_id: 'CAT-2',
      state: 'accepted',
      ticket_id: 'T-2',
      ticket_created: true,
    },
  ],
};

const RECEIPTS: GateReceipt[] = [
  {
    id: 'receipt-1',
    kind: 'gate',
    project_id: 'proj-1',
    phase: 2,
    ticket_id: null,
    validators: [],
    input_tree_hash: 'abc',
    verify_command: null,
    verify_exit: 0,
    signed_by: 'operator',
    payload: {},
    created_at: '2026-07-20T00:00:00Z',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

async function advanceThroughInterview() {
  for (let i = 0; i < SAMPLE_INTERVIEW_BEATS.length; i++) {
    fireEvent.click(await screen.findByTestId('guided-sample-next-beat'));
  }
}

describe('GuidedSample interview playback', () => {
  it('plays back every canned beat then reaches the ready stage', async () => {
    render(<GuidedSample projectId="proj-1" onContinue={vi.fn()} />);
    expect(screen.getByText(SAMPLE_INTERVIEW_BEATS[0]!.question)).toBeTruthy();

    await advanceThroughInterview();

    expect(await screen.findByTestId('guided-sample-ready')).toBeTruthy();
    expect(mockedApi.runGuidedPipeline).not.toHaveBeenCalled();
  });
});

describe('GuidedSample real pipeline run', () => {
  it('runs the pipeline, shows the created tickets and gate receipts, then the morning queue', async () => {
    mockedApi.runGuidedPipeline.mockResolvedValue(RUN_RESULT);
    mockedApi.fetchGateReceipts.mockResolvedValue(RECEIPTS);

    render(<GuidedSample projectId="proj-1" onContinue={vi.fn()} />);
    await advanceThroughInterview();
    fireEvent.click(await screen.findByTestId('guided-sample-run'));

    await waitFor(() => expect(mockedApi.runGuidedPipeline).toHaveBeenCalledTimes(1));
    expect(mockedApi.runGuidedPipeline).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({ blueprintTitle: expect.any(String) }),
    );

    expect(await screen.findByTestId('guided-sample-success')).toBeTruthy();
    expect(screen.getByText(/T-1/)).toBeTruthy();
    expect(screen.getByText(/T-2/)).toBeTruthy();
    expect(screen.getByText(/receipt-1/)).toBeTruthy();

    fireEvent.click(screen.getByTestId('guided-sample-show-queue'));
    expect(await screen.findByTestId('guided-sample-queue')).toBeTruthy();
    expect(screen.getByTestId('morning-queue')).toBeTruthy();
  });

  it('calling onContinue from the queue stage hands control back to the wizard', async () => {
    mockedApi.runGuidedPipeline.mockResolvedValue(RUN_RESULT);
    mockedApi.fetchGateReceipts.mockResolvedValue([]);
    const onContinue = vi.fn();

    render(<GuidedSample projectId="proj-1" onContinue={onContinue} />);
    await advanceThroughInterview();
    fireEvent.click(await screen.findByTestId('guided-sample-run'));
    await screen.findByTestId('guided-sample-success');
    fireEvent.click(screen.getByTestId('guided-sample-show-queue'));
    await screen.findByTestId('guided-sample-queue');

    fireEvent.click(screen.getByTestId('guided-sample-continue'));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

describe('GuidedSample honest degrade', () => {
  it('shows a not-wired message on a 404 and lets the wizard continue', async () => {
    mockedApi.runGuidedPipeline.mockRejectedValue(
      new onboardingApi.OnboardingApiError(404, 'route not found'),
    );
    const onContinue = vi.fn();

    render(<GuidedSample projectId="proj-1" onContinue={onContinue} />);
    await advanceThroughInterview();
    fireEvent.click(await screen.findByTestId('guided-sample-run'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      "doesn't have the guided-sample pipeline route wired",
    );

    fireEvent.click(screen.getByTestId('guided-sample-continue'));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('shows a decision-incomplete message on a 422', async () => {
    mockedApi.runGuidedPipeline.mockRejectedValue(
      new onboardingApi.OnboardingApiError(422, 'unresolved founder decision'),
    );

    render(<GuidedSample projectId="proj-1" onContinue={vi.fn()} />);
    await advanceThroughInterview();
    fireEvent.click(await screen.findByTestId('guided-sample-run'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('a decision only a founder can make');
  });

  it('skipping from the ready stage calls onContinue without running the pipeline', async () => {
    const onContinue = vi.fn();
    render(<GuidedSample projectId="proj-1" onContinue={onContinue} />);
    await advanceThroughInterview();
    await screen.findByTestId('guided-sample-ready');
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(mockedApi.runGuidedPipeline).not.toHaveBeenCalled();
  });
});

/**
 * The awaiting-decisions branch had no test, and its instruction named a
 * control that does not exist on the screen showing it: `Describe` is
 * `needsProject` (Header.tsx), and this renders inside the setup wizard, where
 * no project is open. Verified live on 2026-08-28 — the wizard's menu is
 * Fleet / Roster / Morning queue / Settings, and a first-run user with three
 * pending decisions had nowhere to go.
 */
describe('GuidedSample: the pause names a route the person can actually take', () => {
  async function pauseOnDecisions() {
    mockedApi.runGuidedPipeline.mockResolvedValue({
      status: 'awaiting_decisions',
      run_id: 'run-1',
      reasons: ['the blueprint raised three founder decisions'],
      decisions: [{ key: 'auth', slate_id: 's1', title: 'How should local auth work?' }],
    } as never);
    render(<GuidedSample projectId="proj-1" onContinue={vi.fn()} />);
    await advanceThroughInterview();
    fireEvent.click(await screen.findByTestId('guided-sample-run'));
    return screen.findByRole('alert');
  }

  it('RED FIXTURE: does not tell someone in the wizard to open a project-only screen', async () => {
    const alert = await pauseOnDecisions();
    expect(alert.textContent).not.toMatch(/^.*Open Describe to answer it/);
    expect(alert.textContent).toMatch(/finish setup with done/i);
  });

  it('explains why Describe is missing from the menu right now', async () => {
    const alert = await pauseOnDecisions();
    expect(alert.textContent).toMatch(/only appears once a project is open/i);
  });

  it('still says the pause is the gate working, not a failure', async () => {
    const alert = await pauseOnDecisions();
    expect(alert.textContent).toMatch(/gate working, not a failure/i);
  });
});
