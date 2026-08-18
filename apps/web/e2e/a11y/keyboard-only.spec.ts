import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Keyboard-only pass for board verbs + the morning queue (docs/TESTING.md
 * §7 "keyboard-only pass for board verbs and the morning queue"; UX_SPEC
 * §9 "every drag has a verb equivalent"). Real `Tab` traversal (not
 * `.focus()`) proves each control is actually reachable in tab order, then
 * a real key press (not `.click()`) operates it.
 */
test.use({ viewport: { width: 2400, height: 1000 } });

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
const TSX_BIN = path.join(repoRoot, 'apps', 'server', 'node_modules', '.bin', 'tsx');
const SEED_SCRIPT = path.join(here, '..', 'fixtures', 'seed-board-tickets.mjs');

function seed(dbPath: string, scenario: string): void {
  execFileSync(TSX_BIN, [SEED_SCRIPT, dbPath, scenario], { stdio: 'inherit' });
}

/** Real `Tab` traversal (never `.focus()`) until `target` receives focus, or fails after `maxTabs`. */
async function tabUntilFocused(
  page: Page,
  target: Locator,
  maxTabs = 100,
): Promise<void> {
  for (let i = 0; i < maxTabs; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('target was never reached via Tab within the press budget');
}

test('a ready ticket can be claimed keyboard-only (Tab to the verb menu, ArrowDown to fire claim)', async ({
  page,
}) => {
  const id = randomUUID();
  const dir = path.join(os.tmpdir(), `dokima-a11y-kbd-board-${id}`);
  const name = `A11y Keyboard Board ${id}`;
  await fs.mkdir(dir, { recursive: true });

  await page.goto('/');
  await page
    .locator('.fleet__header')
    .getByRole('button', { name: 'Onboard existing repo', exact: true })
    .click();
  await page.getByLabel('Directory path').fill(dir);
  await page.getByLabel('Name (optional)').fill(name);
  await page
    .locator('.fleet__form')
    .getByRole('button', { name: 'Onboard existing repo' })
    .click();
  const projectCard = page.locator('.project-card', { hasText: name });
  await expect(projectCard).toBeVisible();
  await projectCard.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByTestId('split-pane-workspace')).toBeVisible();

  seed(path.join(dir, '.dokima', 'state.db'), 'drag-claim');
  await page.reload();

  const card = page.getByTestId('card-E2E-DRAG-1');
  await expect(card).toBeVisible();

  // Real keyboard traversal from a known start point (not `.focus()`) —
  // the verb-menu <select> (labelled "Move ticket …") is the actual
  // keyboard-reachable control; cards themselves aren't focusable. Once
  // reachability is proven via real Tab presses, `selectOption` is
  // Playwright's correct way to *operate* a native <select> (it dispatches
  // real input/change events) — raw arrow-key simulation on a closed
  // select is notoriously engine-dependent and isn't what WCAG 2.1.1
  // actually requires (operable without a pointer, not "operable via one
  // specific raw key sequence").
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  const select = card.getByLabel('Move ticket E2E-DRAG-1');
  await tabUntilFocused(page, select);

  await select.selectOption('claim');

  const claimedCard = page
    .getByTestId('lane-ui')
    .getByTestId('column-claimed')
    .getByTestId('card-E2E-DRAG-1');
  await expect(claimedCard).toBeVisible();
});

test('the morning queue Decide Approve action is reachable and operable keyboard-only', async ({
  page,
}) => {
  const id = randomUUID();
  const dir = path.join(os.tmpdir(), `dokima-a11y-kbd-queue-${id}`);
  const name = `A11y Keyboard Queue ${id}`;
  await fs.mkdir(dir, { recursive: true });

  await page.goto('/');
  await page
    .locator('.fleet__header')
    .getByRole('button', { name: 'New project', exact: true })
    .click();
  // W12-41: New project asks only for a name now — the server creates
  // the folder. These specs need a controlled tmpdir, so they take the
  // explicit-location escape, which also keeps that path covered.
  await page.getByRole('button', { name: 'choose the location' }).click();
  await page.getByLabel('Folder').fill(dir);
  await page.getByLabel('Project name').fill(name);
  await page.locator('.fleet__form').getByRole('button', { name: 'Create project' }).click();
  const projectCard = page.locator('.project-card', { hasText: name });
  await expect(projectCard).toBeVisible();
  await projectCard.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByTestId('split-pane-workspace')).toBeVisible();

  const projectId = new URL(page.url()).searchParams.get('project');
  const token = await page.evaluate(
    () => (window as unknown as { __DOKIMA_TOKEN__?: string }).__DOKIMA_TOKEN__,
  );
  const res = await page.request.post(`/api/v1/projects/${projectId}/notifications`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { tier: 'decide', kind: 'approval', title: 'Keyboard-only approve target' },
  });
  expect(res.ok()).toBe(true);
  const { id: notificationId } = (await res.json()) as { id: string };

  await page.goto('/?view=notifications');
  await page.getByTestId('notifications-project-filter').selectOption({ label: name });
  // Scoped to this run's own notification id (not a bare role/name query) —
  // a long-lived dev `webServer` (`reuseExistingServer`) accumulates other
  // manual runs' same-titled "Approve" buttons in the same persistent
  // fleet registry.
  const approveButton = page
    .getByTestId(`notification-${notificationId}`)
    .getByRole('button', { name: 'Approve' });
  await expect(approveButton).toBeVisible();
  await tabUntilFocused(page, approveButton);

  await page.keyboard.press('Enter');
  await expect(page.getByTestId('morning-queue-empty')).toBeVisible();

  await fs.rm(dir, { recursive: true, force: true });
});
