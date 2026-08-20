import { expect, type Page } from '@playwright/test';

/**
 * Walks the setup wizard's model step (W13-37).
 *
 * Handles both shapes the step can take, because both are real: a provider
 * that answered gets selects populated from its own catalog, and one that did
 * not gets free-text ids so a stopped daemon cannot wedge setup.
 *
 * The catalog arrives asynchronously and REPLACES the inputs with selects, so
 * this settles first and reads the shape afterwards. Reading it eagerly is a
 * race that resolves to `<input>` on a fast machine and `<select>` on a slow
 * one — the first version of this helper did exactly that and failed.
 */
export async function chooseWizardModels(page: Page): Promise<void> {
  const step = page.getByTestId('wizard-step-models');
  await expect(step).toBeVisible();
  const work = page.getByTestId('wizard-model-work');
  const review = page.getByTestId('wizard-model-review');

  await expect
    .poll(async () => {
      if (await page.getByTestId('wizard-models-unreachable').isVisible()) return 'typed';
      // 3 options = the "Choose a model" placeholder plus two real ids.
      return (await work.locator('option').count()) >= 3 ? 'catalog' : 'pending';
    })
    .not.toBe('pending');

  if ((await work.evaluate((el) => el.tagName)) === 'SELECT') {
    const ids = await work
      .locator('option')
      .evaluateAll((options) =>
        options.map((o) => (o as HTMLOptionElement).value).filter((v) => v !== ''),
      );
    expect(ids.length).toBeGreaterThanOrEqual(2);
    await work.selectOption(ids[0]!);
    await review.selectOption(ids[1]!);
  } else {
    await work.fill('e2e-work-model');
    await review.fill('e2e-review-model');
  }

  await step.getByRole('button', { name: 'Next' }).click();
  await expect(step).toBeHidden();
}
