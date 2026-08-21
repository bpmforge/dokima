/**
 * The light-theme pass: the main walkthrough (`img/`, TOUR.md's numbered
 * steps 1-26) against its own fresh app instance — Fleet through the
 * command palette, every Settings tab, shortcuts, and the theme toggle.
 */
import { PLAN_SNAPSHOT, seedDemoBoard } from '../lib/app-harness.mjs';
import { captureSettingsTabs, shoot } from './shoot.mjs';

const PALETTE_OPEN_KEY = process.platform === 'darwin' ? 'Meta+k' : 'Control+k';

export async function runLightPass(browser, app, ctx) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });

  // ── Fleet ────────────────────────────────────────────────────────────
  await page.goto(app.base);
  await page.getByRole('heading', { name: 'Fleet' }).waitFor();
  await shoot(
    page,
    '01-fleet-empty',
    'Fleet home (first launch)',
    'The entry screen with no projects yet. The header offers the three ways in: **New project**, **Onboard existing repo**, and **Import**.',
    'fleet-empty',
    ctx,
  );

  await page
    .locator('.fleet__header')
    .getByRole('button', { name: 'New project', exact: true })
    .click();
  // W12-41 flow: New project asks only a name; the tour takes the
  // explicit-location escape (same as roster.spec.ts) so its throwaway
  // projectDir is used.
  await page.getByRole('button', { name: 'choose the location' }).click();
  await page.getByLabel('Folder').fill(app.projectDir);
  await page.getByLabel('Project name').fill('Demo Voyage');
  await shoot(
    page,
    '02-new-product-form',
    'New project form',
    'Clicking **New project** opens the creation form: a project name, with an escape to choose the folder yourself.',
    undefined,
    ctx,
  );

  await page.locator('.fleet__form').getByRole('button', { name: 'Create project' }).click();
  await page.locator('.project-card', { hasText: 'Demo Voyage' }).waitFor();
  await shoot(
    page,
    '03-project-created',
    'Project registered on the Fleet',
    'The project appears as a card with a **Not started** phase chip, Ready/Blocked/Done ticket counters, berth status, and today’s spend — plus Open and Archive actions.',
    undefined,
    ctx,
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
    '04-workspace-empty',
    'Project workspace (three-pane)',
    'Opening a project lands on the split-pane workspace: **Chat** (left, showing the guided sample thread), **Board** (center), **Artifacts** (right). Board and Artifacts state their empty conditions honestly rather than showing fabricated data.',
    'board-empty',
    ctx,
  );

  // ── Board, seeded through the real event log ─────────────────────────
  seedDemoBoard(app.projectDir);
  await page.reload();
  await page.getByTestId('card-E2E-1').waitFor();
  // W15-04 coverage assertions: the W13-59/60 surfaces must be in frame.
  await page.getByTestId('board-runbar-hint').waitFor();
  await page.locator('[data-testid^="blocked-why-"]').first().waitFor();
  await shoot(
    page,
    '05-board-seeded',
    'Board with live tickets',
    'Tickets seeded through the real hash-chained event log (`seed-board-tickets.mjs`): ready, blocked-on-dependency, and accepted tickets across lanes.',
    undefined,
    ctx,
  );

  await page.getByTestId('card-E2E-1').click();
  await page.getByTestId('ticket-drawer').waitFor();
  await shoot(
    page,
    '06-ticket-drawer',
    'Ticket drawer',
    'Clicking a card opens the drawer: state, lane, write scope, dependency chips, telemetry, and the **session trace** entry point.',
    undefined,
    ctx,
  );

  // ── Session trace ────────────────────────────────────────────────────
  await page.getByTestId('open-session-trace').click();
  await page.getByTestId('trace-view').waitFor();
  await page.getByRole('button', { name: /View session trace — run-tour-1/ }).click();
  await page
    .getByTestId('trace-event-list')
    .waitFor({ timeout: 5000 })
    .catch(() => {});
  await shoot(
    page,
    '07-session-trace',
    'Session trace replay',
    'The trace view replays a run’s real events — loop passes, gate receipts, escalation rungs — each one feeding the lessons form (BLUEPRINT §12.4).',
    undefined,
    ctx,
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
    '08-improvement-plan',
    'Improvement Plan view',
    'A snapshot evaluation proposed **PC-001** from the plan catalog, with its provenance, verify criterion, and Accept/Dismiss actions plus the raw-findings funnel.',
    undefined,
    ctx,
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
  // W15-04: the W14 surfaces join the denominator — a tool approval that
  // SHOWS THE WORK and the consolidation pre-brief. Seeded with the same
  // body shapes the real emitters write (mcp-approvals.ts, consolidation.ts).
  await page.request.post(`${app.base}/api/v1/projects/${projectId}/notifications`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      tier: 'decide',
      kind: 'approval',
      ref_type: 'mcp_tool_call',
      ref_id: 'tour-1',
      title: 'Tool approval: docs-server.search',
      body: {
        serverId: 'docs-server',
        toolId: 'docs-server.search',
        args: { query: 'auth flow' },
        argsDigest: 'abcdef0123456789abcdef',
        requestedBy: 'coding-agent',
        ticketId: 'E2E-1',
      },
    },
  });
  await page.request.post(`${app.base}/api/v1/projects/${projectId}/notifications`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      tier: 'review',
      kind: 'digest',
      ref_type: 'run',
      ref_id: 'run-tour-1',
      title: 'Morning pre-brief — what the fact bank learned',
      summary: '2 duplicate facts merged, 1 stale fact decayed; 1 overnight landmine leads',
    },
  });
  await page.goto(`${app.base}/?view=notifications`);
  await page.getByTestId('morning-queue-list').waitFor();
  // Coverage is ASSERTED, not assumed (W15-04): the tour FAILS if the new
  // surfaces are missing from the frame.
  await page.getByTestId('mcp-approval-evidence').waitFor();
  await page.getByTestId('mcp-approval-args').waitFor();
  await page.getByText('Morning pre-brief — what the fact bank learned').waitFor();
  await shoot(
    page,
    '09-morning-queue',
    'Morning queue',
    'The signature screen (UX_SPEC §7): Decide items get inline **Approve/Reject** with the work on the card — a merge shows its verified manifest, a tool approval shows the exact requested arguments — and Review items (gate results, the morning pre-brief) batch below. The elapsed timer nudges toward the ten-minute review.',
    undefined,
    ctx,
  );

  // ── Roster & settings ────────────────────────────────────────────────
  await page.goto(`${app.base}/?view=roster`);
  await page
    .getByTestId('roster-view')
    .waitFor({ timeout: 5000 })
    .catch(() => {});
  await shoot(
    page,
    '10-roster',
    'Expert roster',
    'The imported expert library (`content/experts/`) — the specialist roles the pipeline dispatches, with their provenance.',
    undefined,
    ctx,
  );

  // Settings, reachable with no project open (`?view=settings` with no
  // `project` query param — the "twelfth tab" alongside the eleven below).
  await page.goto(`${app.base}/?view=settings`);
  await page.locator('.settings__no-project').waitFor();
  await shoot(
    page,
    '11-settings-no-project',
    'Settings (no project open)',
    'Global Settings is deliberately thin: model matrix, autonomy dial, budgets, and scopes are per-project — this view is just the Setup Wizard entry point.',
    undefined,
    ctx,
  );

  // ── Command palette ──────────────────────────────────────────────────
  await page.goto(`${app.base}/?project=${projectId}`);
  await page.getByTestId('split-pane-workspace').waitFor();
  await page.keyboard.press(PALETTE_OPEN_KEY);
  await page.getByTestId('command-palette').waitFor();
  await shoot(
    page,
    '12-palette-no-query',
    'Command palette (⌘K)',
    'Pressing **⌘K**/**Ctrl+K** anywhere opens the palette: the "What are we doing today?" mode picker, with no results because nothing has been typed yet.',
    'palette-modes',
    ctx,
  );

  await page.getByTestId('command-palette-input').fill('E2E-1');
  await shoot(
    page,
    '13-palette-query',
    'Command palette — query results',
    'Typing **E2E-1** jumps straight to the exact-id match; every result is keyboard-reachable (WCAG 2.2 combobox pattern).',
    'palette-result-ticket:E2E-1',
    ctx,
  );
  await page.keyboard.press('Escape');

  await page.goto(`${app.base}/?project=${projectId}&view=settings`);
  await page.getByTestId('settings-page').waitFor();
  await captureSettingsTabs(page, '', 14, ctx);

  // ── Shortcuts & theming ──────────────────────────────────────────────
  await page.goto(app.base);
  await page.getByRole('heading', { name: 'Fleet' }).waitFor();
  await page.keyboard.press('?');
  await page.getByTestId('shortcuts-overlay').waitFor();
  await shoot(
    page,
    '25-shortcuts',
    'Keyboard shortcuts overlay',
    'Press **?** anywhere for the shortcut map; Escape closes it.',
    undefined,
    ctx,
  );
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /switch to/i }).click();
  await shoot(
    page,
    '26-theme-toggle',
    'Theme toggle',
    'One click switches light/dark; the choice persists across reloads.',
    undefined,
    ctx,
  );
}
