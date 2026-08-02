/**
 * Captures the scribe-style screenshot tour under `docs/tour/` by driving
 * the real product — see `lib/app-harness.mjs` for the boot/seed seams
 * (real build, real server, throwaway home, sanctioned seeding only,
 * Law 9: zero mocks, zero network).
 *
 * Run from the repo root or apps/web:  node apps/web/scripts/capture-tour.mjs
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { PLAN_SNAPSHOT, repoRoot, seedDemoBoard, startApp } from './lib/app-harness.mjs';

const PORT = 4407;
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

rmSync(IMG_DIR, { recursive: true, force: true });
mkdirSync(IMG_DIR, { recursive: true });

console.log('booting apps/server…');
const app = await startApp(PORT);

try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.emulateMedia({ reducedMotion: 'reduce' });

  // ── Fleet ────────────────────────────────────────────────────────────
  await page.goto(app.base);
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
  await page.getByLabel('Directory path').fill(app.projectDir);
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
    'The project appears as a card with a **Not started** phase chip, Ready/Blocked/Done ticket counters, berth status, and today’s spend — plus Open and Archive actions.',
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
  seedDemoBoard(app.projectDir);
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
  const token = await page.evaluate('window.__DOKIMA_TOKEN__');
  await page.request.post(`${app.base}/api/v1/projects/${projectId}/plan/evaluate`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { snapshot: PLAN_SNAPSHOT },
  });
  await page.goto(`${app.base}/?project=${projectId}&view=plans`);
  await page.getByTestId('plan-item-PC-001').waitFor();
  await shoot(
    page,
    'improvement-plan',
    'Improvement Plan view',
    'A snapshot evaluation proposed **PC-001** from the plan catalog, with its provenance, verify criterion, and Accept/Dismiss actions plus the raw-findings funnel.',
  );

  // ── Notifications / morning queue ────────────────────────────────────
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
  await shoot(
    page,
    'morning-queue',
    'Morning queue',
    'The signature screen (UX_SPEC §7): Decide items get inline **Approve/Reject**; Review items batch into a digest. The elapsed timer nudges toward the ten-minute review.',
  );

  // ── Roster & settings ────────────────────────────────────────────────
  await page.goto(`${app.base}/?view=roster`);
  await page.getByTestId('roster-view').waitFor({ timeout: 5000 }).catch(() => {});
  await shoot(
    page,
    'roster',
    'Expert roster',
    'The imported expert library (`content/experts/`) — the specialist roles the pipeline dispatches, with their provenance.',
  );

  await page.goto(`${app.base}/?view=settings`);
  await shoot(
    page,
    'settings',
    'Settings',
    'The global Settings view is deliberately thin: model matrix, autonomy dial, budgets, and scopes are configured per-project (open a project first), with the Setup Wizard as the entry point.',
  );

  // ── Shortcuts & theming ──────────────────────────────────────────────
  await page.goto(app.base);
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
    '# Dokima — screenshot tour',
    '',
    'A scribe-style walkthrough of the shipped product, captured against the',
    'real server + real event log with zero mocks (Law 9 local-first: no',
    'network, throwaway `.dokima` home). Regenerate any time with:',
    '',
    '```sh',
    'pnpm --filter @dokima/web run build   # if dist/ is stale',
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
  app.stop();
}
