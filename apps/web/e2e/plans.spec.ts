import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Improvement Plan view + morning-queue integration (FR-PLAN2/4, D-016,
 * W5-11 AC1/AC2) against the real apps/server + a real per-project
 * `state.db` — same discipline as notifications.spec.ts. Items are seeded
 * through the real `POST /api/v1/projects/:id/plan/evaluate` +
 * `POST /api/v1/projects/:id/plan/verify` engine endpoints (not a fixture
 * file or direct DB write), so this exercises the actual catalog-matching
 * contract, not a shortcut around it. Fully gateway-free — zero LLM calls
 * anywhere in this flow (FR-PLAN4).
 */

function baselineSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    phase: null,
    receipts: { staleCount: 0 },
    coverage: { requiredSkipped: 0 },
    findings: { openCriticalUnwaived: 0 },
    rules: { fpHeavyCount: 0 },
    tickets: { oscillatingCount: 0, blockedWithEvidenceMaxAgeDays: 0 },
    spend: { thresholdBreachRepeatCount: 0 },
    gates: { missingRedFixtureCount: 0 },
    providers: { unverifiedTosCount: 0 },
    deliverables: { orphanedCount: 0 },
    planItems: { regressedCount: 0 },
    playbook: { staleEntryCount: 0 },
    ...overrides,
  };
}

function freshProjectPath(): { dir: string; name: string } {
  const id = randomUUID();
  return {
    dir: path.join(os.tmpdir(), `shipwright-plans-e2e-${id}`),
    name: `Plans E2E ${id}`,
  };
}

async function openFreshProject(page: Page, name: string, dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  await page.goto('/');
  const header = page.locator('.fleet__header');
  await header.getByRole('button', { name: 'New Product', exact: true }).click();
  await page.getByLabel('Directory path').fill(dir);
  await page.getByLabel('Name (optional)').fill(name);
  await page.locator('.fleet__form').getByRole('button', { name: 'New Product' }).click();
  const card = page.locator('.project-card', { hasText: name });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByTestId('split-pane-workspace')).toBeVisible();
  const projectId = new URL(page.url()).searchParams.get('project');
  if (!projectId) throw new Error('expected ?project= in the URL after opening');
  return projectId;
}

async function readToken(page: Page): Promise<string> {
  const token = await page.evaluate(
    () => (window as unknown as { __SHIPWRIGHT_TOKEN__?: string }).__SHIPWRIGHT_TOKEN__,
  );
  if (!token) throw new Error('expected window.__SHIPWRIGHT_TOKEN__ to be injected');
  return token;
}

async function evaluate(
  page: Page,
  token: string,
  projectId: string,
  snapshot: Record<string, unknown>,
): Promise<void> {
  const res = await page.request.post(`/api/v1/projects/${projectId}/plan/evaluate`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { snapshot },
  });
  expect(res.ok()).toBe(true);
}

async function verify(
  page: Page,
  token: string,
  projectId: string,
  snapshot: Record<string, unknown>,
): Promise<void> {
  const res = await page.request.post(`/api/v1/projects/${projectId}/plan/verify`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { snapshot },
  });
  expect(res.ok()).toBe(true);
}

test('plan view renders catalog provenance, verify criterion, state, and accept/dismiss actions (AC1)', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath();
  const projectId = await openFreshProject(page, name, dir);
  const token = await readToken(page);

  await evaluate(
    page,
    token,
    projectId,
    baselineSnapshot({ receipts: { staleCount: 2 } }),
  );

  await page.goto(`/?project=${projectId}&view=plans`);
  await expect(page.getByTestId('plan-view')).toBeVisible();

  const item = page.getByTestId('plan-item-PC-001');
  await expect(item).toBeVisible();
  await expect(item).toContainText('PC-001');
  await expect(item).toContainText('Proposed');
  await expect(item).toContainText('receipts.staleCount == 0');
  await expect(item.getByTestId(`plan-item-PC-001-ticket`)).toHaveCount(0);

  await item.getByRole('button', { name: 'Accept' }).click();
  await item.getByTestId('plan-accept-lane-input').fill('pipeline');
  await item.getByRole('button', { name: 'Confirm accept' }).click();

  await expect(item).toContainText('Accepted');
  await expect(item.getByTestId(`plan-item-PC-001-ticket`)).toContainText('PLAN-PC-001');

  await fs.rm(dir, { recursive: true, force: true });
});

test('dismiss removes a proposed item from the list and the funnel keeps raw findings visible (AC1/AC2 funnel)', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath();
  const projectId = await openFreshProject(page, name, dir);
  const token = await readToken(page);

  await evaluate(
    page,
    token,
    projectId,
    baselineSnapshot({
      tickets: { oscillatingCount: 1, blockedWithEvidenceMaxAgeDays: 0 },
    }),
  );

  await page.goto(`/?project=${projectId}&view=plans`);
  const item = page.getByTestId('plan-item-PC-003');
  await expect(item).toBeVisible();

  await item.getByRole('button', { name: 'Dismiss' }).click();
  await item.getByTestId('plan-dismiss-note-input').fill('not applicable here');
  await item.getByRole('button', { name: 'Confirm dismiss' }).click();

  await expect(page.getByTestId('plan-item-PC-003')).toHaveCount(0);
  await expect(page.getByTestId('plan-funnel')).toContainText('1 raw');
  await expect(page.getByTestId('plan-funnel')).toContainText('0 plan items');

  await fs.rm(dir, { recursive: true, force: true });
});

test('a regressed plan item surfaces as a Review card in the morning queue with the violated criterion + evidence (AC2)', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath();
  const projectId = await openFreshProject(page, name, dir);
  const token = await readToken(page);

  const violated = baselineSnapshot({ receipts: { staleCount: 3 } });
  const satisfied = baselineSnapshot();

  await evaluate(page, token, projectId, violated);
  const acceptRes = await page.request.post(
    `/api/v1/projects/${projectId}/plan-items/PC-001/accept`,
    { headers: { Authorization: `Bearer ${token}` }, data: { lane: 'pipeline' } },
  );
  expect(acceptRes.ok()).toBe(true);

  await verify(page, token, projectId, satisfied); // accepted -> done
  await verify(page, token, projectId, violated); // done -> regressed

  await page.goto(`/?view=notifications`);
  await page.getByTestId('notifications-project-filter').selectOption({ label: name });

  const queueList = page.getByTestId('morning-queue-list');
  await expect(queueList).toBeVisible();
  await expect(queueList).toContainText('1 item batched');
  await expect(queueList).toContainText('PC-001 regressed');
  await expect(queueList).toContainText('receipts.staleCount == 0');
  await expect(queueList).toContainText('staleCount=3');

  await fs.rm(dir, { recursive: true, force: true });
});
