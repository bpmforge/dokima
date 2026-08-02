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
