import { expect, request, test, type Locator, type Page } from '@playwright/test';
import { withProjectRegistryLock } from '../fixtures/project-registry-lock.js';
import { scanForA11yViolations } from './axeHelper.js';
import { freshProjectPath as newTempProject } from '../temp-project.js';

/** Axe scan on the settings matrix (docs/TESTING.md §7; UX_SPEC §9). Same setup as settings.spec.ts. */

/** Real `Tab` traversal (never `.focus()`) until `target` receives focus, or fails after `maxTabs` — same technique as keyboard-only.spec.ts. */
async function tabUntilFocused(
  page: Page,
  target: Locator,
  maxTabs = 100,
): Promise<void> {
  for (let i = 0; i < maxTabs; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('target was never reached via Tab within the press budget');
}

test('settings page has no WCAG 2.2 AA violations', async ({ page, baseURL }) => {
  const api = await request.newContext({ baseURL });
  const tokenRes = await api.get('/');
  const html = await tokenRes.text();
  const tokenMatch = /__DOKIMA_TOKEN__=("(?:[^"\\]|\\.)*")/.exec(html);
  const token = tokenMatch ? (JSON.parse(tokenMatch[1]!) as string) : undefined;

  const { dir, name } = newTempProject('a11y-settings');
  const created = await withProjectRegistryLock(async () => {
    const res = await api.post('/api/v1/projects', {
      headers: { Authorization: `Bearer ${token}` },
      data: { path: dir, mode: 'new', name },
    });
    return (await res.json()) as { id: string };
  });
  await api.dispose();

  await page.goto(`/?project=${created.id}&view=settings`);
  await expect(page.getByTestId('settings-page')).toBeVisible();

  const violations = await scanForA11yViolations(page, '[data-testid="settings-page"]');
  expect(violations).toEqual([]);
});

/**
 * W10-04: the empty-state scan above never renders the Providers table, the
 * reachability chip, or a populated Model <select> — exactly the surface
 * this ticket adds. Scans again once a provider is registered (falling back
 * to the bundled offline catalog on a closed port, per settings.spec.ts's
 * own model-matrix test — never a live network call, Law 9) and a matrix
 * row is picked from the resulting list.
 */
test('settings page has no WCAG 2.2 AA violations with a provider registered and a matrix row picked from its catalog', async ({
  page,
  baseURL,
}) => {
  const api = await request.newContext({ baseURL });
  const tokenRes = await api.get('/');
  const html = await tokenRes.text();
  const tokenMatch = /__DOKIMA_TOKEN__=("(?:[^"\\]|\\.)*")/.exec(html);
  const token = tokenMatch ? (JSON.parse(tokenMatch[1]!) as string) : undefined;

  const { dir, name } = newTempProject('a11y-settings-populated');
  const created = await withProjectRegistryLock(async () => {
    const res = await api.post('/api/v1/projects', {
      headers: { Authorization: `Bearer ${token}` },
      data: { path: dir, mode: 'new', name },
    });
    return (await res.json()) as { id: string };
  });
  await api.dispose();

  await page.goto(`/?project=${created.id}&view=settings`);
  await expect(page.getByTestId('settings-page')).toBeVisible();

  const providersForm = page.getByRole('form', { name: 'Add provider' });
  await providersForm.getByLabel('ID').fill('ollama-a11y');
  await providersForm.getByLabel('Base URL').fill('http://127.0.0.1:9/v1');
  await providersForm.getByRole('button', { name: 'Add provider' }).click();
  await expect(
    page.getByRole('row', { name: /ollama-a11y/ }).getByText('Bundled'),
  ).toBeVisible();

  // W12-35: register on the Providers tab, then switch. This is the flow that
  // was IMPOSSIBLE before the catalog was lifted — ModelMatrixPanel mounted
  // its own ProvidersPanel, so the discovered models lived in that instance
  // and switching tabs produced an empty picker. That it works now is the
  // point of the ticket.
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  const matrixForm = page.getByRole('form', { name: 'Add matrix row' });
  await matrixForm.getByLabel('Role').fill('coding-agent');
  await expect(matrixForm.getByLabel('Model')).toBeEnabled();
  await matrixForm.getByLabel('Model').selectOption('qwen2.5-coder');
  await matrixForm.getByRole('button', { name: 'Add / update row' }).click();
  await expect(page.getByRole('row', { name: /coding-agent/ })).toBeVisible();

  const violations = await scanForA11yViolations(page, '[data-testid="settings-page"]');
  expect(violations).toEqual([]);
});

/**
 * W10-04 AC5's second clause ("keyboard-operable end to end") needs its own
 * proof — an axe scan checks WCAG rules, not tab order or key operation.
 * Real `Tab` traversal (never `.focus()`) proves the Providers table's row
 * action and the Model matrix picker are actually reachable without a
 * pointer (UX_SPEC §9: "every row action is a button in the tab order").
 */
test('the Providers row action and the Model matrix picker are reachable and operable keyboard-only', async ({
  page,
  baseURL,
}) => {
  const api = await request.newContext({ baseURL });
  const tokenRes = await api.get('/');
  const html = await tokenRes.text();
  const tokenMatch = /__DOKIMA_TOKEN__=("(?:[^"\\]|\\.)*")/.exec(html);
  const token = tokenMatch ? (JSON.parse(tokenMatch[1]!) as string) : undefined;

  const { dir, name } = newTempProject('a11y-settings-kbd');
  const created = await withProjectRegistryLock(async () => {
    const res = await api.post('/api/v1/projects', {
      headers: { Authorization: `Bearer ${token}` },
      data: { path: dir, mode: 'new', name },
    });
    return (await res.json()) as { id: string };
  });
  await api.dispose();

  await page.goto(`/?project=${created.id}&view=settings`);
  await expect(page.getByTestId('settings-page')).toBeVisible();

  // Registering the provider through the real form is incidental setup, not
  // the thing under test — a closed port falls back to the bundled offline
  // catalog, never a live network call (Law 9), same as settings.spec.ts's
  // own model-matrix test.
  const providersForm = page.getByRole('form', { name: 'Add provider' });
  await providersForm.getByLabel('ID').fill('kbd-ollama');
  await providersForm.getByLabel('Base URL').fill('http://127.0.0.1:9/v1');
  await providersForm.getByRole('button', { name: 'Add provider' }).click();
  const providerRow = page.getByRole('row', { name: /kbd-ollama/ });
  await expect(providerRow.getByText('Bundled')).toBeVisible();

  // Reachability: Tab to the row's Refresh action (a real row-action button
  // in tab order, not a div with a click handler) and operate it with a key
  // press, not a click.
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  const refreshButton = providerRow.getByRole('button', { name: 'Refresh' });
  await tabUntilFocused(page, refreshButton);
  await page.keyboard.press('Enter');
  await expect(providerRow.getByText('Bundled')).toBeVisible();

  // Reachability + operability of the Model <select> itself: Tab reaches it
  // once the catalog is non-empty (UX_SPEC §9's "add/edit form is reachable
  // ... without a pointer"); `selectOption` (never `.click()`) is
  // Playwright's correct way to operate a native <select> once focus is
  // proven by real Tab presses — the same reasoning keyboard-only.spec.ts's
  // verb-menu test already records for why raw arrow-key simulation on a
  // closed native <select> isn't what WCAG 2.1.1 actually requires.
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  const matrixForm2 = page.getByRole('form', { name: 'Add matrix row' });
  await matrixForm2.getByLabel('Role').fill('coding-agent');
  const modelSelect = matrixForm2.getByLabel('Model');
  await expect(modelSelect).toBeEnabled();
  await tabUntilFocused(page, modelSelect);
  await modelSelect.selectOption('qwen2.5-coder');
  await expect(modelSelect).toHaveValue('qwen2.5-coder');

  const submitButton = matrixForm2.getByRole('button', { name: 'Add / update row' });
  await tabUntilFocused(page, submitButton);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('row', { name: /qwen2.5-coder/ })).toBeVisible();
});
