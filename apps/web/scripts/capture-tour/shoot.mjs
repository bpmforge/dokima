/**
 * The screenshot + Settings-tab-sweep helpers shared by `light-pass.mjs`
 * and `dark-pass.mjs`. `ctx` (`{ tracker, steps, imgDir }`, built by
 * `index.mjs`) is threaded through explicitly rather than held as module
 * state so both passes can run against the tracker's single shared
 * denominator without importing each other.
 */
import path from 'node:path';
import { SETTINGS_TABS } from './declared-states.mjs';

/**
 * Screenshots the current page for declared state `id` — `dark/…` writes
 * under `img/dark/`, everything else writes flat under `img/` (matching
 * `README.md`'s and `RESUME_2026-08-02.md`'s existing links). `requireTestId`,
 * when given, is waited for first — for a state named "empty" this is the
 * actual emptiness assertion (W10-37 AC2): `fleet-empty`/`board-empty` only
 * exist in the DOM when the underlying list truly has zero items, so a
 * populated screen simply times out here instead of getting slugged as empty.
 */
export async function shoot(page, id, title, caption, requireTestId, ctx) {
  if (requireTestId) {
    await page.getByTestId(requireTestId).waitFor({ timeout: 5000 });
  }
  const isDark = id.startsWith('dark/');
  const file = `${isDark ? id.slice('dark/'.length) : id}.png`;
  const relPath = isDark ? path.join('dark', file) : file;
  // Let poll-driven fetches and CSS transitions settle before capturing.
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(ctx.imgDir, relPath), fullPage: false });
  ctx.tracker.capture(id);
  ctx.steps.push({ id, file: relPath, title, caption });
  console.log(`  [${id}] ${title}`);
}

export async function captureSettingsTabs(page, idPrefix, startIndex, ctx) {
  for (const [i, tab] of SETTINGS_TABS.entries()) {
    await page
      .locator('nav.settings__tabs')
      .getByRole('button', { name: tab.label, exact: true })
      .click();
    await shoot(
      page,
      `${idPrefix}${String(startIndex + i).padStart(2, '0')}-${tab.slug}`,
      `Settings — ${tab.label}`,
      `The **${tab.label}** tab of the Settings surface (UX_SPEC §6/§6a).`,
      tab.testId,
      ctx,
    );
  }
}
