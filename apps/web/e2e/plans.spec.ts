import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const TSX_BIN = path.join(repoRoot, 'apps', 'server', 'node_modules', '.bin', 'tsx');
const RECORD_OUTCOMES_SCRIPT = path.join(here, 'fixtures', 'record-rule-outcomes.mjs');

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
    dir: path.join(os.tmpdir(), `dokima-plans-e2e-${id}`),
    name: `Plans E2E ${id}`,
  };
}

async function openFreshProject(page: Page, name: string, dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  await page.goto('/');
  const header = page.locator('.fleet__header');
  await header.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Directory path').fill(dir);
  await page.getByLabel('Name (optional)').fill(name);
  await page.locator('.fleet__form').getByRole('button', { name: 'Create project' }).click();
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
    () => (window as unknown as { __DOKIMA_TOKEN__?: string }).__DOKIMA_TOKEN__,
  );
  if (!token) throw new Error('expected window.__DOKIMA_TOKEN__ to be injected');
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

/**
 * W5-16 hardened `/plan/verify` to derive its snapshot server-side and
 * ignore the request body entirely (a caller-supplied snapshot would let a
 * bearer-token holder self-attest verification, plans-routes.ts) — so
 * unlike `evaluate` there is no snapshot argument to pass.
 */
async function verify(page: Page, token: string, projectId: string): Promise<void> {
  const res = await page.request.post(`/api/v1/projects/${projectId}/plan/verify`, {
    headers: { Authorization: `Bearer ${token}` },
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

/**
 * Since `/plan/verify` derives its snapshot from real project state, the
 * regression must be driven through the one snapshot field with a live
 * producer, `rules.fpHeavyCount` (scheduler/snapshot.ts
 * LIVE_SNAPSHOT_PATHS): a real `rule_state` row walked to `gate`, FP
 * outcomes recorded through the real store (fixtures/
 * record-rule-outcomes.mjs — no HTTP route for outcome recording exists
 * yet, same real-code-via-fixture discipline as seed-board-tickets.mjs).
 * PC-005 is the catalog entry keyed to that field. Any other catalog item
 * would make the verify pass skip itself (unresolvedSnapshotPaths, C-1
 * local-first honesty) — which is why the pre-W5-16 PC-001 version of this
 * test could never regress anything.
 */
test('a regressed plan item surfaces as a Review card in the morning queue with the violated criterion + evidence (AC2)', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath();
  const projectId = await openFreshProject(page, name, dir);
  const token = await readToken(page);
  const ruleId = 'e2e-fp-heavy-rule';

  const post = async (url: string, data?: Record<string, unknown>): Promise<void> => {
    const res = await page.request.post(url, {
      headers: { Authorization: `Bearer ${token}` },
      data: data ?? {},
    });
    expect(res.ok()).toBe(true);
  };
  // Bypasses D-014's promotion data gate: this rule's window is manufactured
  // FP history, so it can never present 20 clean samples.
  const lift = { min_sample_count: 0, max_fp_rate: 1 };
  const recordFps = (count: number): void => {
    execFileSync(TSX_BIN, [RECORD_OUTCOMES_SCRIPT, dir, ruleId, String(count)], {
      stdio: 'inherit',
    });
  };
  const rulePath = `/api/v1/projects/${projectId}/rules/${ruleId}`;

  await post(`${rulePath}/register`);
  await post(`${rulePath}/promote`, lift); // proposed -> shadow
  await post(`${rulePath}/promote`, lift); // shadow -> advisory
  await post(`${rulePath}/promote`, lift); // advisory -> gate
  recordFps(2); // 2/2 FP on a gate rule > DEMOTION_FP_THRESHOLD -> flagged, fpHeavyCount = 1

  await evaluate(
    page,
    token,
    projectId,
    baselineSnapshot({ rules: { fpHeavyCount: 1 } }),
  );
  await post(`/api/v1/projects/${projectId}/plan-items/PC-005/accept`, {
    lane: 'pipeline',
  });

  await post(`${rulePath}/demote`); // gate -> advisory, clears the flag -> fpHeavyCount = 0
  await verify(page, token, projectId); // accepted -> done

  await post(`${rulePath}/promote`, lift); // back to gate (promote clears the flag)
  recordFps(1); // window now 3/3 FP -> re-flagged -> fpHeavyCount = 1
  await verify(page, token, projectId); // done -> regressed, Review digest emitted

  await page.goto(`/?view=notifications`);
  await page.getByTestId('notifications-project-filter').selectOption({ label: name });

  const queueList = page.getByTestId('morning-queue-list');
  await expect(queueList).toBeVisible();
  await expect(queueList).toContainText('1 item batched');
  await expect(queueList).toContainText('PC-005 regressed');
  await expect(queueList).toContainText('rules.fpHeavyCount == 0');
  await expect(queueList).toContainText('fpHeavyCount=1');

  await fs.rm(dir, { recursive: true, force: true });
});
