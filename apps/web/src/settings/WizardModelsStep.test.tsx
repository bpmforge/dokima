// @vitest-environment jsdom
/**
 * W13-37. The step that asks which of the user's models to use.
 *
 * The first test is the load-bearing one: `strong`/`cheap` are TIERS, and the
 * preset shape gives the maker the cheaper tier. Hand the work model to
 * `strong` and every role in the matrix silently inverts — no error, no red
 * test anywhere else, just worse reviews on a more expensive model.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as settingsApi from './api.js';
import * as providersApi from './providers-api.js';
import { WizardModelsStep } from './WizardModelsStep.js';

vi.mock('./api.js', async () => {
  const actual = await vi.importActual<typeof import('./api.js')>('./api.js');
  return { ...actual, putModelMatrixFromPreset: vi.fn() };
});

vi.mock('./providers-api.js', async () => {
  const actual =
    await vi.importActual<typeof import('./providers-api.js')>('./providers-api.js');
  return { ...actual, fetchProviderModels: vi.fn() };
});

const mockedSettings = vi.mocked(settingsApi);
const mockedProviders = vi.mocked(providersApi);

beforeEach(() => {
  vi.clearAllMocks();
  mockedSettings.putModelMatrixFromPreset.mockResolvedValue({
    rows: [],
    copilotEnabled: false,
    scope: 'global',
  });
});

afterEach(() => {
  cleanup();
});

function renderStep(onSaved = vi.fn()) {
  render(
    <WizardModelsStep
      number={3}
      projectId="proj-1"
      providerId="first-run"
      preset="hybrid"
      onSaved={onSaved}
    />,
  );
  return onSaved;
}

describe('WizardModelsStep', () => {
  it('sends the work model as the CHEAP tier and the review model as STRONG', async () => {
    mockedProviders.fetchProviderModels.mockResolvedValue({
      status: 'ok',
      source: 'discovered',
      models: [{ id: 'zzz-writes' }, { id: 'aaa-reviews' }],
    });
    const onSaved = renderStep();

    await screen.findAllByRole('option', { name: 'zzz-writes' });
    fireEvent.change(screen.getByTestId('wizard-model-work'), {
      target: { value: 'zzz-writes' },
    });
    fireEvent.change(screen.getByTestId('wizard-model-review'), {
      target: { value: 'aaa-reviews' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockedSettings.putModelMatrixFromPreset).toHaveBeenCalledWith(
      'proj-1',
      { preset: 'hybrid', strong: 'aaa-reviews', cheap: 'zzz-writes' },
      { scope: 'global' },
    );
  });

  it('never pre-selects a model, whatever the catalog looks like', async () => {
    mockedProviders.fetchProviderModels.mockResolvedValue({
      status: 'ok',
      source: 'discovered',
      // A huge context window is exactly the kind of signal a "helpful"
      // default would rank on. Nothing here ranks anything.
      models: [{ id: 'one', contextLength: 1_000_000 }, { id: 'two' }],
    });
    renderStep();

    await screen.findAllByRole('option', { name: 'one' });
    expect((screen.getByTestId('wizard-model-work') as HTMLSelectElement).value).toBe('');
    expect((screen.getByTestId('wizard-model-review') as HTMLSelectElement).value).toBe(
      '',
    );
    expect(
      (screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('says so plainly when the provider serves only one model (C-4)', async () => {
    mockedProviders.fetchProviderModels.mockResolvedValue({
      status: 'ok',
      source: 'discovered',
      models: [{ id: 'the-only-one' }],
    });
    renderStep();

    const warning = await screen.findByTestId('wizard-models-too-few');
    expect(warning.textContent).toContain('only one model');
    // Told at SETUP, not as a failed run later.
    expect(mockedSettings.putModelMatrixFromPreset).not.toHaveBeenCalled();
  });

  it('refuses to advance on the same model twice', async () => {
    mockedProviders.fetchProviderModels.mockResolvedValue({
      status: 'ok',
      source: 'discovered',
      models: [{ id: 'a' }, { id: 'b' }],
    });
    renderStep();

    await screen.findAllByRole('option', { name: 'a' });
    fireEvent.change(screen.getByTestId('wizard-model-work'), { target: { value: 'a' } });
    fireEvent.change(screen.getByTestId('wizard-model-review'), {
      target: { value: 'a' },
    });
    expect(screen.getByTestId('wizard-models-same')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('falls back to typed ids when the provider does not answer', async () => {
    mockedProviders.fetchProviderModels.mockResolvedValue({
      status: 'unreachable',
      source: null,
      models: [],
      reason: 'connect ECONNREFUSED',
    });
    const onSaved = renderStep();

    await screen.findByTestId('wizard-models-unreachable');
    // A daemon being down must not wedge setup.
    fireEvent.change(screen.getByTestId('wizard-model-work'), {
      target: { value: 'typed-work' },
    });
    fireEvent.change(screen.getByTestId('wizard-model-review'), {
      target: { value: 'typed-review' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockedSettings.putModelMatrixFromPreset).toHaveBeenCalledWith(
      'proj-1',
      { preset: 'hybrid', strong: 'typed-review', cheap: 'typed-work' },
      { scope: 'global' },
    );
  });
});

/**
 * W13-02's rule — "the disabled primary says what IT is waiting for" — was
 * fixed on the interview screen and never applied to the setup wizard, which
 * is the screen a novice reaches FIRST.
 */
describe('the disabled Next names the precondition that is actually unmet', () => {
  it('RED FIXTURE: an empty step says both models are needed, not nothing at all', async () => {
    renderStep();
    expect(await screen.findByTestId('wizard-models-blocked')).toBeTruthy();
    expect(screen.getByTestId('wizard-models-blocked').textContent).toMatch(/both models/i);
  });

  it('names only the half that is missing', async () => {
    renderStep();
    await screen.findByTestId('wizard-models-blocked');
    fireEvent.change(screen.getByTestId('wizard-model-work'), {
      target: { value: 'model-a' },
    });
    expect(screen.getByTestId('wizard-models-blocked').textContent).toMatch(/reviews it/i);
  });

  it('does not state the same blocker twice — the same-model case keeps its own hint', async () => {
    renderStep();
    await screen.findByTestId('wizard-models-blocked');
    fireEvent.change(screen.getByTestId('wizard-model-work'), {
      target: { value: 'same' },
    });
    fireEvent.change(screen.getByTestId('wizard-model-review'), {
      target: { value: 'same' },
    });
    expect(screen.getByTestId('wizard-models-same')).toBeTruthy();
    expect(screen.queryByTestId('wizard-models-blocked')).toBeNull();
  });
});

describe('an unreachable provider explains itself without shouting an exception', () => {
  it('RED FIXTURE: the headline carries no raw exception string', async () => {
    mockedProviders.fetchProviderModels.mockResolvedValue({
      status: 'unreachable',
      source: null,
      models: [],
      reason: 'lm-studio: endpoint unreachable — TypeError: fetch failed',
    });
    renderStep();

    const headline = await screen.findByTestId('wizard-models-unreachable');
    expect(headline.textContent).not.toContain('TypeError');
    expect(headline.textContent).toMatch(/did not answer\./);
    expect(headline.textContent).toMatch(/type the model ids below/i);
  });

  it('keeps what the provider said — shown, not swallowed', async () => {
    mockedProviders.fetchProviderModels.mockResolvedValue({
      status: 'unreachable',
      source: null,
      models: [],
      reason: 'lm-studio: endpoint unreachable — TypeError: fetch failed',
    });
    renderStep();

    const detail = await screen.findByTestId('wizard-models-unreachable-reason');
    expect(detail.textContent).toContain('endpoint unreachable');
  });

  it('an unreachable provider that gave no reason shows no empty detail line', async () => {
    mockedProviders.fetchProviderModels.mockResolvedValue({
      status: 'unreachable',
      source: null,
      models: [],
    });
    renderStep();

    await screen.findByTestId('wizard-models-unreachable');
    expect(screen.queryByTestId('wizard-models-unreachable-reason')).toBeNull();
  });
});
