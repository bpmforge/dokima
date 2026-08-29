import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { freshProjectPath, removeTempProject } from './temp-project.js';

/**
 * Dry-run estimate / escalation-ROI / weekly digest (BLUEPRINT §12.2,
 * FR-G7, US-307/309) against the real apps/server — same discipline as
 * board.spec.ts (real REST fetch, real seeded ticket events, not a mocked
 * browser API).
 *
 * `EstimateWorkspace` now mounts under the Settings Matrix's "Cost
 * Estimate" tab (W4-06, SettingsPage.tsx) — its real, spec'd home
 * (UX_SPEC §6) now that the Settings Matrix exists, replacing the
 * `pane-artifacts` stopgap W4-05 evicted it from.
 */
test.use({ viewport: { width: 2400, height: 1000 } });

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const TSX_BIN = path.join(repoRoot, 'apps', 'server', 'node_modules', '.bin', 'tsx');
const SEED_SCRIPT = path.join(here, 'fixtures', 'seed-board-tickets.mjs');


function seed(dbPath: string, scenario: string): void {
  execFileSync(TSX_BIN, [SEED_SCRIPT, dbPath, scenario], { stdio: 'inherit' });
}

/** Registers ("Onboard existing repo") a project via the real Fleet UI, opens it, then opens the Settings Matrix's "Cost Estimate" tab. */
async function openEstimateTab(page: Page, name: string, dir: string): Promise<void> {
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
  // W17-09: creating a project auto-opens it — the workspace, not the grid.
  await expect(page.getByTestId('split-pane-workspace')).toBeVisible();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByTestId('settings-page')).toBeVisible();
  await page.getByTestId('settings-advanced-toggle').click();
  await page
    .locator('nav.settings__tabs')
    .getByRole('button', { name: 'Cost Estimate' })
    .click();
}

test('empty board yields an honest empty estimate, not a fabricated total', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath('estimate');
  await openEstimateTab(page, name, dir);

  const workspace = page.getByTestId('estimate-workspace');
  await expect(workspace.getByTestId('estimate-empty')).toBeVisible();

  // W22-12: this suite created a temp project and never removed it —
  // it was absent from the ENOTEMPTY report because it leaked instead
  // of racing. Every run left a directory behind.
  await removeTempProject(dir);
});

test('real board tickets drive a per-wave breakdown, and what-if recomputes deterministically (FR-G7)', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath('estimate');
  await openEstimateTab(page, name, dir);
  seed(path.join(dir, '.dokima', 'state.db'), 'basic');
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByTestId('settings-advanced-toggle').click();
  await page
    .locator('nav.settings__tabs')
    .getByRole('button', { name: 'Cost Estimate' })
    .click();

  const workspace = page.getByTestId('estimate-workspace');
  const wave0 = workspace.getByTestId('estimate-wave-0');
  await expect(wave0).toBeVisible();
  await expect(wave0).toContainText('3'); // ticket count from the 'basic' seed scenario

  const totalCell = workspace.getByTestId('estimate-total');
  const baseTotalText = await totalCell.textContent();
  expect(baseTotalText).toMatch(/^\$\d+\.\d{2}$/);
  const baseTotal = Number(baseTotalText?.replace('$', ''));

  const form = workspace.getByTestId('estimate-what-if-form');
  await form.locator('select').selectOption('code-reviewer');
  await form.locator('input[type="number"]').fill('0.01');
  await form.getByRole('button', { name: 'What if?' }).click();

  await expect
    .poll(async () => {
      const text = await totalCell.textContent();
      return Number(text?.replace('$', ''));
    })
    .toBeLessThan(baseTotal);

  // W22-12: this suite created a temp project and never removed it —
  // it was absent from the ENOTEMPTY report because it leaked instead
  // of racing. Every run left a directory behind.
  await removeTempProject(dir);
});

test('escalation-ROI view and weekly digest render honest-empty until a spend ledger exists (US-309)', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath('estimate');
  await openEstimateTab(page, name, dir);
  seed(path.join(dir, '.dokima', 'state.db'), 'basic');
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByTestId('settings-advanced-toggle').click();
  await page
    .locator('nav.settings__tabs')
    .getByRole('button', { name: 'Cost Estimate' })
    .click();

  const workspace = page.getByTestId('estimate-workspace');
  await expect(workspace.getByTestId('escalation-roi-empty')).toBeVisible();

  const digest = workspace.getByTestId('weekly-digest-card');
  await expect(digest).toBeVisible();
  await expect(digest).toHaveAttribute('data-tier', 'review');
  await expect(workspace.getByTestId('weekly-digest-total')).toContainText('$0.00');
  await expect(workspace.getByTestId('weekly-digest-suppression-empty')).toBeVisible();

  // W22-12: this suite created a temp project and never removed it —
  // it was absent from the ENOTEMPTY report because it leaked instead
  // of racing. Every run left a directory behind.
  await removeTempProject(dir);
});
