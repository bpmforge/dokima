import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { expect, request, test } from '@playwright/test';
import { withProjectRegistryLock } from '../fixtures/project-registry-lock.js';
import { scanForA11yViolations } from './axeHelper.js';

/** Axe scan on the settings matrix (docs/TESTING.md §7; UX_SPEC §9). Same setup as settings.spec.ts. */

test('settings page has no WCAG 2.2 AA violations', async ({ page, baseURL }) => {
  const api = await request.newContext({ baseURL });
  const tokenRes = await api.get('/');
  const html = await tokenRes.text();
  const tokenMatch = /__DOKIMA_TOKEN__=("(?:[^"\\]|\\.)*")/.exec(html);
  const token = tokenMatch ? (JSON.parse(tokenMatch[1]!) as string) : undefined;

  const dir = path.join(os.tmpdir(), `dokima-a11y-settings-${randomUUID()}`);
  const created = await withProjectRegistryLock(async () => {
    const res = await api.post('/api/v1/projects', {
      headers: { Authorization: `Bearer ${token}` },
      data: { path: dir, mode: 'new', name: `A11y Settings ${randomUUID()}` },
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

  const dir = path.join(os.tmpdir(), `dokima-a11y-settings-populated-${randomUUID()}`);
  const created = await withProjectRegistryLock(async () => {
    const res = await api.post('/api/v1/projects', {
      headers: { Authorization: `Bearer ${token}` },
      data: { path: dir, mode: 'new', name: `A11y Settings Populated ${randomUUID()}` },
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

  const matrixForm = page.getByRole('form', { name: 'Add matrix row' });
  await matrixForm.getByLabel('Role').fill('coding-agent');
  await expect(matrixForm.getByLabel('Model')).toBeEnabled();
  await matrixForm.getByLabel('Model').selectOption('qwen2.5-coder');
  await matrixForm.getByRole('button', { name: 'Add / update row' }).click();
  await expect(page.getByRole('row', { name: /coding-agent/ })).toBeVisible();

  const violations = await scanForA11yViolations(page, '[data-testid="settings-page"]');
  expect(violations).toEqual([]);
});
