import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { scanForA11yViolations } from './axeHelper.js';

/** Axe scan on the morning queue (docs/TESTING.md §7; UX_SPEC §9), non-empty (a real Decide card). */

function freshProjectPath(): { dir: string; name: string } {
  const id = randomUUID();
  return {
    dir: path.join(os.tmpdir(), `shipwright-a11y-queue-${id}`),
    name: `A11y Queue ${id}`,
  };
}

async function openFreshProject(page: Page, name: string, dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  await page.goto('/');
  const header = page.locator('.fleet__header');
  await header.getByRole('button', { name: 'New Product', exact: true }).click();
  await page.getByLabel('Directory path').fill(dir);
  await page.getByLabel('Name (optional)').fill(name);
  await page.locator('.fleet__form').getByRole('button', { name: 'New Product' }).click();
  const card = page.locator('.project-card', { hasText: name });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByTestId('split-pane-workspace')).toBeVisible();
  const projectId = new URL(page.url()).searchParams.get('project');
  if (!projectId) throw new Error('expected ?project= in the URL after opening');
  return projectId;
}

async function readToken(page: Page): Promise<string> {
  const token = await page.evaluate(
    () => (window as unknown as { __SHIPWRIGHT_TOKEN__?: string }).__SHIPWRIGHT_TOKEN__,
  );
  if (!token) throw new Error('expected window.__SHIPWRIGHT_TOKEN__ to be injected');
  return token;
}

test('morning queue has no WCAG 2.2 AA violations with a live Decide card', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath();
  const projectId = await openFreshProject(page, name, dir);
  const token = await readToken(page);

  const res = await page.request.post(`/api/v1/projects/${projectId}/notifications`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      tier: 'decide',
      kind: 'approval',
      title: 'Merge the a11y-gate branch',
      body: { diffStat: '+42 -1' },
    },
  });
  expect(res.ok()).toBe(true);
  const { id: notificationId } = (await res.json()) as { id: string };

  await page.goto('/?view=notifications');
  await expect(page.getByTestId('notifications-view')).toBeVisible();
  await page.getByTestId('notifications-project-filter').selectOption({ label: name });
  // Targets this run's own notification by id (not by title text) — a
  // long-lived dev `webServer` (`reuseExistingServer`) accumulates other
  // manual test runs' same-titled fixtures in the same persistent fleet
  // registry, so text alone isn't unique across invocations.
  await expect(page.getByTestId(`notification-${notificationId}`)).toBeVisible();

  const violations = await scanForA11yViolations(
    page,
    '[data-testid="notifications-view"]',
  );
  expect(violations).toEqual([]);

  await fs.rm(dir, { recursive: true, force: true });
});
