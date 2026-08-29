import { promises as fs } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { freshProjectPath, removeTempProject } from './temp-project.js';

/**
 * Notification center + morning queue (UX_SPEC §2/§7, FR-N4/FR-F4) against
 * the real apps/server + a real per-project `state.db` — same discipline as
 * roster.spec.ts/fleet.spec.ts. Notifications are seeded through the real
 * `POST /api/v1/projects/:id/notifications` emitter endpoint (not a fixture
 * file or direct DB write) via `page.request`, reading the SPA's own
 * injected bearer token (SC-08) — this exercises the actual emitter
 * contract, not a shortcut around it.
 */


async function openFreshProject(page: Page, name: string, dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  await page.goto('/');
  const header = page.locator('.fleet__header');
  await header.getByRole('button', { name: 'New project', exact: true }).click();
  // W12-41: New project asks only for a name now — the server creates
  // the folder. These specs need a controlled tmpdir, so they take the
  // explicit-location escape, which also keeps that path covered.
  await page.getByRole('button', { name: 'choose the location' }).click();
  await page.getByLabel('Folder').fill(dir);
  await page.getByLabel('Project name').fill(name);
  await page.locator('.fleet__form').getByRole('button', { name: 'Create project' }).click();
  // W17-09: creating a project auto-opens it — the workspace, not the grid.
  await expect(page.getByTestId('split-pane-workspace')).toBeVisible();
  const projectId = new URL(page.url()).searchParams.get('project');
  if (!projectId) throw new Error('expected ?project= in the URL after opening');
  return projectId;
}

async function readToken(page: Page): Promise<string> {
  const token = await page.evaluate(
    () => (window as unknown as { __DOKIMA_TOKEN__?: string }).__DOKIMA_TOKEN__,
  );
  if (!token) throw new Error('expected window.__DOKIMA_TOKEN__ to be injected');
  return token;
}

async function emit(
  page: Page,
  token: string,
  projectId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const res = await page.request.post(`/api/v1/projects/${projectId}/notifications`, {
    headers: { Authorization: `Bearer ${token}` },
    data: payload,
  });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { id: string };
  return body.id;
}

test('bell nav toggles the notification center and back to Fleet', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Fleet' })).toBeVisible();

  await page.getByRole('button', { name: /Morning queue/ }).click();
  await expect(page.getByTestId('notifications-view')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Morning queue' })).toBeVisible();

  // W13-01: no more "← Back" — the main surface is a destination like any
  // other, so you return to it by choosing it. Label is Fleet with no
  // project open, Board with one.
  await page.getByRole('button', { name: 'Fleet', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Fleet' })).toBeVisible();
});

test('empty states per UX_SPEC §2b for a freshly-registered project', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath('notifications');
  const projectId = await openFreshProject(page, name, dir);

  await page.goto(`/?view=notifications`);
  await expect(page.getByTestId('notifications-project-filter')).toBeVisible();
  await page.getByTestId('notifications-project-filter').selectOption({ label: name });

  await expect(page.getByTestId('morning-queue-empty')).toContainText(
    'Nothing needs you',
  );
  // W13-51: the closing clause speaks user vocabulary now — "wave gate" was
  // internal jargon as the last words of the calmest screen in the product.
  await expect(page.getByTestId('morning-queue-empty')).toContainText(
    'he next digest arrives when the current run finishes',
  );

  await page.getByRole('tab', { name: 'All notifications' }).click();
  await expect(page.getByTestId('notification-center-empty')).toBeVisible();

  await removeTempProject(dir);
  void projectId;
});

test('an emitted Decide card appears in the morning queue and Approve resolves it', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath('notifications');
  const projectId = await openFreshProject(page, name, dir);
  const token = await readToken(page);

  const id = await emit(page, token, projectId, {
    tier: 'decide',
    kind: 'approval',
    title: 'Merge the W4-07 branch',
    body: { diffStat: '+120 -4' },
  });

  await page.goto('/?view=notifications');
  await page.getByTestId('notifications-project-filter').selectOption({ label: name });

  const card = page.getByTestId(`notification-${id}`);
  await expect(card).toBeVisible();
  await expect(card.getByText('+120 -4')).toBeVisible();

  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('morning-queue-empty')).toBeVisible();

  await removeTempProject(dir);
});

test('Review-tier emits batch into one digest card, and Record never appears in the queue', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath('notifications');
  const projectId = await openFreshProject(page, name, dir);
  const token = await readToken(page);

  await emit(page, token, projectId, {
    tier: 'review',
    kind: 'gate_passed',
    title: 'Gate A passed',
    summary: 'all validators green',
  });
  await emit(page, token, projectId, {
    tier: 'review',
    kind: 'pr_ready',
    title: 'PR ready to merge',
    summary: 'branch pushed',
  });
  await emit(page, token, projectId, {
    tier: 'record',
    kind: 'gate_passed',
    title: 'FYI only — should never appear in the queue',
  });

  await page.goto('/?view=notifications');
  await page.getByTestId('notifications-project-filter').selectOption({ label: name });

  const queueList = page.getByTestId('morning-queue-list');
  await expect(queueList).toBeVisible();
  await expect(queueList.getByText('2 items batched')).toBeVisible();
  await expect(queueList.getByText('FYI only')).toHaveCount(0);

  await page.getByRole('tab', { name: 'All notifications' }).click();
  await expect(page.getByTestId('notification-center-list')).toContainText('FYI only');

  await removeTempProject(dir);
});

test('a Decide notification bumps the header bell badge count', async ({ page }) => {
  const { dir, name } = freshProjectPath('notifications');
  const projectId = await openFreshProject(page, name, dir);
  const token = await readToken(page);

  await emit(page, token, projectId, {
    tier: 'decide',
    kind: 'clarification',
    title: 'Needs your input',
  });

  await page.goto('/');
  await expect(page.getByTestId('decide-badge')).toBeVisible({ timeout: 10_000 });

  await removeTempProject(dir);
});
