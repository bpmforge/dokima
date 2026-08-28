import { MODEL_POLICY_CHOICES } from './modelPolicyChoices.js';

/**
 * Step 1 of the setup wizard: how work is modelled (W12-13, D-024).
 *
 * Extracted from `FirstRunWizard.tsx` verbatim when W13-37 added the models
 * step and the file crossed the 400-line cap. Nothing about the step changed —
 * this is a move, not a rewrite, and in particular the "no silent default"
 * property stays exactly where it was: `choiceId` starts null and Next is
 * disabled until the reader picks.
 */
export interface WizardPresetStepProps {
  /** Position in the ACTUAL step sequence for this entry point (W13-58). */
  number: number;
  choiceId: string | null;
  onChoose: (id: string) => void;
  onNext: () => void;
}

export function WizardPresetStep({ number, choiceId, onChoose, onNext }: WizardPresetStepProps) {
  return (
    <section
      aria-label="How should your work be modelled?"
      data-testid="wizard-step-preset"
    >
      <h2>{number}. How should your work be modelled?</h2>
      <p className="settings__hint">
        Nothing spends money or contacts a network until you choose. Whichever you pick,
        reviews still use a different model from the one that did the work — nothing here
        checks its own output.
      </p>
      {MODEL_POLICY_CHOICES.map((c) => (
        <label key={c.id} className="settings__radio">
          <input
            type="radio"
            name="model-policy"
            checked={choiceId === c.id}
            onChange={() => onChoose(c.id)}
          />
          <span>
            {c.label}
            {c.offlineCapable ? ' (works offline)' : ''}
            <br />
            <small>{c.detail}</small>
          </span>
        </label>
      ))}
      <button
        type="button"
        className="btn-primary"
        disabled={choiceId === null}
        onClick={onNext}
      >
        Next
      </button>
      {/* W13-02's rule, applied to the screen it was never applied to: a
          disabled primary says what IT is waiting for. This is step 1 of the
          setup wizard — the product's front door, reached from the empty
          Fleet's own call to action — and it offered five unselected options
          above a dead Next with nothing saying a choice was required. */}
      {choiceId === null && (
        <small className="settings__hint" data-testid="wizard-preset-blocked">
          Pick one of the options above to continue. Nothing is chosen for you —
          which models do your work is your call, not a default.
        </small>
      )}
    </section>
  );
}
