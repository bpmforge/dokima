import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Dry-run estimate / escalation-ROI / weekly digest (BLUEPRINT §12.2,
 * FR-G7, US-307/309) against the real apps/server — same discipline as
 * board.spec.ts (real REST fetch, real seeded ticket events, not a mocked
 * browser API). The estimate pane portals into `pane-artifacts`
 * (App.tsx), same pattern chat/board use for their panes.
 */
test.use({ viewport: { width: 2400, height: 1000 } });

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const TSX_BIN = path.join(repoRoot, 'apps', 'server', 'node_modules', '.bin', 'tsx');
const SEED_SCRIPT = path.join(here, 'fixtures', 'seed-board-tickets.mjs');

function freshProjectPath(): { dir: string; name: string } {
  const id = randomUUID();
  return {
    dir: path.join(os.tmpdir(), `shipwright-estimate-e2e-${id}`),
    name: `Estimate E2E ${id}`,
  };
}

function seed(dbPath: string, scenario: string): void {
  execFileSync(TSX_BIN, [SEED_SCRIPT, dbPath, scenario], { stdio: 'inherit' });
}

/** Registers ("Onboard existing repo") a project via the real Fleet UI and opens it. */
async function openFreshProject(page: Page, name: string, dir: string): Promise<void> {
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
}

test('empty board yields an honest empty estimate, not a fabricated total', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath();
  await openFreshProject(page, name, dir);

  const artifacts = page.getByTestId('pane-artifacts');
  await expect(artifacts.getByTestId('estimate-empty')).toBeVisible();
});

test('real board tickets drive a per-wave breakdown, and what-if recomputes deterministically (FR-G7)', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath();
  await openFreshProject(page, name, dir);
  seed(path.join(dir, '.shipwright', 'state.db'), 'basic');
  await page.reload();

  const artifacts = page.getByTestId('pane-artifacts');
  const wave0 = artifacts.getByTestId('estimate-wave-0');
  await expect(wave0).toBeVisible();
  await expect(wave0).toContainText('3'); // ticket count from the 'basic' seed scenario

  const totalCell = artifacts.getByTestId('estimate-total');
  const baseTotalText = await totalCell.textContent();
  expect(baseTotalText).toMatch(/^\$\d+\.\d{2}$/);
  const baseTotal = Number(baseTotalText?.replace('$', ''));

  const form = artifacts.getByTestId('estimate-what-if-form');
  await form.locator('select').selectOption('code-reviewer');
  await form.locator('input[type="number"]').fill('0.01');
  await form.getByRole('button', { name: 'What if?' }).click();

  await expect
    .poll(async () => {
      const text = await totalCell.textContent();
      return Number(text?.replace('$', ''));
    })
    .toBeLessThan(baseTotal);
});

test('escalation-ROI view and weekly digest render honest-empty until a spend ledger exists (US-309)', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath();
  await openFreshProject(page, name, dir);
  seed(path.join(dir, '.shipwright', 'state.db'), 'basic');
  await page.reload();

  const artifacts = page.getByTestId('pane-artifacts');
  await expect(artifacts.getByTestId('escalation-roi-empty')).toBeVisible();

  const digest = artifacts.getByTestId('weekly-digest-card');
  await expect(digest).toBeVisible();
  await expect(digest).toHaveAttribute('data-tier', 'review');
  await expect(artifacts.getByTestId('weekly-digest-total')).toContainText('$0.00');
  await expect(artifacts.getByTestId('weekly-digest-suppression-empty')).toBeVisible();
});
