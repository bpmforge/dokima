import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { freshProjectPath as newTempProject } from './temp-project.js';

/**
 * Kanban board (UX_SPEC §4, FR-C4/FR-T4) against the real apps/server +
 * per-project `state.db` — same discipline as fleet.spec.ts/chat.spec.ts
 * (real REST fetch + WS wiring, not a mocked browser API). Ticket fixtures
 * are seeded directly into the project's event log via
 * `fixtures/seed-board-tickets.mjs` (no ticket-creation REST endpoint
 * exists — out of this ticket's acceptance — and the CLI has no `create`
 * subcommand either).
 *
 * A wide viewport: the board pane is one of three side-by-side panes
 * (~1/3 of the window), and six fixed-min-width columns don't fit in that
 * without horizontal scroll — a real drag's drop target must actually be
 * on-screen for Playwright's pointer-based `dragTo` to land on it.
 */
test.use({ viewport: { width: 2400, height: 1000 } });

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const TSX_BIN = path.join(repoRoot, 'apps', 'server', 'node_modules', '.bin', 'tsx');
const SEED_SCRIPT = path.join(here, 'fixtures', 'seed-board-tickets.mjs');

/** This suite's label bound to the shared helper (W22-15) — the uniform
 * `dokima-<label>-e2e-<uuid>` name is what global-teardown removes. */
function freshProjectPath(): { dir: string; name: string } {
  return newTempProject('board');
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
  // W17-09: creating a project auto-opens it — the workspace, not the grid.
  await expect(page.getByTestId('split-pane-workspace')).toBeVisible();
}

test('board renders lanes x columns x typed cards from live projections (FR-C4)', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath();
  await openFreshProject(page, name, dir);
  seed(path.join(dir, '.dokima', 'state.db'), 'basic');
  await page.reload();

  const board = page.getByTestId('pane-board').getByTestId('board-view');
  await expect(board).toBeVisible();

  const uiLane = page.getByTestId('lane-ui');
  await expect(
    uiLane.getByTestId('column-ready').getByTestId('card-E2E-1'),
  ).toBeVisible();
  await expect(
    uiLane.getByTestId('column-blocked').getByTestId('card-E2E-2'),
  ).toBeVisible();

  const gatewayLane = page.getByTestId('lane-gateway');
  const doneCard = gatewayLane.getByTestId('column-done').getByTestId('card-E2E-3');
  await expect(doneCard).toBeVisible();
  await expect(doneCard.locator('.board-card__receipt-dot')).toHaveAttribute(
    'data-state',
    'green',
  );
});

test('board empty state renders when no tickets exist yet (UX_SPEC §2b)', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath();
  await openFreshProject(page, name, dir);

  const board = page.getByTestId('pane-board');
  await expect(board.getByTestId('board-empty')).toBeVisible();
  await expect(
    board.getByText(
      'The board fills once you describe your idea and it is broken into tickets.',
    ),
  ).toBeVisible();
});

test('dragging a ready card to Claimed fires claim and the card moves column (FR-T4)', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath();
  await openFreshProject(page, name, dir);
  seed(path.join(dir, '.dokima', 'state.db'), 'drag-claim');
  await page.reload();

  const lane = page.getByTestId('lane-ui');
  const card = lane.getByTestId('column-ready').getByTestId('card-E2E-DRAG-1');
  await expect(card).toBeVisible();

  await card.dragTo(lane.getByTestId('column-claimed'));

  const claimedCard = lane.getByTestId('column-claimed').getByTestId('card-E2E-DRAG-1');
  await expect(claimedCard).toBeVisible();
  await expect(claimedCard).toContainText('operator');
});

test('dragging an in-progress card to In Review with no manifest is refused inline (FR-T4)', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath();
  await openFreshProject(page, name, dir);
  seed(path.join(dir, '.dokima', 'state.db'), 'drag-refuse-close');
  await page.reload();

  const lane = page.getByTestId('lane-ui');
  const card = lane.getByTestId('column-in_progress').getByTestId('card-E2E-REFUSE-1');
  await expect(card).toBeVisible();

  // A drag can never supply a Completion Manifest, so this drop always fires
  // `close` with an empty body — refused, never "just moved" (UX_SPEC §4).
  await card.dragTo(lane.getByTestId('column-in_review'));

  const refusal = page.getByTestId('refusal-E2E-REFUSE-1');
  await expect(refusal).toBeVisible();
  await expect(refusal).toContainText('MANIFEST_INVALID');
  await expect(
    lane.getByTestId('column-in_progress').getByTestId('card-E2E-REFUSE-1'),
  ).toBeVisible();
});

test('jumping to another ticket while the drawer stays open resets the DAG edit panel (regression)', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath();
  await openFreshProject(page, name, dir);
  seed(path.join(dir, '.dokima', 'state.db'), 'dag-switch');
  await page.reload();

  const lane = page.getByTestId('lane-ui');
  await lane.getByTestId('column-ready').getByTestId('card-E2E-DAG-1').click();

  const drawer = page.getByTestId('ticket-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('aria-label', 'Ticket E2E-DAG-1 detail');
  const dagPanel = drawer.getByTestId('dag-edit-panel');
  await expect(dagPanel).toContainText('E2E-DAG-BASE');

  // ⌘K jump to a different ticket without closing the drawer — App.tsx's
  // onJumpToTicket just changes `openTicketId`, it never unmounts
  // TicketDrawer, so DagEditPanel must reset its own draft state per-ticket
  // rather than carrying over E2E-DAG-1's dependency chip.
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByTestId('command-palette')).toBeVisible();
  await page.getByTestId('command-palette-input').fill('E2E-DAG-2');
  await page
    .getByTestId('palette-result-ticket:E2E-DAG-2')
    .getByRole('button', { name: 'No dependencies' })
    .click();

  await expect(drawer).toHaveAttribute('aria-label', 'Ticket E2E-DAG-2 detail');
  await expect(dagPanel).not.toContainText('E2E-DAG-BASE');
  await expect(dagPanel).toContainText('No dependencies');
});
