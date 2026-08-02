import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { scanForA11yViolations } from './axeHelper.js';

/** Axe scan on the receipt inspector (docs/TESTING.md §7; UX_SPEC §9), empty-state (UX_SPEC §2b: "No gates have run yet."). */

test('receipt inspector has no WCAG 2.2 AA violations', async ({ page }) => {
  const id = randomUUID();
  const dir = path.join(os.tmpdir(), `dokima-a11y-receipts-${id}`);
  const name = `A11y Receipts ${id}`;
  await fs.mkdir(dir, { recursive: true });

  await page.goto('/');
  const header = page.locator('.fleet__header');
  await header
    .getByRole('button', { name: 'Onboard existing repo', exact: true })
    .click();
  await page.getByLabel('Directory path').fill(dir);
  await page.getByLabel('Name (optional)').fill(name);
  await page
    .locator('.fleet__form')
    .getByRole('button', { name: 'Onboard existing repo' })
    .click();
  const card = page.locator('.project-card', { hasText: name });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByTestId('split-pane-workspace')).toBeVisible();

  const artifactsPane = page.getByTestId('pane-artifacts');
  await artifactsPane.getByRole('button', { name: 'Receipts' }).click();
  await expect(artifactsPane.getByText('No gates have run yet.')).toBeVisible();

  const violations = await scanForA11yViolations(page, '[data-testid="pane-artifacts"]');
  expect(violations).toEqual([]);

  await fs.rm(dir, { recursive: true, force: true });
});
