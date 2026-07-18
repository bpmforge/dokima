import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { expect, request, test } from '@playwright/test';
import { withProjectRegistryLock } from './fixtures/project-registry-lock.js';

/**
 * W4-06: settings UI driven end-to-end through the real apps/server. One
 * project is created up front here and reused by every test in this file
 * (instead of one create per test, per fleet.spec.ts's own pattern) —
 * project-registry-lock.ts's header explains why creates are serialized
 * across every e2e worker in the first place.
 */

let projectId: string;

test.beforeAll(async ({ baseURL }) => {
  const api = await request.newContext({ baseURL });
  const tokenRes = await api.get('/');
  const html = await tokenRes.text();
  const tokenMatch = /__SHIPWRIGHT_TOKEN__=("(?:[^"\\]|\\.)*")/.exec(html);
  const token = tokenMatch ? (JSON.parse(tokenMatch[1]!) as string) : undefined;

  const dir = path.join(os.tmpdir(), `shipwright-settings-e2e-${randomUUID()}`);
  const created = await withProjectRegistryLock(async () => {
    const res = await api.post('/api/v1/projects', {
      headers: { Authorization: `Bearer ${token}` },
      data: { path: dir, mode: 'new', name: `Settings E2E ${randomUUID()}` },
    });
    return (await res.json()) as { id: string };
  });
  projectId = created.id;
  await api.dispose();
});

async function openProjectSettings(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`/?project=${projectId}&view=settings`);
  await expect(page.getByTestId('settings-page')).toBeVisible();
}

test('Settings with no project open shows the no-project state and a wizard entry', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByTestId('settings-page')).toBeVisible();
  await expect(page.getByText('Open a project to configure')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run Setup Wizard' })).toBeVisible();
});

test('first-run wizard: preset -> provider -> forge (skip) -> sample creates a real project (FR-S4)', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Run Setup Wizard' }).click();
  await expect(page.getByTestId('first-run-wizard')).toBeVisible();

  await expect(page.getByTestId('wizard-step-preset')).toBeVisible();
  await page.getByLabel(/Hybrid/).check();
  await page
    .getByTestId('wizard-step-preset')
    .getByRole('button', { name: 'Next' })
    .click();

  await expect(page.getByTestId('wizard-step-provider')).toBeVisible();
  await page
    .getByTestId('wizard-step-provider')
    .getByRole('button', { name: 'Next' })
    .click();

  await expect(page.getByTestId('wizard-step-forge')).toBeVisible();
  await page
    .getByTestId('wizard-step-forge')
    .getByRole('button', { name: 'Skip' })
    .click();

  await expect(page.getByTestId('wizard-step-sample')).toBeVisible();
  await page.getByRole('button', { name: 'Create sample project' }).click();

  await expect(page.getByTestId('wizard-step-done')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('split-pane-workspace')).toBeVisible();
});

test('model matrix: add a row, and a copilot/-prefixed model is flagged', async ({
  page,
}) => {
  await openProjectSettings(page);
  await expect(page.getByTestId('model-matrix-panel')).toBeVisible();

  const form = page.getByRole('form', { name: 'Add matrix row' });
  await form.getByLabel('Role').fill('coding-agent');
  await form.getByLabel('Model').fill('local/qwen2.5-coder');
  await form.getByRole('button', { name: 'Add / update row' }).click();
  await expect(page.getByRole('row', { name: /coding-agent/ })).toBeVisible();

  await form.getByLabel('Role').fill('challenger');
  await form.getByLabel('Model').fill('copilot/gpt-4');
  await form.getByRole('button', { name: 'Add / update row' }).click();
  const copilotRow = page.getByRole('row', { name: /challenger/ });
  await expect(copilotRow.getByText('Copilot-backed')).toBeVisible();
});

test('autonomy dial always shows the immutable NEVER-AUTO list', async ({ page }) => {
  await openProjectSettings(page);
  await page.getByRole('button', { name: 'Autonomy · Budget · Berths' }).click();
  await expect(page.getByTestId('never-auto-list')).toBeVisible();
  await expect(page.getByTestId('never-auto-list')).toContainText('Merges to main');

  await page.getByLabel('Auto — documented defaults taken and ledgered').click();
  await expect(
    page.getByLabel('Auto — documented defaults taken and ledgered'),
  ).toBeChecked();
  await page.reload();
  await page.getByRole('button', { name: 'Autonomy · Budget · Berths' }).click();
  await expect(
    page.getByLabel('Auto — documented defaults taken and ledgered'),
  ).toBeChecked();
});

test('rule lifecycle: register, promote twice, then a data-gated promotion is refused', async ({
  page,
}) => {
  await openProjectSettings(page);
  await page.getByRole('button', { name: 'Rule Lifecycle' }).click();

  const form = page.getByRole('form', { name: 'Register rule' });
  await form.getByLabel('Rule id').fill('R-e2e');
  await form.getByRole('button', { name: /Register rule/ }).click();
  await expect(page.getByRole('row', { name: /R-e2e/ })).toContainText('proposed');

  const row = page.getByRole('row', { name: /R-e2e/ });
  await row.getByRole('button', { name: 'Promote' }).click();
  await expect(row).toContainText('shadow');
  await row.getByRole('button', { name: 'Promote' }).click();
  await expect(row).toContainText('advisory');
  await row.getByRole('button', { name: 'Promote' }).click();
  // advisory -> gate is data-gated (D-014); a fresh rule has 0 sampled findings, so it's refused
  // with the counts shown (FR-RL2), not silently promoted.
  await expect(row).toContainText('advisory');
  await expect(page.getByRole('alert')).toContainText('needs >= 20');
});

test('Copilot consent: default-off with the account-risk warning, enabling requires the checkbox', async ({
  page,
}) => {
  await openProjectSettings(page);
  await page.getByRole('button', { name: 'Copilot' }).click();
  await expect(page.getByTestId('copilot-warning')).toContainText('ban');
  await expect(page.getByText('disabled (default)')).toBeVisible();

  await page.getByTestId('copilot-acknowledge-checkbox').check();
  await expect(page.getByText('enabled', { exact: true })).toBeVisible();
});
