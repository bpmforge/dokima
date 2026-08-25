import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * The Team view (W20-02, UX_SPEC §10) against the real apps/server: the org
 * with faces (W20-01, D-028) and states derived only from real events.
 */

function freshProjectPath(): { dir: string; name: string } {
  const id = randomUUID();
  return {
    dir: path.join(os.tmpdir(), `dokima-team-e2e-${id}`),
    name: `Team E2E ${id}`,
  };
}

test('Team shows the org with real faces, and a fresh project reads as nothing assigned — never a flattering guess', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath();
  await page.goto('/');
  const header = page.locator('.fleet__header');
  await header.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByRole('button', { name: 'choose the location' }).click();
  await page.getByLabel('Folder').fill(dir);
  await page.getByLabel('Project name').fill(name);
  await page
    .locator('.fleet__form')
    .getByRole('button', { name: 'Create project' })
    .click();
  await expect(page.getByTestId('split-pane-workspace')).toBeVisible();

  await page.getByRole('button', { name: 'Team', exact: true }).click();
  await expect(page.getByTestId('team-view')).toBeVisible();

  // W20-01/D-028: the persona is served by the real roster route.
  const sam = page.getByTestId('team-member-coding-agent');
  await expect(sam).toBeVisible();
  await expect(sam.getByText('Sam')).toBeVisible();
  await expect(sam.getByText('Builds the tickets — the hands on the keyboard.')).toBeVisible();

  // A brand-new project has no events, so every state must be the honest one.
  await expect(page.getByTestId('team-state-coding-agent')).toHaveText('nothing assigned');
  await expect(sam).toHaveAttribute('data-state', 'idle');

  // Nothing is waiting on the founder yet, so no answer button exists at all.
  await expect(page.getByTestId('team-answer-coding-agent')).toHaveCount(0);

  await fs.rm(dir, { recursive: true, force: true });
});

test('the List view holds the same truth in words, and the choice sticks across a reload (§10a)', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath();
  await page.goto('/');
  const header = page.locator('.fleet__header');
  await header.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByRole('button', { name: 'choose the location' }).click();
  await page.getByLabel('Folder').fill(dir);
  await page.getByLabel('Project name').fill(name);
  await page
    .locator('.fleet__form')
    .getByRole('button', { name: 'Create project' })
    .click();
  await expect(page.getByTestId('split-pane-workspace')).toBeVisible();
  await page.getByRole('button', { name: 'Team', exact: true }).click();
  await expect(page.getByTestId('team-view')).toBeVisible();

  await page.getByTestId('team-mode-list').click();
  const list = page.getByTestId('team-list');
  await expect(list).toBeVisible();

  // A real table, not a canvas — the accessibility baseline (§10a).
  await expect(list.getByRole('table')).toBeVisible();
  await expect(list.getByRole('rowheader', { name: 'Sam' })).toBeVisible();
  await expect(list.getByRole('cell', { name: 'Nothing assigned' }).first()).toBeVisible();
  // Depth is the true count; a fresh project has nothing waiting.
  await expect(page.getByTestId('queue-empty')).toBeVisible();

  // The choice is per viewer and survives a reload.
  await page.reload();
  await expect(page.getByTestId('team-list')).toBeVisible();
  await expect(page.getByTestId('team-view')).toHaveCount(0);

  await page.getByTestId('team-mode-office').click();
  await expect(page.getByTestId('team-view')).toBeVisible();

  await fs.rm(dir, { recursive: true, force: true });
});
