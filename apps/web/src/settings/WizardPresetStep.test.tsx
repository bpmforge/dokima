// @vitest-environment jsdom
/**
 * Step 1 of the setup wizard — the product's front door, reached from the
 * empty Fleet's own "Set up Dokima" call to action.
 *
 * The step deliberately pre-selects nothing (D-024, Law 9b: which model does
 * the work is asked, never defaulted). That is right, and these tests keep it.
 * What was missing is the other half of W13-02's rule, fixed on the interview
 * screen and never applied here: a disabled primary must say what IT is
 * waiting for. A novice met five unselected options above a dead Next with
 * nothing on screen saying a choice was required.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WizardPresetStep } from './WizardPresetStep.js';
import { MODEL_POLICY_CHOICES } from './modelPolicyChoices.js';

afterEach(cleanup);

function renderStep(choiceId: string | null = null) {
  const onChoose = vi.fn();
  const onNext = vi.fn();
  render(
    <WizardPresetStep number={1} choiceId={choiceId} onChoose={onChoose} onNext={onNext} />,
  );
  return { onChoose, onNext };
}

describe('WizardPresetStep: nothing is chosen for you (D-024)', () => {
  it('pre-selects no policy and disables Next until one is picked', () => {
    renderStep();
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios).toHaveLength(MODEL_POLICY_CHOICES.length);
    expect(radios.some((r) => r.checked)).toBe(false);
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('RED FIXTURE: the disabled Next says a choice is required, and why nothing was picked for you', () => {
    renderStep();
    const blocked = screen.getByTestId('wizard-preset-blocked');
    expect(blocked.textContent).toMatch(/pick one of the options above/i);
    // The reason it is blocked is a product commitment, not an oversight.
    expect(blocked.textContent).toMatch(/not a default/i);
  });

  it('the explanation goes away once a choice is made, and Next opens', () => {
    const first = MODEL_POLICY_CHOICES[0]!;
    renderStep(first.id);
    expect(screen.queryByTestId('wizard-preset-blocked')).toBeNull();
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('choosing reports the policy id, and Next advances', () => {
    const { onChoose, onNext } = renderStep(MODEL_POLICY_CHOICES[0]!.id);
    fireEvent.click(screen.getAllByRole('radio')[1]!);
    expect(onChoose).toHaveBeenCalledWith(MODEL_POLICY_CHOICES[1]!.id);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalled();
  });
});
