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

/**
 * W21-94. LM Studio served 34 models, four of them embeddings, and the picker
 * offered all 34 as "the model that writes the code". An embedding model turns
 * text into vectors — it cannot generate — so choosing one gives a setup broken
 * by construction whose failure surfaces much later.
 */
describe('the picker only offers models that can do the job', () => {
  const catalog = (models: { id: string; kind?: string }[]) => ({
    status: 'ok' as const,
    source: 'discovered' as const,
    models,
  });

  it('RED FIXTURE: an embedding model is not offered', async () => {
    mockedProviders.fetchProviderModels.mockResolvedValue(
      catalog([
        { id: 'qwen3.8-flash-next', kind: 'generative' },
        { id: 'text-embedding-nomic', kind: 'embedding' },
        { id: 'gemma-4-e4b', kind: 'generative' },
      ]) as never,
    );
    renderStep();
    // Wait for the CATALOG, not just the field: before it loads the field is
    // the freeform input, which has no options at all.
    await screen.findAllByRole('option', { name: 'qwen3.8-flash-next' });
    const select = screen.getByTestId('wizard-model-work') as HTMLSelectElement;
    // jsdom's HTMLOptionsCollection is not iterable — query the nodes.
    const options = [...select.querySelectorAll('option')].map((o) => o.value);
    expect(options).toContain('qwen3.8-flash-next');
    expect(options).not.toContain('text-embedding-nomic');
  });

  it('a model of UNKNOWN kind is still offered — absence never removes a choice', async () => {
    mockedProviders.fetchProviderModels.mockResolvedValue(
      catalog([{ id: 'mystery-a' }, { id: 'mystery-b' }]) as never,
    );
    renderStep();
    await screen.findAllByRole('option', { name: 'mystery-a' });
    const select = screen.getByTestId('wizard-model-work') as HTMLSelectElement;
    expect([...select.querySelectorAll('option')].map((o) => o.value)).toEqual(
      expect.arrayContaining(['mystery-a', 'mystery-b']),
    );
  });

  it('says how many were hidden rather than quietly shrinking the list', async () => {
    mockedProviders.fetchProviderModels.mockResolvedValue(
      catalog([
        { id: 'a', kind: 'generative' },
        { id: 'b', kind: 'generative' },
        { id: 'e1', kind: 'embedding' },
      ]) as never,
    );
    renderStep();
    expect((await screen.findByTestId('wizard-models-hidden')).textContent).toMatch(
      /1 embedding model not shown/,
    );
  });

  it('an endpoint serving ONLY embedding models explains itself, not an empty picker', async () => {
    mockedProviders.fetchProviderModels.mockResolvedValue(
      catalog([
        { id: 'e1', kind: 'embedding' },
        { id: 'e2', kind: 'embedding' },
      ]) as never,
    );
    renderStep();
    const alert = await screen.findByTestId('wizard-models-all-embedding');
    expect(alert.textContent).toMatch(/all embedding models/i);
    expect(alert.textContent).toMatch(/cannot write or review code/i);
  });
});
