// @vitest-environment jsdom
/**
 * Wizard step flow (FR-S4, R-M1): preset -> provider -> forge -> sample ->
 * done, plus the "?" help affordances and the guided-sample walkthrough +
 * what-to-do-tomorrow card on the final (`done`) step. Mocks `../fleet/api.js`,
 * `../settings/api.js`, and `./GuidedSample.js` (its own behavior is
 * covered by `./GuidedSample.test.tsx`) so the wizard's own step
 * transitions are exercised in isolation, same pattern as
 * `../decisions/DecisionsBoard.test.tsx`. Lives under onboarding/ (not
 * settings/) because FirstRunWizard.tsx is the only settings/ path in this
 * ticket's write_scope — a sibling test file there would be out-of-scope.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as fleetApi from '../fleet/api.js';
import * as settingsApi from '../settings/api.js';
import { FirstRunWizard } from '../settings/FirstRunWizard.js';

vi.mock('../fleet/api.js', async () => {
  const actual =
    await vi.importActual<typeof import('../fleet/api.js')>('../fleet/api.js');
  return { ...actual, createProject: vi.fn() };
});

vi.mock('../settings/api.js', async () => {
  const actual =
    await vi.importActual<typeof import('../settings/api.js')>('../settings/api.js');
  return { ...actual, putGlobalSettings: vi.fn() };
});

vi.mock('./GuidedSample.js', () => ({
  GuidedSample: ({ onContinue }: { onContinue: () => void }) => (
    <button type="button" onClick={onContinue} data-testid="stub-guided-sample-continue">
      (stub) continue guided sample
    </button>
  ),
}));

const mockedFleetApi = vi.mocked(fleetApi);
const mockedSettingsApi = vi.mocked(settingsApi);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

async function advanceToSampleStep() {
  render(<FirstRunWizard onFinish={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  mockedSettingsApi.putGlobalSettings.mockResolvedValue({});
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Skip' }));
  await screen.findByTestId('wizard-step-sample');
}

describe('FirstRunWizard help affordances', () => {
  it('renders a "?" help button for the wizard overall', () => {
    render(<FirstRunWizard onFinish={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Help: Setup wizard' })).toBeTruthy();
  });

  it('renders a "?" help button on the guided sample step', async () => {
    await advanceToSampleStep();
    expect(screen.getByRole('button', { name: 'Help: Guided sample' })).toBeTruthy();
  });
});

describe('FirstRunWizard sample step -> done (guided sample embedded)', () => {
  it('creates the sample project, reaches done with the guided sample and tomorrow card, and dismissing the walkthrough leaves the card in place', async () => {
    mockedFleetApi.createProject.mockResolvedValue({
      id: 'proj-sample-1',
      path: '/tmp/x',
      name: 'Shipwright Sample',
      archived: false,
      createdAt: '2026-07-20T00:00:00Z',
      lastOpenedAt: '2026-07-20T00:00:00Z',
      phase: null,
      board: { ready: 0, blocked: 0, done: 0 },
      berthsRunning: 0,
      heartbeatAgeMs: null,
      pendingDecideCount: 0,
      spendTodayUsd: 0,
    });

    await advanceToSampleStep();
    fireEvent.click(screen.getByRole('button', { name: 'Create sample project' }));

    expect(await screen.findByTestId('wizard-step-done')).toBeTruthy();
    expect(mockedFleetApi.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'new' }),
    );
    expect(screen.getByTestId('wizard-guided-sample')).toBeTruthy();
    expect(screen.getByTestId('what-to-do-tomorrow').textContent).toContain(
      'Morning Queue',
    );

    fireEvent.click(screen.getByTestId('stub-guided-sample-continue'));
    expect(screen.queryByTestId('wizard-guided-sample')).toBeNull();
    // The tomorrow card and Done button stay put after the walkthrough dismisses.
    expect(screen.getByTestId('what-to-do-tomorrow')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
  });
});
