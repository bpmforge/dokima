/**
 * W21-92 — the capture tour's own assumptions, asserted inside the gate.
 *
 * The tour (apps/web/scripts/capture-tour/) drives the real product and writes
 * docs/tour/, which README.md links into. It is layer 1 of
 * DESIGN_REVIEW_LOOP.md: the evidence packs the ux-audit judge reads come from
 * there, so when the tour is dead the whole review loop is dead and reports
 * nothing rather than failing.
 *
 * It ran in NO gate, and rotted for a whole wave. Found 2026-08-28, both
 * breaks caused by shipped behaviour the tour was never updated for:
 *
 *   - W17-09 made creating a project AUTO-OPEN its workspace. Both tour passes
 *     still waited on the Fleet card that is no longer on screen and hung 30s
 *     at step 3 of 39. `fleet.spec.ts` had been updated; the tour had not.
 *   - W17-08 split the Settings nav into four basic tabs and an `Advanced`
 *     disclosure holding the other ten. The sweep clicked `Cost Estimate`, the
 *     first advanced tab, and hung.
 *
 * This file asserts those two contracts against the same DECLARED_STATES list
 * the tour walks, so the next such change fails here — in a suite Law 3
 * already runs — instead of silently rotting until somebody runs the tour by
 * hand. It deliberately does NOT re-run the 39-state capture: that rebuilds the
 * SPA and boots two servers, and the acceptance asks for a smoke short of it.
 */
import { expect, test } from '@playwright/test';
// The tour's OWN list — importing it is the point. A tab added there without a
// matching surface fails here rather than at capture time.
import { SETTINGS_TABS } from '../scripts/capture-tour/declared-states.mjs';
import { withProjectRegistryLock } from './fixtures/project-registry-lock.js';
import { freshProjectPath as newTempProject } from './temp-project.js';

test('every Settings tab the tour declares is reachable, and names itself when it is not', async ({
  page,
}) => {
  // A project must be OPEN: with none, SettingsPage renders its no-project
  // state and the tab nav does not exist at all. The tour reaches Settings
  // from inside a project, so the contract is only meaningful there.
  const { dir, name } = newTempProject('tour-tabs');
  await page.goto('/');
  await page.locator('.fleet__header').getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByRole('button', { name: 'choose the location' }).click();
  await page.getByLabel('Folder').fill(dir);
  await page.getByLabel('Project name').fill(name);
  await withProjectRegistryLock(async () => {
    await page.locator('.fleet__form').getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByTestId('split-pane-workspace')).toBeVisible({ timeout: 30_000 });
  });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByTestId('settings-page')).toBeVisible();

  // W17-08: ten of the fourteen tabs live behind this disclosure. The tour
  // clicked straight through and hung; opening it is now part of the contract.
  const advanced = page.getByTestId('settings-advanced-toggle');
  await expect(
    advanced,
    'the Advanced disclosure the tour depends on is gone — capture-tour/shoot.mjs opens it',
  ).toBeVisible();
  if ((await advanced.getAttribute('aria-expanded')) !== 'true') await advanced.click();

  for (const tab of SETTINGS_TABS) {
    const button = page.locator('nav.settings__tabs').getByRole('button', {
      name: tab.label,
      exact: true,
    });
    await expect(
      button,
      `Settings tab "${tab.label}" is declared by the tour but not in the nav`,
    ).toBeVisible();
    await button.click();
    await expect(
      page.getByTestId(tab.testId),
      `Settings tab "${tab.label}" no longer reveals [data-testid="${tab.testId}"]`,
    ).toBeVisible();
  }
});

test('creating a project auto-opens its workspace — the flow the tour walks', async ({ page }) => {
  const { dir, name } = newTempProject('tour-contract');
  await page.goto('/');
  await page.locator('.fleet__header').getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByRole('button', { name: 'choose the location' }).click();
  await page.getByLabel('Folder').fill(dir);
  await page.getByLabel('Project name').fill(name);

  await withProjectRegistryLock(async () => {
    await page.locator('.fleet__form').getByRole('button', { name: 'Create project' }).click();
    // W17-09. If this stops holding, light-pass.mjs and dark-pass.mjs both hang
    // for 30s on a Fleet card that is not on screen — which is exactly what
    // happened, unnoticed, for a whole wave.
    await expect(
      page.getByTestId('split-pane-workspace'),
      'creating a project no longer auto-opens the workspace — capture-tour assumes it does',
    ).toBeVisible({ timeout: 30_000 });
  });

  // And the way back the tour takes to photograph the Fleet card.
  await page.getByRole('button', { name: '← Fleet' }).click();
  await expect(page.locator('.project-card', { hasText: name })).toBeVisible();
});
