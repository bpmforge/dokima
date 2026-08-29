import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { withProjectRegistryLock } from './fixtures/project-registry-lock.js';
import { freshProjectPath as newTempProject } from './temp-project.js';

/** FR-F1/F2, UX_SPEC §2/§2b: create/open/archive/reopen through the real apps/server. */

/** This suite's label bound to the shared helper (W22-15) — the uniform
 * `dokima-<label>-e2e-<uuid>` name is what global-teardown removes. */
function freshProjectPath(): { dir: string; name: string } {
  return newTempProject('fleet');
}

test('Fleet home renders the header actions (empty-state affordances, UX_SPEC §2b)', async ({
  page,
}) => {
  await page.goto('/');
  const header = page.locator('.fleet__header');
  await expect(page.getByRole('heading', { name: 'Fleet' })).toBeVisible();
  await expect(
    header.getByRole('button', { name: 'New project', exact: true }),
  ).toBeVisible();
  await expect(
    header.getByRole('button', { name: 'Onboard existing repo', exact: true }),
  ).toBeVisible();
  await expect(header.getByRole('button', { name: 'Import', exact: true })).toBeVisible();
  await expect(page.getByLabel('Show archived')).toBeVisible();
});

test('create (New project), open, archive, and reopen a project', async ({ page }) => {
  const { dir, name } = freshProjectPath();
  await page.goto('/');
  const header = page.locator('.fleet__header');

  await header.getByRole('button', { name: 'New project', exact: true }).click();
  // W12-41: New project asks only for a name now — the server creates
  // the folder. These specs need a controlled tmpdir, so they take the
  // explicit-location escape, which also keeps that path covered.
  await page.getByRole('button', { name: 'choose the location' }).click();
  await page.getByLabel('Folder').fill(dir);
  await page.getByLabel('Project name').fill(name);
  // See project-registry-lock.ts's header: fleet.json's read-modify-write
  // has no locking server-side, so concurrent creates from other e2e worker
  // processes can clobber this one — serialized here across every worker.
  await withProjectRegistryLock(async () => {
    await page
      .locator('.fleet__form')
      .getByRole('button', { name: 'Create project' })
      .click();
    // W17-09: creating a project auto-opens its workspace.
    await expect(page.getByTestId('split-pane-workspace')).toBeVisible();
  });

  await page.getByRole('button', { name: '← Fleet' }).click();
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
  await withProjectRegistryLock(async () => {
    await page
      .locator('.fleet__form')
      .getByRole('button', { name: 'Onboard existing repo' })
      .click();
    // W17-09: onboarding auto-opens the workspace too.
    await expect(page.getByTestId('split-pane-workspace')).toBeVisible();
  });
  await expect(page).toHaveURL(/[?&]project=/);

  await page.getByRole('button', { name: '← Fleet' }).click();
  await expect(page.getByRole('heading', { name: 'Fleet' })).toBeVisible();

  // Leave the fixture archived rather than lingering in the active list across local re-runs.
  await page
    .locator('.project-card', { hasText: name })
    .getByRole('button', { name: 'Archive' })
    .click();
});

test('W9-15: a project whose directory vanished shows as unavailable, and Remove forgets it without deleting a live project', async ({
  page,
}) => {
  const gone = freshProjectPath();
  const kept = freshProjectPath();
  await page.goto('/');
  const header = page.locator('.fleet__header');

  // Two real projects through the real UI, so the registry is genuine.
  for (const p of [gone, kept]) {
    await header.getByRole('button', { name: 'New project', exact: true }).click();
    // W12-41: New project asks only for a name now — the server creates
    // the folder. These specs need a controlled tmpdir, so they take the
    // explicit-location escape, which also keeps that path covered.
    await page.getByRole('button', { name: 'choose the location' }).click();
    await page.getByLabel('Folder').fill(p.dir);
    await page.getByLabel('Project name').fill(p.name);
    await withProjectRegistryLock(async () => {
      await page
        .locator('.fleet__form')
        .getByRole('button', { name: 'Create project' })
        .click();
      // W17-09: creation auto-opens the workspace; return for the next one.
      await expect(page.getByTestId('split-pane-workspace')).toBeVisible();
    });
    await page.getByRole('button', { name: '← Fleet' }).click();
    await expect(page.locator('.project-card', { hasText: p.name })).toBeVisible();
  }

  // Delete one project's directory out from under the Fleet.
  await fs.rm(gone.dir, { recursive: true, force: true });
  await page.reload();

  // It must NOT render as an ordinary card with zeroed counters — that is
  // indistinguishable from a real empty project (the honest-absence rule).
  const goneCard = page.locator('.project-card', { hasText: gone.name });
  await expect(goneCard).toHaveAttribute('data-unavailable', 'true');
  await expect(goneCard.getByText('Unavailable')).toBeVisible();
  await expect(goneCard.getByText('Ready')).toHaveCount(0);
  await expect(goneCard.getByRole('button', { name: 'Open' })).toHaveCount(0);

  // The healthy one is still an ordinary card.
  const keptCard = page.locator('.project-card', { hasText: kept.name });
  await expect(keptCard).not.toHaveAttribute('data-unavailable', 'true');
  await expect(keptCard.getByText('Ready')).toBeVisible();

  await withProjectRegistryLock(async () => {
    await goneCard.getByRole('button', { name: 'Remove from Fleet' }).click();
    await expect(page.locator('.project-card', { hasText: gone.name })).toHaveCount(0);
  });

  // The sharp edge, asserted against the filesystem: removing one entry must
  // never touch the OTHER project's directory or its state.db.
  await expect(page.locator('.project-card', { hasText: kept.name })).toBeVisible();
  await expect(fs.stat(kept.dir)).resolves.toBeDefined();
  await expect(fs.stat(path.join(kept.dir, '.dokima', 'state.db'))).resolves.toBeDefined();

  await fs.rm(kept.dir, { recursive: true, force: true });
});
