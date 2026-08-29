import { canGenerate } from './providers-model-refs.js';
import { useEffect, useState } from 'react';
import { putModelMatrixFromPreset, SettingsApiError } from './api.js';
import { fetchProviderModels, type ProviderCatalog } from './providers-api.js';

/**
 * The setup wizard's model step (W13-37).
 *
 * This is the step that was missing, and its absence is why a fresh install
 * could not build a board: the wizard asked HOW work should be modelled (a
 * preset name) and WHERE models come from (a provider), and then never asked
 * WHICH models — so nothing ever wrote a matrix row, `buildPresetMatrix` had
 * no production caller at all, and the first run failed at the endpoint.
 *
 * Two rules this step exists to keep:
 *
 * 1. **The models are the user's own.** The list is read from the provider
 *    they just registered. Nothing here ships a model name, and nothing here
 *    ranks the list — no parsing ids for parameter counts, no preferring the
 *    biggest context window. A guess dressed as a heuristic is still the
 *    silent default D-024 forbids, and on a machine holding 26 arbitrary
 *    model names it would simply be wrong.
 * 2. **Two distinct models, said plainly.** C-4 is mechanical: a reviewer may
 *    not be the model that did the work, and `route()` refuses a collision
 *    mid-run. So a provider serving only one usable model is told to the user
 *    HERE, at setup, rather than surfacing as a failed run later.
 */
export interface WizardModelsStepProps {
  /** Position in the ACTUAL step sequence for this entry point (W13-58). */
  number: number;
  projectId: string;
  providerId: string;
  /** The preset the user chose on step 1 — the SHAPE the server expands. */
  preset: string;
  /** Advances the wizard. Called only after the matrix is actually written. */
  onSaved: () => void;
}

function loadFailure(err: unknown): string {
  return err instanceof SettingsApiError
    ? err.message
    : 'Could not read the model list from that provider.';
}

export function WizardModelsStep({
  number,
  projectId,
  providerId,
  preset,
  onSaved,
}: WizardModelsStepProps) {
  const [catalog, setCatalog] = useState<ProviderCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // No pre-selection, matching the preset step: the user chooses, or the
  // wizard does not move.
  const [work, setWork] = useState('');
  const [review, setReview] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchProviderModels(projectId, providerId);
        if (!cancelled) setCatalog(next);
      } catch (err) {
        if (!cancelled) setLoadError(loadFailure(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, providerId]);

  /**
   * W21-94: only models that can actually generate. An embedding model cannot
   * write or review code, and offering one here hands the user a setup broken
   * by construction. `canGenerate` refuses ONLY what the provider reported as
   * an embedding model — an endpoint that reports nothing keeps every model on
   * offer, because absence is unknown, not disqualifying.
   */
  const offerable = (catalog?.models ?? []).filter(canGenerate);
  const ids = offerable.map((m) => m.id);
  const hiddenCount = (catalog?.models?.length ?? 0) - offerable.length;
  const unreachable = catalog?.status === 'unreachable' || loadError !== null;
  const tooFew = catalog !== null && !unreachable && ids.length < 2;
  const ready =
    work.trim() !== '' && review.trim() !== '' && work.trim() !== review.trim();
  /**
   * W13-02's rule: name the precondition that is ACTUALLY unmet, never a
   * generic one. The same-model case already had its own hint below; the two
   * empty-field cases had none, so a half-filled step showed a dead Next and
   * no reason. Returns null when the same-model hint is what is showing, so
   * the screen never states the same blocker twice.
   */
  const blockedBecause = (() => {
    if (ready || saving) return null;
    const noWork = work.trim() === '';
    const noReview = review.trim() === '';
    if (noWork && noReview) return 'Name both models to continue.';
    if (noWork) return 'Name the model that writes the code.';
    if (noReview) return 'Name the model that reviews it.';
    return null;
  })();

  const save = async () => {
    setSaving(true);
    try {
      // `strong` is the REVIEW model and `cheap` is the WORK model — the
      // preset shape gives the maker the cheaper tier and the checkers the
      // stronger one. Getting this pair backwards inverts every row silently,
      // which is exactly what the test on this file pins.
      await putModelMatrixFromPreset(
        projectId,
        { preset, strong: review.trim(), cheap: work.trim() },
        { scope: 'global' },
      );
      setSaveError(null);
      onSaved();
    } catch (err) {
      setSaveError(
        err instanceof SettingsApiError ? err.message : 'Could not save your models.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Choose your models" data-testid="wizard-step-models">
      <h2>{number}. Which of your models should do the work?</h2>
      <p className="settings__hint">
        Read from the provider you just registered. Reviews use a different model from the
        one that wrote the code — that is not a preference, it is how Dokima keeps
        anything from checking its own output.
      </p>

      {loadError && (
        <p role="alert" className="settings__error">
          {loadError}
        </p>
      )}
      {catalog?.status === 'unreachable' && (
        <p
          role="alert"
          className="settings__error"
          data-testid="wizard-models-unreachable"
        >
          That provider did not answer. Start it and reopen this step, or type the model
          ids below exactly as it lists them.
        </p>
      )}
      {/* W16-06's rule, applied to the screen it was never applied to: the raw
          string is SHOWN, never the headline. `catalog.reason` is built as
          `${providerId}: endpoint unreachable — ${String(cause)}` (gateway
          providers/errors.ts), so inlining it put "TypeError: fetch failed"
          into the first sentence a novice reads — and, because the reason ends
          without punctuation, ran it straight into the next one:
          "…fetch failed Start it and reopen this step". */}
      {catalog?.status === 'unreachable' && catalog.reason && (
        <p className="settings__hint" data-testid="wizard-models-unreachable-reason">
          What it said: {catalog.reason}
        </p>
      )}
      {/* W21-94 AC4: an empty picker after filtering must explain itself, or it
          reads as "this endpoint serves nothing" — which would be false. */}
      {hiddenCount > 0 && ids.length === 0 && (
        <p role="alert" className="settings__error" data-testid="wizard-models-all-embedding">
          That provider serves {hiddenCount} model{hiddenCount === 1 ? '' : 's'}, but{' '}
          {hiddenCount === 1 ? 'it is an embedding model' : 'they are all embedding models'} —
          they turn text into vectors and cannot write or review code. Load a chat or
          instruct model on this endpoint, then reopen this step.
        </p>
      )}
      {hiddenCount > 0 && ids.length > 0 && (
        <p className="settings__hint" data-testid="wizard-models-hidden">
          {hiddenCount} embedding model{hiddenCount === 1 ? '' : 's'} not shown — they
          cannot write or review code.
        </p>
      )}
      {tooFew && (
        <p role="alert" className="settings__error" data-testid="wizard-models-too-few">
          That provider serves {ids.length === 1 ? 'only one model' : 'no models'}. Dokima
          needs two: reviews never run on the model that did the work. Load a second model
          and reopen this step, or add another provider in Settings → Providers.
        </p>
      )}
      {saveError && (
        <p role="alert" className="settings__error">
          {saveError}
        </p>
      )}

      <label>
        Model that writes the code
        <ModelField
          value={work}
          onChange={setWork}
          ids={ids}
          testId="wizard-model-work"
          freeform={unreachable}
        />
      </label>
      <label>
        Model that reviews it
        <ModelField
          value={review}
          onChange={setReview}
          ids={ids}
          testId="wizard-model-review"
          freeform={unreachable}
        />
      </label>
      {work.trim() !== '' && work.trim() === review.trim() && (
        <p className="settings__hint" data-testid="wizard-models-same">
          Pick a different model for reviews — the same one on both sides is refused at
          the first run, not here.
        </p>
      )}

      <button
        type="button"
        className="btn-primary"
        disabled={!ready || saving}
        onClick={() => void save()}
      >
        {saving ? 'Saving…' : 'Next'}
      </button>
      {blockedBecause !== null && (
        <small className="settings__hint" data-testid="wizard-models-blocked">
          {blockedBecause}
        </small>
      )}
    </section>
  );
}

interface ModelFieldProps {
  value: string;
  onChange: (next: string) => void;
  ids: readonly string[];
  testId: string;
  /**
   * A provider that did not answer still gets the user a working setup: they
   * type the id. Wedging the wizard on a daemon being down would make a
   * restart the only way forward.
   */
  freeform: boolean;
}

function ModelField({ value, onChange, ids, testId, freeform }: ModelFieldProps) {
  if (freeform || ids.length === 0) {
    return (
      <input
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="the id exactly as your provider lists it"
      />
    );
  }
  return (
    <select data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a model</option>
      {ids.map((id) => (
        <option key={id} value={id}>
          {id}
        </option>
      ))}
    </select>
  );
}
