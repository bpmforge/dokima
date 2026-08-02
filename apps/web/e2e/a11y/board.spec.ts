import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { scanForA11yViolations } from './axeHelper.js';

/** Axe scan on the board (docs/TESTING.md §7 "axe scan per routed page"; UX_SPEC §9). */
test.use({ viewport: { width: 2400, height: 1000 } });

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
const TSX_BIN = path.join(repoRoot, 'apps', 'server', 'node_modules', '.bin', 'tsx');
const SEED_SCRIPT = path.join(here, '..', 'fixtures', 'seed-board-tickets.mjs');

function freshProjectPath(): { dir: string; name: string } {
  const id = randomUUID();
  return {
    dir: path.join(os.tmpdir(), `dokima-a11y-board-${id}`),
    name: `A11y Board ${id}`,
  };
}

function seed(dbPath: string, scenario: string): void {
  execFileSync(TSX_BIN, [SEED_SCRIPT, dbPath, scenario], { stdio: 'inherit' });
}

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

test('board has no WCAG 2.2 AA violations with live cards/columns/strips', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath();
  await openFreshProject(page, name, dir);
  seed(path.join(dir, '.dokima', 'state.db'), 'basic');
  await page.reload();

  await expect(page.getByTestId('pane-board').getByTestId('board-view')).toBeVisible();

  const violations = await scanForA11yViolations(page, '[data-testid="pane-board"]');
  expect(violations).toEqual([]);
});
