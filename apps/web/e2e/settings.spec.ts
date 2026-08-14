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

/** Extracts the injected bearer token from the served shell HTML (repeated per-file boilerplate — see a11y/settings.spec.ts's own copy). */
async function fetchDokimaToken(
  api: import('@playwright/test').APIRequestContext,
): Promise<string | undefined> {
  const tokenRes = await api.get('/');
  const html = await tokenRes.text();
  const tokenMatch = /__DOKIMA_TOKEN__=("(?:[^"\\]|\\.)*")/.exec(html);
  return tokenMatch ? (JSON.parse(tokenMatch[1]!) as string) : undefined;
}

test.beforeAll(async ({ baseURL }) => {
  const api = await request.newContext({ baseURL });
  const token = await fetchDokimaToken(api);

  const dir = path.join(os.tmpdir(), `dokima-settings-e2e-${randomUUID()}`);
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
  // W12-13/D-024: step 1 no longer preselects anything and Next stays
  // disabled until a choice is made, so this click is now load-bearing
  // rather than cosmetic. 'Start cheap, escalate' maps to the same
  // `hybrid` matrix preset the old /Hybrid/ label selected.
  await page.getByLabel(/Start cheap, escalate/).check();
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

test('model matrix: pick a model from the provider-discovered list, and a copilot/-prefixed model is flagged (W10-04 AC1)', async ({
  page,
  baseURL,
}) => {
  // Copilot's catalog isn't discoverable yet — buildCatalogProvider
  // (apps/server/.../providers-routes.ts) has no 'copilot' case, so a
  // copilot/-backed row can't be produced through the select-driven picker
  // today (UX_SPEC §6a "Cloud kind selected"). Seed it directly through the
  // real model-matrix API instead: matrix-routes.ts's PUT is an upsert
  // (model-matrix-store.ts, PK role+task_type), so it coexists with the row
  // the UI adds below, and this still proves the copilot_backed flag —
  // server-driven, unrelated to how a row was created — renders correctly.
  const api = await request.newContext({ baseURL });
  const token = await fetchDokimaToken(api);
  await api.put(`/api/v1/projects/${projectId}/model-matrix`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { rows: [{ role: 'challenger', task_type: 'code', model: 'copilot/gpt-4' }] },
  });
  await api.dispose();

  await openProjectSettings(page);
  await expect(page.getByTestId('model-matrix-panel')).toBeVisible();
  const copilotRow = page.getByRole('row', { name: /challenger/ });
  await expect(copilotRow.getByText('Copilot-backed')).toBeVisible();

  // Register a provider so the Model field has a real, list-backed catalog
  // to pick from (AC1: no free text). A closed port (9, "discard") fails
  // fast and deterministically, falling back to the bundled offline catalog
  // (content/model-catalog/catalog.v1.json's 'ollama' entries) — never a
  // live network call (Law 9), and never the machine's real Ollama/LM
  // Studio install on the default ports this test must not depend on.
  const providersForm = page.getByRole('form', { name: 'Add provider' });
  await providersForm.getByLabel('ID').fill('ollama-e2e');
  await providersForm.getByLabel('Base URL').fill('http://127.0.0.1:9/v1');
  await providersForm.getByRole('button', { name: 'Add provider' }).click();

  const providerRow = page.getByRole('row', { name: /ollama-e2e/ });
  await expect(providerRow.getByText('Bundled')).toBeVisible();

  const matrixForm = page.getByRole('form', { name: 'Add matrix row' });
  await matrixForm.getByLabel('Role').fill('coding-agent');
  const modelSelect = matrixForm.getByLabel('Model');
  await expect(modelSelect).toBeEnabled();
  await modelSelect.selectOption('qwen2.5-coder');
  await matrixForm.getByRole('button', { name: 'Add / update row' }).click();
  await expect(page.getByRole('row', { name: /coding-agent/ })).toContainText(
    'qwen2.5-coder',
  );
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

test('agent runner: switching to an external CLI persists through the real confirm gate (W11-23)', async ({
  page,
}) => {
  // W11-23: the ONLY check that sees both halves of the W11-20 confirmation
  // contract. `AGENT_RUNNER_CONFIRM_FIELD` is declared twice and
  // independently — `apps/web/src/settings/api.ts` exports it, and
  // `scope-routes.ts` keeps its own module-private const — and Law 6 forbids
  // either app importing the other, so no unit test can compare them. The
  // existing `api.test.ts` case asserts the web constant against its own
  // adjacent literal, which re-checks the web copy against itself.
  //
  // Rename the server side (const + the three literals in its own suite) and
  // every unit test stays green while the panel's PUT is 403'd by the gate
  // W11-20 built — i.e. the operator can no longer choose an external runner
  // at all. Verified as the ticket's red fixture: that rename turns THIS test
  // red and leaves `pnpm test` fully green.
  //
  // Asserting after a reload is what makes it a contract test rather than a
  // UI test: `agent-runner-current` renders component state, which reads
  // 'external' even when the save was refused, so only re-reading from the
  // server distinguishes persisted from merely typed.
  const command = 'echo dokima-e2e-runner';
  await openProjectSettings(page);
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page.getByTestId('agent-runner-panel')).toBeVisible();

  // Role locators, not getByLabel: these <label>s WRAP their control, so the
  // label's text content includes the option text and an exact getByLabel can
  // never match, while a substring one matches three elements. The computed
  // accessible name is just 'Runner'/'Command'.
  const runnerForm = page.getByRole('form', { name: 'Set agent runner' });
  await runnerForm.getByRole('combobox', { name: 'Runner' }).selectOption('external');
  await runnerForm.getByRole('textbox', { name: 'Command' }).fill(command);
  await expect(page.getByTestId('external-agent-warning')).toBeVisible();
  // Assert the gate's own verdict, not just the end state: a 403 here is
  // precisely the drift this test exists to catch, and waiting for the
  // response also stops the reload below racing the in-flight PUT.
  const savePut = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().includes('/settings'),
  );
  await runnerForm.getByRole('button', { name: 'Save agent runner' }).click();
  expect((await savePut).status()).toBe(200);

  await openProjectSettings(page);
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page.getByTestId('agent-runner-current')).toContainText('external');
  await expect(page.getByTestId('agent-runner-current')).toContainText(command);

  // Revert, which also exercises the other half of the gate: returning to the
  // built-in default is never confirmation-gated, so this save needs no flag.
  const revertForm = page.getByRole('form', { name: 'Set agent runner' });
  await revertForm.getByRole('combobox', { name: 'Runner' }).selectOption('built-in');
  const revertPut = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().includes('/settings'),
  );
  await revertForm.getByRole('button', { name: 'Save agent runner' }).click();
  expect((await revertPut).status()).toBe(200);
  await openProjectSettings(page);
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page.getByTestId('agent-runner-current')).toContainText('built-in');
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
