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
import { FleetApiError } from '../fleet/api.js';
import * as settingsApi from '../settings/api.js';
import { FirstRunWizard } from '../settings/FirstRunWizard.js';
import { PROVIDER_KINDS } from '../settings/providers-api.js';

vi.mock('../fleet/api.js', async () => {
  const actual =
    await vi.importActual<typeof import('../fleet/api.js')>('../fleet/api.js');
  return { ...actual, createProject: vi.fn() };
});

vi.mock('../settings/api.js', async () => {
  const actual =
    await vi.importActual<typeof import('../settings/api.js')>('../settings/api.js');
  return {
    ...actual,
    putGlobalSettings: vi.fn(),
    // W13-37: the wizard now writes the matrix from the two models the user
    // picks, so every walk past step 3 goes through this.
    putModelMatrixFromPreset: vi.fn(),
  };
});

// W10-55: the wizard now registers the configured provider through the real
// provider registry once the sample project exists — the write it used to send
// to `PUT /settings/global`, which drops a `providers` key on the floor.
vi.mock('../settings/providers-api.js', async () => {
  const actual = await vi.importActual<typeof import('../settings/providers-api.js')>(
    '../settings/providers-api.js',
  );
  return {
    ...actual,
    putProviders: vi.fn().mockResolvedValue([]),
    fetchProviderModels: vi.fn().mockResolvedValue({
      status: 'ok',
      source: 'discovered',
      // Deliberately arbitrary names: the product must not recognise, rank or
      // prefer any model id (W13-36).
      models: [{ id: 'model-alpha' }, { id: 'model-beta' }],
    }),
  };
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

/** Walks the models step: two distinct ids from the user's own catalog. */
async function chooseModels() {
  mockedSettingsApi.putModelMatrixFromPreset.mockResolvedValue({
    rows: [],
    copilotEnabled: false,
    scope: 'global',
  });
  // Wait for the CATALOG, not just the step: the fields start as free-text
  // inputs and are replaced by selects once the provider answers, and a
  // change fired at the detached input silently does nothing.
  await screen.findAllByRole('option', { name: 'model-alpha' });
  fireEvent.change(screen.getByTestId('wizard-model-work'), {
    target: { value: 'model-alpha' },
  });
  fireEvent.change(screen.getByTestId('wizard-model-review'), {
    target: { value: 'model-beta' },
  });
  fireEvent.click(
    screen.getByTestId('wizard-step-models').querySelector('button') as HTMLButtonElement,
  );
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

    // W13-37: on a fresh install the models step happens HERE — it is the
    // first moment a project exists to read a catalog through or write a
    // matrix onto. Skipping it is what left a finished wizard unable to
    // build a board.
    await chooseModels();

    expect(await screen.findByTestId('wizard-step-done')).toBeTruthy();
    // W13-64: NAME-ONLY — no path, and above all no /tmp. The hardcoded
    // /tmp/dokima-sample-<ts> is how a real walkthrough's first project got
    // deleted by a test run's cleanup glob.
    expect(mockedFleetApi.createProject).toHaveBeenCalledWith({
      mode: 'new',
      name: 'Dokima Sample',
    });
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

describe('FirstRunWizard provider kinds (W12-19)', () => {
  async function reachProviderStep() {
    render(<FirstRunWizard onFinish={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: /Local only/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    return screen.findByLabelText('Provider kind');
  }

  it(
    'RED FIXTURE: offers EVERY registered kind, not three. The wizard carried its ' +
      'own hand-written list — a fourth copy of the kind table after the three ' +
      'adapter-dispatch copies this wave consolidated — and it had gone stale: ' +
      'three options against the panel’s seven',
    async () => {
      const select = await reachProviderStep();
      const values = Array.from(select.querySelectorAll('option')).map(
        (o) => (o as HTMLOptionElement).value,
      );
      for (const kind of PROVIDER_KINDS) expect(values).toContain(kind);
      expect(values.length).toBe(PROVIDER_KINDS.length);
    },
  );

  it(
    'RED FIXTURE: Vertex asks for project and region. W12-14 made the registry ' +
      'REQUIRE them, and this wizard never collected them — so choosing Vertex ' +
      'produced "bills a specific cloud project and requires project" at the one ' +
      'moment a new user is least equipped to debug it',
    async () => {
      const select = await reachProviderStep();
      fireEvent.change(select, { target: { value: 'vertex' } });
      expect(screen.getByLabelText('GCP project')).toBeTruthy();
      expect(screen.getByLabelText('Region')).toBeTruthy();
    },
  );

  it('a local kind asks for a base URL and no credential', async () => {
    const select = await reachProviderStep();
    fireEvent.change(select, { target: { value: 'lm-studio' } });
    expect(screen.getByLabelText('Base URL')).toBeTruthy();
    expect(screen.queryByLabelText(/Credential ref/)).toBeNull();
  });

  it('a subscription kind says so rather than asking for a key it cannot use', async () => {
    const select = await reachProviderStep();
    fireEvent.change(select, { target: { value: 'copilot' } });
    expect(screen.getByTestId('wizard-subscription-kind')).toBeTruthy();
    expect(screen.queryByLabelText(/Credential ref/)).toBeNull();
  });
});

/**
 * W12-16 / D-024 option (b), unblocked by W12-37 landing D-027. The wizard
 * shipped with four choices and said in its own doc comment why the fifth was
 * absent: `locked` pins a RUNG, not a model, so there was nothing honest to
 * map it to. There is now.
 */
describe('the fifth choice: one model I pick (W12-16)', () => {
  it(
    'RED FIXTURE: the wizard offers FIVE ways to model work. D-024 names four ' +
      'user choices and one of them — "a specific model of my choosing" — had no ' +
      'way to be picked, which made the decision partly aspirational',
    () => {
      render(<FirstRunWizard onFinish={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getAllByRole('radio')).toHaveLength(5);
      expect(screen.getByRole('radio', { name: /one model I pick/i })).toBeTruthy();
    },
  );

  it(
    'asks for the model on the PROVIDER step, where the kind is already chosen. ' +
      'The pin needs a providerKind for its retry ceiling (W12-37 infers 8 vs 12 ' +
      'from it), and asking on step 1 would ask before there is an answer',
    async () => {
      render(<FirstRunWizard onFinish={vi.fn()} onCancel={vi.fn()} />);
      fireEvent.click(screen.getByRole('radio', { name: /one model I pick/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      await screen.findByTestId('wizard-step-provider');
      expect(screen.getByLabelText(/Model to use/i)).toBeTruthy();
    },
  );

  it('the model field appears ONLY for the pinned choice — the other four route by matrix', async () => {
    render(<FirstRunWizard onFinish={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: /Local only/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByTestId('wizard-step-provider');
    expect(screen.queryByLabelText(/Model to use/i)).toBeNull();
  });

  it(
    'persists { mode: pinned, model, providerKind } — providerKind included ' +
      'because W12-37 reads it to infer the convergence ceiling, and nothing else ' +
      'writes it, so an omission here means every pin silently reads as metered',
    async () => {
      mockedSettingsApi.putGlobalSettings.mockResolvedValue({});
      render(<FirstRunWizard onFinish={vi.fn()} onCancel={vi.fn()} />);
      fireEvent.click(screen.getByRole('radio', { name: /one model I pick/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      await screen.findByTestId('wizard-step-provider');
      fireEvent.change(screen.getByLabelText(/Model to use/i), {
        target: { value: 'qwen3-32b' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));

      await vi.waitFor(() => expect(mockedSettingsApi.putGlobalSettings).toHaveBeenCalled());
      const body = mockedSettingsApi.putGlobalSettings.mock.calls[0]![0] as {
        escalationPolicy: { mode: string; model: string; providerKind: string };
      };
      expect(body.escalationPolicy).toMatchObject({
        mode: 'pinned',
        model: 'qwen3-32b',
        providerKind: 'lm-studio',
      });
    },
  );

  it(
    'will not continue with the choice made and no model named. W12-37 refuses ' +
      'an unnamed pin at run time; discovering that at the first run is exactly ' +
      'the "option that silently fails" this ticket was filed to avoid',
    async () => {
      render(<FirstRunWizard onFinish={vi.fn()} onCancel={vi.fn()} />);
      fireEvent.click(screen.getByRole('radio', { name: /one model I pick/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      await screen.findByTestId('wizard-step-provider');
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      expect(await screen.findByText(/name the model/i)).toBeTruthy();
      expect(mockedSettingsApi.putGlobalSettings).not.toHaveBeenCalled();
    },
  );

  it(
    'says plainly that the pin applies to the work, not to the review (C-4). A ' +
      'user picking ONE model must not be left to discover at their first run ' +
      'that a reviewer is a different one — W12-37 makes that true by ' +
      'construction, so the wizard states it rather than asking for a second model',
    () => {
      render(<FirstRunWizard onFinish={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText(/reviews still use a different model/i)).toBeTruthy();
    },
  );
});


describe('FirstRunWizard — the returning user gets a numbered sample, not an error (W13-64)', () => {
  it('retries with "Dokima Sample 2" when the name already exists', async () => {
    mockedFleetApi.createProject
      .mockRejectedValueOnce(
        new FleetApiError(409, '/Users/x/Dokima/Dokima Sample already exists. Open it from the Fleet…'),
      )
      .mockResolvedValueOnce({
        id: 'proj-sample-2', path: '/x', name: 'Dokima Sample 2', archived: false,
        available: true, createdAt: 'now', lastOpenedAt: 'now', phase: null,
        board: { ready: 0, blocked: 0, done: 0 }, berthsRunning: 0,
        heartbeatAgeMs: null, pendingDecideCount: 0, spendTodayUsd: 0,
      });

    await advanceToSampleStep();
    fireEvent.click(screen.getByRole('button', { name: 'Create sample project' }));
    await chooseModels();
    expect(await screen.findByTestId('wizard-step-done')).toBeTruthy();

    expect(mockedFleetApi.createProject).toHaveBeenNthCalledWith(1, { mode: 'new', name: 'Dokima Sample' });
    expect(mockedFleetApi.createProject).toHaveBeenNthCalledWith(2, { mode: 'new', name: 'Dokima Sample 2' });
  });
});
