/**
 * Captures the scribe-style screenshot tour under `docs/tour/` by driving
 * the real product: a real `vite build` served by the real apps/server
 * against a throwaway `.shipwright` home (same shape as
 * playwright.config.ts's webServer), populated only through sanctioned
 * seams — the UI itself, real API routes, and the e2e seed fixture
 * (`e2e/fixtures/seed-board-tickets.mjs`). Nothing is mocked; every
 * screenshot is the product as shipped (Law 9: fake/local everything, no
 * network beyond 127.0.0.1).
 *
 * Run from the repo root or apps/web:  node apps/web/scripts/capture-tour.mjs
 * Requires `apps/web/dist` (run `pnpm --filter @shipwright/web build` first;
 * the script builds it if missing).
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '../..');
const serverRoot = path.join(repoRoot, 'apps', 'server');
const TSX_BIN = path.join(serverRoot, 'node_modules', '.bin', 'tsx');
const SEED_SCRIPT = path.join(webRoot, 'e2e', 'fixtures', 'seed-board-tickets.mjs');

const PORT = 4407;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT_DIR = path.join(repoRoot, 'docs', 'tour');
const IMG_DIR = path.join(OUT_DIR, 'img');

const steps = [];
let stepNo = 0;

async function shoot(page, slug, title, caption) {
  stepNo += 1;
  const file = `${String(stepNo).padStart(2, '0')}-${slug}.png`;
  // Let poll-driven fetches and CSS transitions settle before capturing.
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(IMG_DIR, file), fullPage: false });
  steps.push({ file, title, caption });
  console.log(`  [${stepNo}] ${title}`);
}

async function waitForHealthz() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server never became healthy at ${BASE}/healthz`);
}

if (!existsSync(path.join(webRoot, 'dist', 'index.html'))) {
  console.log('dist missing — building the SPA first…');
  execFileSync('pnpm', ['--filter', '@shipwright/web', 'run', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}

const home = mkdtempSync(path.join(os.tmpdir(), 'shipwright-tour-home-'));
const stateDb = path.join(home, 'tour-state.db');
const projectDir = mkdtempSync(path.join(os.tmpdir(), 'shipwright-tour-project-'));
rmSync(IMG_DIR, { recursive: true, force: true });
mkdirSync(IMG_DIR, { recursive: true });

console.log('booting apps/server…');
const server = spawn(TSX_BIN, ['src/api/main.ts'], {
  cwd: serverRoot,
  env: {
    ...process.env,
    SHIPWRIGHT_HOME: home,
    SHIPWRIGHT_PORT: String(PORT),
    SHIPWRIGHT_STATE_DB: stateDb,
  },
  stdio: 'ignore',
});

try {
  await waitForHealthz();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.emulateMedia({ reducedMotion: 'reduce' });

  // ── Fleet ────────────────────────────────────────────────────────────
  await page.goto(BASE);
  await page.getByRole('heading', { name: 'Fleet' }).waitFor();
  await shoot(
    page,
    'fleet-empty',
    'Fleet home (first launch)',
    'The entry screen with no projects yet. The header offers the three ways in: **New Product**, **Onboard existing repo**, and **Import**.',
  );

  await page
    .locator('.fleet__header')
    .getByRole('button', { name: 'New Product', exact: true })
    .click();
  await page.getByLabel('Directory path').fill(projectDir);
  await page.getByLabel('Name (optional)').fill('Demo Voyage');
  await shoot(
    page,
    'new-product-form',
    'New Product form',
    'Clicking **New Product** opens the creation form: a directory path and an optional display name.',
  );

  await page.locator('.fleet__form').getByRole('button', { name: 'New Product' }).click();
  await page.locator('.project-card', { hasText: 'Demo Voyage' }).waitFor();
  await shoot(
    page,
    'project-created',
    'Project registered on the Fleet',
    'The project appears as a card in **Ready** state with Open and Archive actions.',
  );

  // ── Workspace ────────────────────────────────────────────────────────
  await page
    .locator('.project-card', { hasText: 'Demo Voyage' })
    .getByRole('button', { name: 'Open' })
    .click();
  await page.getByTestId('split-pane-workspace').waitFor();
  const projectId = new URL(page.url()).searchParams.get('project');
  await shoot(
    page,
    'workspace-empty',
    'Project workspace (three-pane)',
    'Opening a project lands on the split-pane workspace: **Chat** (left, showing the guided sample thread), **Board** (center), **Artifacts** (right). Board and Artifacts state their empty conditions honestly rather than showing fabricated data.',
  );

  // ── Board, seeded through the real event log ─────────────────────────
  const projectDb = path.join(projectDir, '.shipwright', 'state.db');
  execFileSync(TSX_BIN, [SEED_SCRIPT, projectDb, 'basic'], { stdio: 'inherit' });
  execFileSync(TSX_BIN, [path.join(here, 'seed-tour-trace.mjs'), projectDb], {
    stdio: 'inherit',
  });
  await page.reload();
  await page.getByTestId('card-E2E-1').waitFor();
  await shoot(
    page,
    'board-seeded',
    'Board with live tickets',
    'Tickets seeded through the real hash-chained event log (`seed-board-tickets.mjs`): ready, blocked-on-dependency, and accepted tickets across lanes.',
  );

  await page.getByTestId('card-E2E-1').click();
  await page.getByTestId('ticket-drawer').waitFor();
  await shoot(
    page,
    'ticket-drawer',
    'Ticket drawer',
    'Clicking a card opens the drawer: state, lane, write scope, dependency chips, telemetry, and the **session trace** entry point.',
  );

  // ── Session trace ────────────────────────────────────────────────────
  await page.getByTestId('open-session-trace').click();
  await page.getByTestId('trace-view').waitFor();
  await page.getByRole('button', { name: /View session trace — run-tour-1/ }).click();
  await page.getByTestId('trace-event-list').waitFor({ timeout: 5000 }).catch(() => {});
  await shoot(
    page,
    'session-trace',
    'Session trace replay',
    'The trace view replays a run’s real events — loop passes, gate receipts, escalation rungs — each one feeding the lessons form (BLUEPRINT §12.4).',
  );

  // ── Improvement plan ─────────────────────────────────────────────────
  // String form: the expression runs in the browser, where `window` exists —
  // an arrow function here would trip node-side no-undef.
  const token = await page.evaluate('window.__SHIPWRIGHT_TOKEN__');
  const snapshot = {
    phase: null,
    receipts: { staleCount: 2 },
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
  };
  await page.request.post(`${BASE}/api/v1/projects/${projectId}/plan/evaluate`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { snapshot },
  });
  await page.goto(`${BASE}/?project=${projectId}&view=plans`);
  await page.getByTestId('plan-item-PC-001').waitFor();
  await shoot(
    page,
    'improvement-plan',
    'Improvement Plan view',
    'A snapshot evaluation proposed **PC-001** from the plan catalog, with its provenance, verify criterion, and Accept/Dismiss actions plus the raw-findings funnel.',
  );

  // ── Notifications / morning queue ────────────────────────────────────
  await page.request.post(`${BASE}/api/v1/projects/${projectId}/notifications`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      tier: 'decide',
      kind: 'approval',
      title: 'Merge the demo branch',
      body: { diffStat: '+120 -4' },
    },
  });
  await page.request.post(`${BASE}/api/v1/projects/${projectId}/notifications`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      tier: 'review',
      kind: 'gate_passed',
      title: 'Gate A passed',
      summary: 'all validators green',
    },
  });
  await page.goto(`${BASE}/?view=notifications`);
  await page.getByTestId('morning-queue-list').waitFor();
  await shoot(
    page,
    'morning-queue',
    'Morning queue',
    'The signature screen (UX_SPEC §7): Decide items get inline **Approve/Reject**; Review items batch into a digest. The elapsed timer nudges toward the ten-minute review.',
  );

  // ── Roster & settings ────────────────────────────────────────────────
  await page.goto(`${BASE}/?view=roster`);
  await page.getByTestId('roster-view').waitFor({ timeout: 5000 }).catch(() => {});
  await shoot(
    page,
    'roster',
    'Expert roster',
    'The imported expert library (`content/experts/`) — the specialist roles the pipeline dispatches, with their provenance.',
  );

  await page.goto(`${BASE}/?view=settings`);
  await shoot(
    page,
    'settings',
    'Settings',
    'Providers, credentials (keychain refs only — never raw secrets), and per-project configuration.',
  );

  // ── Shortcuts & theming ──────────────────────────────────────────────
  await page.goto(BASE);
  await page.getByRole('heading', { name: 'Fleet' }).waitFor();
  await page.keyboard.press('?');
  await page.getByTestId('shortcuts-overlay').waitFor();
  await shoot(
    page,
    'shortcuts',
    'Keyboard shortcuts overlay',
    'Press **?** anywhere for the shortcut map; Escape closes it.',
  );
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /switch to/i }).click();
  await shoot(
    page,
    'dark-theme',
    'Theme toggle',
    'One click switches light/dark; the choice persists across reloads.',
  );

  await browser.close();

  // ── TOUR.md ──────────────────────────────────────────────────────────
  const md = [
    '# Shipwright — screenshot tour',
    '',
    'A scribe-style walkthrough of the shipped product, captured against the',
    'real server + real event log with zero mocks (Law 9 local-first: no',
    'network, throwaway `.shipwright` home). Regenerate any time with:',
    '',
    '```sh',
    'pnpm --filter @shipwright/web run build   # if dist/ is stale',
    'node apps/web/scripts/capture-tour.mjs',
    '```',
    '',
    ...steps.flatMap((s, i) => [
      `## Step ${i + 1} — ${s.title}`,
      '',
      s.caption,
      '',
      `![${s.title}](img/${s.file})`,
      '',
    ]),
  ].join('\n');
  writeFileSync(path.join(OUT_DIR, 'TOUR.md'), md);
  console.log(`\nwrote ${steps.length} steps to docs/tour/TOUR.md`);
} finally {
  server.kill();
  rmSync(home, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
}
