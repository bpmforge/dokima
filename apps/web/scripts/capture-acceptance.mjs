/**
 * Acceptance walker (W9-01): walks every URL-reachable view and the key
 * interactions of the canvas against the real product (see
 * `lib/app-harness.mjs` — real build, real server, throwaway home,
 * sanctioned seeding only, Law 9), capturing one frame per checklist item
 * in `docs/acceptance/CHECKLIST.md` plus a `manifest.json` binding frames
 * to checklist ids. Output goes to a gitignored run dir:
 *
 *   docs/acceptance/runs/<runId>/{NN-<checkId>.png, manifest.json}
 *
 * A review agent (docs/acceptance/ACCEPTANCE_AGENT.md) then judges the
 * frames against the checklist — this script only captures, it never
 * judges (maker ≠ verifier, Law 5).
 *
 * Run:  node apps/web/scripts/capture-acceptance.mjs [runId]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { PLAN_SNAPSHOT, repoRoot, seedDemoBoard, startApp } from './lib/app-harness.mjs';

const PORT = 4409;
const runId = process.argv[2] ?? new Date().toISOString().replace(/[:.]/g, '-');
const RUN_DIR = path.join(repoRoot, 'docs', 'acceptance', 'runs', runId);
mkdirSync(RUN_DIR, { recursive: true });

const frames = [];
let frameNo = 0;

async function shoot(page, checkId, action) {
  frameNo += 1;
  const file = `${String(frameNo).padStart(2, '0')}-${checkId}.png`;
  // Let poll-driven fetches and CSS transitions settle before capturing.
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(RUN_DIR, file), fullPage: false });
  frames.push({ checkId, file, action });
  console.log(`  [${file}] ${action}`);
}

console.log(`booting apps/server… (run ${runId})`);
const app = await startApp(PORT);

try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.emulateMedia({ reducedMotion: 'reduce' });

  // ── Fleet ────────────────────────────────────────────────────────────
  await page.goto(app.base);
  await page.getByRole('heading', { name: 'Fleet' }).waitFor();
  await shoot(page, 'A-01', 'Loaded / — Fleet empty state');

  await page
    .locator('.fleet__header')
    .getByRole('button', { name: 'New Product', exact: true })
    .click();
  await page.getByLabel('Directory path').fill(app.projectDir);
  await page.getByLabel('Name (optional)').fill('Demo Voyage');
  await shoot(page, 'A-02', 'Opened New Product form, filled path + name');

  await page.locator('.fleet__form').getByRole('button', { name: 'New Product' }).click();
  await page.locator('.project-card', { hasText: 'Demo Voyage' }).waitFor();
  await shoot(page, 'A-03', 'Submitted form — project card on Fleet');

  // ── Workspace ────────────────────────────────────────────────────────
  await page
    .locator('.project-card', { hasText: 'Demo Voyage' })
    .getByRole('button', { name: 'Open' })
    .click();
  await page.getByTestId('split-pane-workspace').waitFor();
  const projectId = new URL(page.url()).searchParams.get('project');
  await shoot(page, 'A-04', 'Opened project — three-pane workspace, unseeded');

  await page
    .getByTestId('pane-artifacts')
    .getByRole('button', { name: 'Receipts' })
    .click();
  await shoot(page, 'A-05', 'Clicked Receipts tab in the Artifacts pane');

  // ── Board ────────────────────────────────────────────────────────────
  seedDemoBoard(app.projectDir);
  await page.reload();
  await page.getByTestId('card-E2E-1').waitFor();
  await shoot(page, 'A-06', 'Seeded board via real event log, reloaded');

  await page.getByTestId('card-E2E-1').click();
  await page.getByTestId('ticket-drawer').waitFor();
  await shoot(page, 'A-07', 'Clicked card E2E-1 — ticket drawer open');

  // ── Session trace ────────────────────────────────────────────────────
  await page.getByTestId('open-session-trace').click();
  await page.getByTestId('trace-view').waitFor();
  await shoot(page, 'A-08', 'Opened session trace — runs list for E2E-1');

  await page.getByRole('button', { name: /View session trace — run-tour-1/ }).click();
  await page.getByTestId('trace-event-list').waitFor({ timeout: 5000 }).catch(() => {});
  await shoot(page, 'A-09', 'Selected run-tour-1 — event replay');

  // ── Improvement plan: propose → accept ───────────────────────────────
  // String form: the expression runs in the browser, where `window` exists —
  // an arrow function here would trip node-side no-undef.
  const token = await page.evaluate('window.__DOKIMA_TOKEN__');
  await page.request.post(`${app.base}/api/v1/projects/${projectId}/plan/evaluate`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { snapshot: PLAN_SNAPSHOT },
  });
  await page.goto(`${app.base}/?project=${projectId}&view=plans`);
  const planItem = page.getByTestId('plan-item-PC-001');
  await planItem.waitFor();
  await shoot(page, 'A-10', 'Evaluated snapshot — PC-001 proposed in plan view');

  await planItem.getByRole('button', { name: 'Accept' }).click();
  await planItem.getByTestId('plan-accept-lane-input').fill('pipeline');
  await shoot(page, 'A-11', 'Clicked Accept — lane form open, filled "pipeline"');

  await planItem.getByRole('button', { name: 'Confirm accept' }).click();
  await planItem.getByText('Accepted').waitFor();
  await shoot(page, 'A-12', 'Confirmed accept — item Accepted with minted ticket ref');

  // ── Notifications: queue, tabs, approve flow ─────────────────────────
  await page.request.post(`${app.base}/api/v1/projects/${projectId}/notifications`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      tier: 'decide',
      kind: 'approval',
      title: 'Merge the demo branch',
      body: { diffStat: '+120 -4' },
    },
  });
  await page.request.post(`${app.base}/api/v1/projects/${projectId}/notifications`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      tier: 'review',
      kind: 'gate_passed',
      title: 'Gate A passed',
      summary: 'all validators green',
    },
  });
  await page.goto(`${app.base}/?view=notifications`);
  await page.getByTestId('morning-queue-list').waitFor();
  await shoot(page, 'A-13', 'Morning queue — Decide card + Review digest');

  await page.getByRole('tab', { name: 'All notifications' }).click();
  await shoot(page, 'A-14', 'Switched to the All notifications tab');

  await page.getByRole('tab', { name: 'Morning queue' }).click();
  await page.getByRole('button', { name: 'Approve' }).click();
  await page
    .getByTestId('morning-queue-list')
    .getByText('Merge the demo branch')
    .waitFor({ state: 'detached', timeout: 5000 })
    .catch(() => {});
  await shoot(page, 'A-15', 'Clicked Approve on the Decide card');

  // ── Roster, settings, wizard ─────────────────────────────────────────
  await page.goto(`${app.base}/?view=roster`);
  await page.getByTestId('roster-view').waitFor({ timeout: 5000 }).catch(() => {});
  await shoot(page, 'A-16', 'Roster view');

  await page.goto(`${app.base}/?view=settings`);
  await shoot(page, 'A-17', 'Global settings view');

  await page.goto(`${app.base}/?view=wizard`);
  await shoot(page, 'A-18', 'First-run wizard view');

  // ── Shortcuts & theming ──────────────────────────────────────────────
  await page.goto(app.base);
  await page.getByRole('heading', { name: 'Fleet' }).waitFor();
  await page.keyboard.press('?');
  await page.getByTestId('shortcuts-overlay').waitFor();
  await shoot(page, 'A-19', 'Pressed ? — shortcuts overlay');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /switch to/i }).click();
  await shoot(page, 'A-20', 'Toggled dark theme — Fleet');

  await page.goto(`${app.base}/?project=${projectId}`);
  await page.getByTestId('card-E2E-1').waitFor();
  await shoot(page, 'A-21', 'Dark theme — seeded three-pane workspace');

  await browser.close();

  writeFileSync(
    path.join(RUN_DIR, 'manifest.json'),
    JSON.stringify(
      {
        runId,
        capturedAt: new Date().toISOString(),
        viewport: { width: 1440, height: 900 },
        checklist: 'docs/acceptance/CHECKLIST.md',
        frames,
      },
      null,
      2,
    ),
  );
  console.log(`\nwrote ${frames.length} frames + manifest to docs/acceptance/runs/${runId}/`);
} finally {
  app.stop();
}
