import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

/** Agent roster & observability view (SRS FR-E2, R-K1) against the real apps/server + real content/experts tree. */

function freshProjectPath(): { dir: string; name: string } {
  const id = randomUUID();
  return {
    dir: path.join(os.tmpdir(), `shipwright-roster-e2e-${id}`),
    name: `Roster E2E ${id}`,
  };
}

test('Roster nav toggles the Agent Roster screen and back to Fleet', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Fleet' })).toBeVisible();

  await page.getByRole('button', { name: 'Roster', exact: true }).click();
  await expect(page.getByTestId('roster-view')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Agent Roster' })).toBeVisible();

  await page.getByRole('button', { name: '← Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Fleet' })).toBeVisible();
});

test('lists real content/experts grouped by cluster with an unconfigured model badge (no matrix seeded)', async ({
  page,
}) => {
  await page.goto('/?view=roster');
  await expect(page.getByTestId('roster-view')).toBeVisible();

  await expect(page.getByTestId('roster-cluster-coordinators')).toBeVisible();
  const sdlcLead = page.getByTestId('roster-expert-sdlc-lead');
  await expect(sdlcLead).toBeVisible();
  await expect(sdlcLead.getByTestId('roster-expert-scope-sdlc-lead')).toHaveText(
    'unconfigured',
  );
  await expect(
    sdlcLead.getByText('unconfigured — no routing matrix entry'),
  ).toBeVisible();
  await expect(sdlcLead.getByText('not benched')).toBeVisible();
});

test('expanding an expert with no open project prompts to open one for history', async ({
  page,
}) => {
  await page.goto('/?view=roster');
  const sdlcLead = page.getByTestId('roster-expert-sdlc-lead');
  await sdlcLead.getByRole('button').click();
  await expect(
    sdlcLead.getByText('Open a project to see per-agent history.'),
  ).toBeVisible();
});

test('per-agent history loads (zero counts, honest empty) when a project is open', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath();
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

  await page.getByRole('button', { name: 'Roster', exact: true }).click();
  await expect(page.getByTestId('roster-view')).toBeVisible();

  const sdlcLead = page.getByTestId('roster-expert-sdlc-lead');
  await sdlcLead.getByRole('button').click();
  const history = page.getByTestId('roster-history-sdlc-lead');
  await expect(history).toBeVisible();
  await expect(history).toContainText('0');

  await fs.rm(dir, { recursive: true, force: true });
});
