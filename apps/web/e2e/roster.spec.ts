import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { removeTempProject } from './temp-project.js';

/** Agent roster & observability view (SRS FR-E2, R-K1) against the real apps/server + real content/experts tree. */

function freshProjectPath(): { dir: string; name: string } {
  const id = randomUUID();
  return {
    dir: path.join(os.tmpdir(), `dokima-roster-e2e-${id}`),
    name: `Roster E2E ${id}`,
  };
}

test('Roster nav toggles the Agent Roster screen and back to Fleet', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Fleet' })).toBeVisible();

  await page.getByRole('button', { name: 'Roster', exact: true }).click();
  await expect(page.getByTestId('roster-view')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Agent Roster' })).toBeVisible();

  // W13-01: no more "← Back" — the main surface is a destination like any
  // other, so you return to it by choosing it. Label is Fleet with no
  // project open, Board with one.
  await page.getByRole('button', { name: 'Fleet', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Fleet' })).toBeVisible();
});

test('lists real content/experts grouped by cluster; a role with no model gets an ACTION, not a diagnosis (W13-49)', async ({
  page,
}) => {
  await page.goto('/?view=roster');
  await expect(page.getByTestId('roster-view')).toBeVisible();

  await expect(page.getByTestId('roster-cluster-coordinators')).toBeVisible();
  const sdlcLead = page.getByTestId('roster-expert-sdlc-lead');
  await expect(sdlcLead).toBeVisible();
  // W13-49 (UX_AUDIT A-1): the old row said "unconfigured — no routing
  // matrix entry" / "not benched" / "instruction cost: —" on every card of a
  // healthy install — builder diagnostics shipped to the user. Now: one
  // actionable sentence, pointing at a tab that exists (validate-ui-copy
  // guards the pointer), and silence where there is nothing to act on.
  await expect(sdlcLead.getByTestId('roster-expert-scope-sdlc-lead')).toHaveText(
    'needs a model',
  );
  // W21-04: the explanation moved off the row and is stated once for the
  // page, with a count — 85 verbatim copies buried the fact they reported.
  // The row keeps the chip, which is the per-role, actionable part.
  await expect(sdlcLead.getByText(/pick models in Settings/)).toHaveCount(0);
  await expect(page.getByTestId('roster-needs-models')).toContainText(
    'Settings → Models',
  );
  await expect(page.getByTestId('roster-needs-models')).toContainText(/\d+ of \d+ roles/);
  await expect(sdlcLead.getByText('not benched')).toHaveCount(0);
  await expect(sdlcLead.getByText(/routing matrix/)).toHaveCount(0);
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
  await header.getByRole('button', { name: 'New project', exact: true }).click();
  // W12-41: New project asks only for a name now — the server creates
  // the folder. These specs need a controlled tmpdir, so they take the
  // explicit-location escape, which also keeps that path covered.
  await page.getByRole('button', { name: 'choose the location' }).click();
  await page.getByLabel('Folder').fill(dir);
  await page.getByLabel('Project name').fill(name);
  await page.locator('.fleet__form').getByRole('button', { name: 'Create project' }).click();
  // W17-09: creating a project auto-opens it — the workspace, not the grid.
  await expect(page.getByTestId('split-pane-workspace')).toBeVisible();

  await page.getByRole('button', { name: 'Roster', exact: true }).click();
  await expect(page.getByTestId('roster-view')).toBeVisible();

  const sdlcLead = page.getByTestId('roster-expert-sdlc-lead');
  await sdlcLead.getByRole('button').click();
  const history = page.getByTestId('roster-history-sdlc-lead');
  await expect(history).toBeVisible();
  await expect(history).toContainText('0');

  await removeTempProject(dir);
});
