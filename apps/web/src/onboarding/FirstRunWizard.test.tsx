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

// W10-55: the wizard now registers the configured provider through the real
// provider registry once the sample project exists — the write it used to send
// to `PUT /settings/global`, which drops a `providers` key on the floor.
vi.mock('../settings/providers-api.js', async () => {
  const actual = await vi.importActual<typeof import('../settings/providers-api.js')>(
    '../settings/providers-api.js',
  );
  return { ...actual, putProviders: vi.fn().mockResolvedValue([]) };
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
  // W12-13/D-024: step 1 no longer advances on its own. Every caller must
  // choose how work is modelled, which is exactly the silent default this
  // ticket removed — these two lines ARE the behaviour change, in the helper
  // every other test shares.
  fireEvent.click(screen.getByRole('radio', { name: /Local only/ }));
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
      name: 'Dokima Sample',
      archived: false,
      available: true,
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

describe('FirstRunWizard — model policy (W12-13, D-024)', () => {
  it(
    'RED FIXTURE: NOTHING is preselected and Next is disabled until the user ' +
      'chooses — the wizard used to default to `hybrid`, so clicking straight ' +
      'through opted a fresh install into cloud spend nobody picked',
    () => {
      render(<FirstRunWizard onFinish={vi.fn()} onCancel={vi.fn()} />);
      for (const radio of screen.getAllByRole('radio')) {
        expect((radio as HTMLInputElement).checked).toBe(false);
      }
      expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    },
  );

  it('offers local-only as a first-class choice, marked as working offline (C-1)', () => {
    render(<FirstRunWizard onFinish={vi.fn()} onCancel={vi.fn()} />);
    const localOnly = screen.getByRole('radio', { name: /Local only/ });
    expect(localOnly).toBeTruthy();
    expect(screen.getByText(/works offline/)).toBeTruthy();
    // Selecting it is enough to proceed: no provider, no network, no spend.
    fireEvent.click(localOnly);
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it(
    'persists BOTH dimensions — the matrix preset AND the escalation policy. The ' +
      'wizard only ever wrote the preset, so the policy fell through to ' +
      "`resolveLandEscalationPolicy`'s `ladder` fallback: the silent default itself",
    async () => {
      mockedSettingsApi.putGlobalSettings.mockResolvedValue({});
      render(<FirstRunWizard onFinish={vi.fn()} onCancel={vi.fn()} />);
      fireEvent.click(screen.getByRole('radio', { name: /Escalate only when I approve/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Next' }));

      const patch = mockedSettingsApi.putGlobalSettings.mock.calls[0]?.[0] as
        | Record<string, unknown>
        | undefined;
      expect(patch?.defaultModelMatrixPreset).toBe('hybrid');
      expect(patch?.escalationPolicy).toEqual({ mode: 'token-gated' });
    },
  );

  it('maps local-only to the all-local matrix, not merely to a policy', async () => {
    mockedSettingsApi.putGlobalSettings.mockResolvedValue({});
    render(<FirstRunWizard onFinish={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: /Local only/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));

    const patch = mockedSettingsApi.putGlobalSettings.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(patch?.defaultModelMatrixPreset).toBe('all-local');
  });
});
