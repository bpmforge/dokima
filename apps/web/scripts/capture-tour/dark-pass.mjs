/**
 * The dark-theme pass: a second, fully independent fresh app instance
 * (`img/dark/`) — never a theme re-toggle onto the light pass's
 * already-populated app, which is exactly how `dark/01-fleet-empty` and
 * `dark/04-workspace-empty` got mis-slugged (W10-37).
 */
import { captureSettingsTabs, shoot } from './shoot.mjs';

export async function runDarkPass(browser, app, ctx) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });

  await page.goto(app.base);
  await page.getByRole('heading', { name: 'Fleet' }).waitFor();
  await shoot(
    page,
    'dark/01-fleet-empty',
    'Fleet home, dark theme (first launch)',
    'The same first-launch emptiness as the light pass, verified independently in dark theme against its own fresh app instance — never a re-toggle onto an already-populated app.',
    'fleet-empty',
    ctx,
  );

  await page
    .locator('.fleet__header')
    .getByRole('button', { name: 'New project', exact: true })
    .click();
  // W12-41 flow: New project asks only a name; the tour takes the
  // explicit-location escape (same as roster.spec.ts) so its throwaway
  // projectDir is used.
  await page.getByRole('button', { name: 'choose the location' }).click();
  await page.getByLabel('Folder').fill(app.projectDir);
  await page.getByLabel('Project name').fill('Demo Voyage');
  await page.locator('.fleet__form').getByRole('button', { name: 'Create project' }).click();
  await page.locator('.project-card', { hasText: 'Demo Voyage' }).waitFor();
  await page
    .locator('.project-card', { hasText: 'Demo Voyage' })
    .getByRole('button', { name: 'Open' })
    .click();
  await page.getByTestId('split-pane-workspace').waitFor();
  const projectId = new URL(page.url()).searchParams.get('project');
  await shoot(
    page,
    'dark/02-workspace-empty',
    'Project workspace, dark theme (unseeded)',
    'The board pane genuinely empty in dark theme — the state that got mis-slugged in the earlier ad-hoc sweep.',
    'board-empty',
    ctx,
  );

  await page.goto(`${app.base}/?project=${projectId}&view=settings`);
  await page.getByTestId('settings-page').waitFor();
  await captureSettingsTabs(page, 'dark/', 3, ctx);
}
