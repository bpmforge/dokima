/**
 * The screenshot + Settings-tab-sweep helpers shared by `light-pass.mjs`
 * and `dark-pass.mjs`. `ctx` (`{ tracker, steps, imgDir }`, built by
 * `index.mjs`) is threaded through explicitly rather than held as module
 * state so both passes can run against the tracker's single shared
 * denominator without importing each other.
 */
import path from 'node:path';
import { SETTINGS_TABS } from './declared-states.mjs';
import { collectEvidence, writeEvidence } from './evidence.mjs';

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
  // W13-54: the same state, serialized as TEXT — strings, controls,
  // geometry — so a model without vision can judge what this frame shows.
  await writeEvidence(ctx.imgDir, relPath, await collectEvidence(page));
  ctx.tracker.capture(id);
  ctx.steps.push({ id, file: relPath, title, caption });
  console.log(`  [${id}] ${title}`);
}

/**
 * W17-08 split the Settings nav into four BASIC tabs and an `Advanced ▸`
 * disclosure holding the other ten. The sweep walks every declared tab, so it
 * opens the disclosure first — before this, it clicked a tab that was not in
 * the DOM and hung for 30s on `Cost Estimate`, the first advanced one.
 * Idempotent: `aria-expanded` is read rather than toggled blindly, so calling
 * it on an already-open nav does not close it.
 */
async function revealAdvancedTabs(page) {
  const toggle = page.getByTestId('settings-advanced-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

export async function captureSettingsTabs(page, idPrefix, startIndex, ctx) {
  await revealAdvancedTabs(page);
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
