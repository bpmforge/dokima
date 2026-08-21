import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Session trace viewer (BLUEPRINT §12.4, this ticket's `apps/web/src/
 * trace/**`) against the real apps/server + a real project `state.db` —
 * same discipline as board.spec.ts/artifacts.spec.ts. Fixtures seeded via
 * `fixtures/seed-board-tickets.mjs`'s `trace` scenario (no run/event
 * creation REST endpoint exists, same reasoning board.spec.ts's header
 * gives for ticket creation).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const TSX_BIN = path.join(repoRoot, 'apps', 'server', 'node_modules', '.bin', 'tsx');
const SEED_SCRIPT = path.join(here, 'fixtures', 'seed-board-tickets.mjs');

function freshProjectPath(): { dir: string; name: string } {
  const id = randomUUID();
  return {
    dir: path.join(os.tmpdir(), `dokima-trace-e2e-${id}`),
    name: `Trace E2E ${id}`,
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
  // W17-09: creating a project auto-opens it — the workspace, not the grid.
  await expect(page.getByTestId('split-pane-workspace')).toBeVisible();
}

test('the trace view is honestly empty for a ticket no run has ever touched', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath();
  await openFreshProject(page, name, dir);
  seed(path.join(dir, '.dokima', 'state.db'), 'trace');
  await page.reload();

  await page.getByTestId('card-E2E-TRACE-EMPTY').click();
  const drawer = page.getByTestId('ticket-drawer');
  await expect(drawer).toBeVisible();

  await drawer.getByTestId('open-session-trace').click();
  const traceView = page.getByTestId('trace-view');
  await expect(traceView).toBeVisible();
  await expect(traceView).toContainText('Session trace — E2E-TRACE-EMPTY');
  await expect(traceView.getByTestId('trace-view-empty')).toBeVisible();
});

test("replays a run's events labeled by kind, each feeding the lessons form (BLUEPRINT §12.4)", async ({
  page,
}) => {
  const { dir, name } = freshProjectPath();
  await openFreshProject(page, name, dir);
  seed(path.join(dir, '.dokima', 'state.db'), 'trace');
  await page.reload();

  await page.getByTestId('card-E2E-TRACE-1').click();
  const drawer = page.getByTestId('ticket-drawer');
  await expect(drawer).toBeVisible();

  await drawer.getByTestId('open-session-trace').click();
  const traceView = page.getByTestId('trace-view');
  await expect(traceView).toBeVisible();

  await traceView.getByRole('button', { name: /View session trace — run-e2e-1/ }).click();

  const rows = traceView.getByTestId('trace-view-event-row');
  await expect(rows).toHaveCount(3);
  await expect(traceView).toContainText('Pass 1');
  await expect(traceView).toContainText('Gate result');
  await expect(traceView).toContainText('Escalation');
  await expect(traceView.getByTestId('file-field-report-action').first()).toBeVisible();

  await traceView.getByTestId('file-field-report-action').first().click();
  await expect(traceView.getByTestId('field-report-form').first()).toBeVisible();
});
