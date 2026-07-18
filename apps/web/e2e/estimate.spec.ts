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
 * browser API).
 *
 * The three tests below assert on `EstimateWorkspace` mounted into
 * `pane-artifacts`, a stopgap this ticket's own header comment named as
 * temporary: the estimate UI's real home is the Settings Matrix
 * (UX_SPEC §6), which doesn't exist yet. W4-05 gives `pane-artifacts` its
 * actual, spec'd producer (the Artifact Viewer, UX_SPEC §5) and evicts this
 * portal — App.tsx no longer mounts `EstimateWorkspace` anywhere. Skipped
 * (loud, not deleted — FR-L4 discipline) rather than silently dropped;
 * HANDOFF in plan.json's W4-06 notes to re-mount under the Settings Matrix
 * and un-skip these. The server routes/engine and `EstimateWorkspace`
 * component are untouched — only UI reachability changed.
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

test.skip('empty board yields an honest empty estimate, not a fabricated total', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath();
  await openFreshProject(page, name, dir);

  const artifacts = page.getByTestId('pane-artifacts');
  await expect(artifacts.getByTestId('estimate-empty')).toBeVisible();
});

test.skip('real board tickets drive a per-wave breakdown, and what-if recomputes deterministically (FR-G7)', async ({
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

test.skip('escalation-ROI view and weekly digest render honest-empty until a spend ledger exists (US-309)', async ({
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
