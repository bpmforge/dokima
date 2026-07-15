import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

/** FR-F1/F2, UX_SPEC §2/§2b: create/open/archive/reopen through the real apps/server. */

function freshProjectPath(): { dir: string; name: string } {
  const id = randomUUID();
  return {
    dir: path.join(os.tmpdir(), `shipwright-fleet-e2e-${id}`),
    name: `Fleet E2E ${id}`,
  };
}

test('Fleet home renders the header actions (empty-state affordances, UX_SPEC §2b)', async ({
  page,
}) => {
  await page.goto('/');
  const header = page.locator('.fleet__header');
  await expect(page.getByRole('heading', { name: 'Fleet' })).toBeVisible();
  await expect(
    header.getByRole('button', { name: 'New Product', exact: true }),
  ).toBeVisible();
  await expect(
    header.getByRole('button', { name: 'Onboard existing repo', exact: true }),
  ).toBeVisible();
  await expect(header.getByRole('button', { name: 'Import', exact: true })).toBeVisible();
  await expect(page.getByLabel('Show archived')).toBeVisible();
});

test('create (New Product), open, archive, and reopen a project', async ({ page }) => {
  const { dir, name } = freshProjectPath();
  await page.goto('/');
  const header = page.locator('.fleet__header');

  await header.getByRole('button', { name: 'New Product', exact: true }).click();
  await page.getByLabel('Directory path').fill(dir);
  await page.getByLabel('Name (optional)').fill(name);
  await page.locator('.fleet__form').getByRole('button', { name: 'New Product' }).click();

  const card = page.locator('.project-card', { hasText: name });
  await expect(card).toBeVisible();
  await expect(card.getByText('Ready')).toBeVisible();

  // Archive: card leaves the active (default) list.
  await card.getByRole('button', { name: 'Archive' }).click();
  await expect(page.locator('.project-card', { hasText: name })).toHaveCount(0);

  // Archived filter: the card reappears with a Reopen action.
  await page.getByLabel('Show archived').check();
  const archivedCard = page.locator('.project-card', { hasText: name });
  await expect(archivedCard).toBeVisible();
  await expect(archivedCard.getByRole('button', { name: 'Reopen' })).toBeVisible();

  // Reopen: back under the active filter (G-10f, "nothing was deleted").
  await archivedCard.getByRole('button', { name: 'Reopen' }).click();
  await page.getByLabel('Show archived').uncheck();
  await expect(page.locator('.project-card', { hasText: name })).toBeVisible();
});

test('opening a project switches to its workspace; "Fleet" breadcrumb returns', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath();
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
  await expect(page).toHaveURL(/[?&]project=/);

  await page.getByRole('button', { name: '← Fleet' }).click();
  await expect(page.getByRole('heading', { name: 'Fleet' })).toBeVisible();

  // Leave the fixture archived rather than lingering in the active list across local re-runs.
  await page
    .locator('.project-card', { hasText: name })
    .getByRole('button', { name: 'Archive' })
    .click();
});
