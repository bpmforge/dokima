/**
 * Captures the scribe-style screenshot tour under `docs/tour/` by driving
 * the real product — see `lib/app-harness.mjs` for the boot/seed seams
 * (real build, real server, throwaway home, sanctioned seeding only,
 * Law 9: zero mocks, zero network).
 *
 * Two passes, each against its own fresh app instance (never a theme
 * re-toggled onto an already-populated app — that's exactly how the
 * mis-slugged dark/01-fleet-empty and dark/04-workspace-empty screenshots
 * happened, W10-37): a light-theme walkthrough (`img/`, the main narrative
 * in TOUR.md, same flat layout `README.md`'s hero image and
 * `docs/work/RESUME_2026-08-02.md`'s historical note already link into —
 * step order is chosen so `05-board-seeded` and `09-morning-queue` keep
 * their numbers) and a dark-theme pass (`img/dark/`) that re-proves the two
 * empty states and sweeps every Settings tab. Every state either gets
 * captured or is declared WAIVED up front with a reason
 * (`lib/state-coverage.mjs`) — `tracker.finish()` throws if anything was
 * silently skipped, so the sweep can't sign off on coverage it doesn't have
 * (W10-37 AC4, UX_SPEC §2b).
 *
 * Run from the repo root or apps/web:  node apps/web/scripts/capture-tour.mjs
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { PLAN_SNAPSHOT, repoRoot, seedDemoBoard, startApp } from './lib/app-harness.mjs';
import { createCoverageTracker } from './lib/state-coverage.mjs';

const LIGHT_PORT = 4407;
const DARK_PORT = 4408;
const OUT_DIR = path.join(repoRoot, 'docs', 'tour');
const IMG_DIR = path.join(OUT_DIR, 'img');
const PALETTE_OPEN_KEY = process.platform === 'darwin' ? 'Meta+k' : 'Control+k';

/** Every Settings tab (`SettingsPage.tsx`'s `PROJECT_TABS`) — walked in both themes. */
const SETTINGS_TABS = [
  { label: 'Model Matrix', testId: 'model-matrix-panel', slug: 'settings-model-matrix' },
  {
    label: 'Autonomy · Budget · Berths',
    testId: 'autonomy-budget-panel',
    slug: 'settings-autonomy-budget',
  },
  { label: 'Cost Estimate', testId: 'estimate-workspace', slug: 'settings-estimate' },
  {
    label: 'Effective Settings',
    testId: 'effective-settings-panel',
    slug: 'settings-effective',
  },
  { label: 'MCP Servers', testId: 'mcp-servers-panel', slug: 'settings-mcp' },
  { label: 'Validator Packs', testId: 'validator-packs-panel', slug: 'settings-validators' },
  { label: 'Expert Overrides', testId: 'expert-overrides-panel', slug: 'settings-experts' },
  { label: 'Rule Lifecycle', testId: 'rule-lifecycle-panel', slug: 'settings-rules' },
  { label: 'Suppressions', testId: 'suppressions-panel', slug: 'settings-suppressions' },
  {
    label: 'Escalation Policy',
    testId: 'escalation-policy-panel',
    slug: 'settings-escalation',
  },
  { label: 'Copilot', testId: 'copilot-consent-panel', slug: 'settings-copilot' },
];

/**
 * The full denominator this sweep signs off on (W10-37 AC3/AC4): 11
 * project-scoped Settings tabs + the no-project Settings state = the
 * ticket's "twelve tabs", each walked in light, plus the two states the
 * mis-slug bug was found in and every Settings tab again in dark. Decisions
 * and Lessons are real, tested components (`decisions/DecisionsBoard.tsx`,
 * `lessons/TriageQueue.tsx`) that no ticket has ever mounted into
 * `App.tsx` — W5-14 and W7-05 both left this as an explicit HANDOFF, and
 * `apps/web/src/**` sits outside this ticket's write_scope, so they're
 * declared WAIVED rather than faked or silently dropped.
 */
const DECLARED_STATES = [
  ...[
    '01-fleet-empty',
    '02-new-product-form',
    '03-project-created',
    '04-workspace-empty',
    '05-board-seeded',
    '06-ticket-drawer',
    '07-session-trace',
    '08-improvement-plan',
    '09-morning-queue',
    '10-roster',
    '11-settings-no-project',
    '12-palette-no-query',
    '13-palette-query',
  ].map((id) => ({ id })),
  ...SETTINGS_TABS.map((t, i) => ({ id: `${String(14 + i).padStart(2, '0')}-${t.slug}` })),
  ...['25-shortcuts', '26-theme-toggle'].map((id) => ({ id })),
  ...['dark/01-fleet-empty', 'dark/02-workspace-empty'].map((id) => ({ id })),
  ...SETTINGS_TABS.map((t, i) => ({ id: `dark/${String(3 + i).padStart(2, '0')}-${t.slug}` })),
  {
    id: 'decisions',
    waiver:
      'DecisionsBoard.tsx is built and unit-tested but never mounted in App.tsx (plan.json W5-14 HANDOFF) — wiring it is out of this write_scope (apps/web/src/** is not in W10-37\'s write_scope).',
  },
  {
    id: 'lessons',
    waiver:
      'TriageQueue.tsx is built and unit-tested but never mounted in App.tsx (plan.json W7-05 HANDOFF, "TriageQueue.tsx mount remains the one open HONEST GAP") — same out-of-scope constraint as Decisions.',
  },
];

const tracker = createCoverageTracker(DECLARED_STATES);
const lightSteps = [];
const darkSteps = [];

/**
 * Screenshots the current page for declared state `id` — `dark/…` writes
 * under `img/dark/`, everything else writes flat under `img/` (matching
 * `README.md`'s and `RESUME_2026-08-02.md`'s existing links). `requireTestId`,
 * when given, is waited for first — for a state named "empty" this is the
 * actual emptiness assertion (W10-37 AC2): `fleet-empty`/`board-empty` only
 * exist in the DOM when the underlying list truly has zero items, so a
 * populated screen simply times out here instead of getting slugged as empty.
 */
async function shoot(page, id, title, caption, requireTestId) {
  if (requireTestId) {
    await page.getByTestId(requireTestId).waitFor({ timeout: 5000 });
  }
  const isDark = id.startsWith('dark/');
  const file = `${isDark ? id.slice('dark/'.length) : id}.png`;
  const relPath = isDark ? path.join('dark', file) : file;
  // Let poll-driven fetches and CSS transitions settle before capturing.
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(IMG_DIR, relPath), fullPage: false });
  tracker.capture(id);
  (isDark ? darkSteps : lightSteps).push({ file: relPath, title, caption });
  console.log(`  [${id}] ${title}`);
}

async function captureSettingsTabs(page, idPrefix, startIndex) {
  for (const [i, tab] of SETTINGS_TABS.entries()) {
    await page
      .locator('nav.settings__tabs')
      .getByRole('button', { name: tab.label, exact: true })
      .click();
    await shoot(
      page,
      `${idPrefix}${String(startIndex + i).padStart(2, '0')}-${tab.slug}`,
      `Settings — ${tab.label}`,
      `The **${tab.label}** tab of the Settings surface (UX_SPEC §6/§6a).`,
      tab.testId,
    );
  }
}

rmSync(IMG_DIR, { recursive: true, force: true });
mkdirSync(path.join(IMG_DIR, 'dark'), { recursive: true });

// ── Light-theme pass: the main walkthrough ──────────────────────────────
console.log('booting apps/server (light pass)…');
const lightApp = await startApp(LIGHT_PORT);
try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });

  // ── Fleet ────────────────────────────────────────────────────────────
  await page.goto(lightApp.base);
  await page.getByRole('heading', { name: 'Fleet' }).waitFor();
  await shoot(
    page,
    '01-fleet-empty',
    'Fleet home (first launch)',
    'The entry screen with no projects yet. The header offers the three ways in: **New Product**, **Onboard existing repo**, and **Import**.',
    'fleet-empty',
  );

  await page
    .locator('.fleet__header')
    .getByRole('button', { name: 'New Product', exact: true })
    .click();
  await page.getByLabel('Directory path').fill(lightApp.projectDir);
  await page.getByLabel('Name (optional)').fill('Demo Voyage');
  await shoot(
    page,
    '02-new-product-form',
    'New Product form',
    'Clicking **New Product** opens the creation form: a directory path and an optional display name.',
  );

  await page.locator('.fleet__form').getByRole('button', { name: 'New Product' }).click();
  await page.locator('.project-card', { hasText: 'Demo Voyage' }).waitFor();
  await shoot(
    page,
    '03-project-created',
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
    '04-workspace-empty',
    'Project workspace (three-pane)',
    'Opening a project lands on the split-pane workspace: **Chat** (left, showing the guided sample thread), **Board** (center), **Artifacts** (right). Board and Artifacts state their empty conditions honestly rather than showing fabricated data.',
    'board-empty',
  );

  // ── Board, seeded through the real event log ─────────────────────────
  seedDemoBoard(lightApp.projectDir);
  await page.reload();
  await page.getByTestId('card-E2E-1').waitFor();
  await shoot(
    page,
    '05-board-seeded',
    'Board with live tickets',
    'Tickets seeded through the real hash-chained event log (`seed-board-tickets.mjs`): ready, blocked-on-dependency, and accepted tickets across lanes.',
  );

  await page.getByTestId('card-E2E-1').click();
  await page.getByTestId('ticket-drawer').waitFor();
  await shoot(
    page,
    '06-ticket-drawer',
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
    '07-session-trace',
    'Session trace replay',
    'The trace view replays a run’s real events — loop passes, gate receipts, escalation rungs — each one feeding the lessons form (BLUEPRINT §12.4).',
  );

  // ── Improvement plan ─────────────────────────────────────────────────
  // String form: the expression runs in the browser, where `window` exists —
  // an arrow function here would trip node-side no-undef.
  const token = await page.evaluate('window.__DOKIMA_TOKEN__');
  await page.request.post(`${lightApp.base}/api/v1/projects/${projectId}/plan/evaluate`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { snapshot: PLAN_SNAPSHOT },
  });
  await page.goto(`${lightApp.base}/?project=${projectId}&view=plans`);
  await page.getByTestId('plan-item-PC-001').waitFor();
  await shoot(
    page,
    '08-improvement-plan',
    'Improvement Plan view',
    'A snapshot evaluation proposed **PC-001** from the plan catalog, with its provenance, verify criterion, and Accept/Dismiss actions plus the raw-findings funnel.',
  );

  // ── Notifications / morning queue ────────────────────────────────────
  await page.request.post(`${lightApp.base}/api/v1/projects/${projectId}/notifications`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      tier: 'decide',
      kind: 'approval',
      title: 'Merge the demo branch',
      body: { diffStat: '+120 -4' },
    },
  });
  await page.request.post(`${lightApp.base}/api/v1/projects/${projectId}/notifications`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      tier: 'review',
      kind: 'gate_passed',
      title: 'Gate A passed',
      summary: 'all validators green',
    },
  });
  await page.goto(`${lightApp.base}/?view=notifications`);
  await page.getByTestId('morning-queue-list').waitFor();
  await shoot(
    page,
    '09-morning-queue',
    'Morning queue',
    'The signature screen (UX_SPEC §7): Decide items get inline **Approve/Reject**; Review items batch into a digest. The elapsed timer nudges toward the ten-minute review.',
  );

  // ── Roster & settings ────────────────────────────────────────────────
  await page.goto(`${lightApp.base}/?view=roster`);
  await page.getByTestId('roster-view').waitFor({ timeout: 5000 }).catch(() => {});
  await shoot(
    page,
    '10-roster',
    'Expert roster',
    'The imported expert library (`content/experts/`) — the specialist roles the pipeline dispatches, with their provenance.',
  );

  // Settings, reachable with no project open (`?view=settings` with no
  // `project` query param — the "twelfth tab" alongside the eleven below).
  await page.goto(`${lightApp.base}/?view=settings`);
  await page.locator('.settings__no-project').waitFor();
  await shoot(
    page,
    '11-settings-no-project',
    'Settings (no project open)',
    'Global Settings is deliberately thin: model matrix, autonomy dial, budgets, and scopes are per-project — this view is just the Setup Wizard entry point.',
  );

  // ── Command palette ──────────────────────────────────────────────────
  await page.goto(`${lightApp.base}/?project=${projectId}`);
  await page.getByTestId('split-pane-workspace').waitFor();
  await page.keyboard.press(PALETTE_OPEN_KEY);
  await page.getByTestId('command-palette').waitFor();
  await shoot(
    page,
    '12-palette-no-query',
    'Command palette (⌘K)',
    'Pressing **⌘K**/**Ctrl+K** anywhere opens the palette: the "What are we doing today?" mode picker, with no results because nothing has been typed yet.',
    'palette-modes',
  );

  await page.getByTestId('command-palette-input').fill('E2E-1');
  await shoot(
    page,
    '13-palette-query',
    'Command palette — query results',
    'Typing **E2E-1** jumps straight to the exact-id match; every result is keyboard-reachable (WCAG 2.2 combobox pattern).',
    'palette-result-ticket:E2E-1',
  );
  await page.keyboard.press('Escape');

  await page.goto(`${lightApp.base}/?project=${projectId}&view=settings`);
  await page.getByTestId('settings-page').waitFor();
  await captureSettingsTabs(page, '', 14);

  // ── Shortcuts & theming ──────────────────────────────────────────────
  await page.goto(lightApp.base);
  await page.getByRole('heading', { name: 'Fleet' }).waitFor();
  await page.keyboard.press('?');
  await page.getByTestId('shortcuts-overlay').waitFor();
  await shoot(
    page,
    '25-shortcuts',
    'Keyboard shortcuts overlay',
    'Press **?** anywhere for the shortcut map; Escape closes it.',
  );
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /switch to/i }).click();
  await shoot(
    page,
    '26-theme-toggle',
    'Theme toggle',
    'One click switches light/dark; the choice persists across reloads.',
  );

  await browser.close();
} finally {
  lightApp.stop();
}

// ── Dark-theme pass: fresh app instance, never a re-toggle ──────────────
console.log('booting apps/server (dark pass)…');
const darkApp = await startApp(DARK_PORT);
try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });

  await page.goto(darkApp.base);
  await page.getByRole('heading', { name: 'Fleet' }).waitFor();
  await shoot(
    page,
    'dark/01-fleet-empty',
    'Fleet home, dark theme (first launch)',
    'The same first-launch emptiness as the light pass, verified independently in dark theme against its own fresh app instance — never a re-toggle onto an already-populated app.',
    'fleet-empty',
  );

  await page
    .locator('.fleet__header')
    .getByRole('button', { name: 'New Product', exact: true })
    .click();
  await page.getByLabel('Directory path').fill(darkApp.projectDir);
  await page.getByLabel('Name (optional)').fill('Demo Voyage');
  await page.locator('.fleet__form').getByRole('button', { name: 'New Product' }).click();
  await page.locator('.project-card', { hasText: 'Demo Voyage' }).waitFor();
  await page
    .locator('.project-card', { hasText: 'Demo Voyage' })
    .getByRole('button', { name: 'Open' })
    .click();
  await page.getByTestId('split-pane-workspace').waitFor();
  const darkProjectId = new URL(page.url()).searchParams.get('project');
  await shoot(
    page,
    'dark/02-workspace-empty',
    'Project workspace, dark theme (unseeded)',
    'The board pane genuinely empty in dark theme — the state that got mis-slugged in the earlier ad-hoc sweep.',
    'board-empty',
  );

  await page.goto(`${darkApp.base}/?project=${darkProjectId}&view=settings`);
  await page.getByTestId('settings-page').waitFor();
  await captureSettingsTabs(page, 'dark/', 3);

  await browser.close();
} finally {
  darkApp.stop();
}

// ── Coverage report — declared vs. captured, per W10-37 AC4 ─────────────
const coverage = tracker.finish();

// ── TOUR.md ──────────────────────────────────────────────────────────
const coverageTable = [
  '| State | Status | Notes |',
  '|---|---|---|',
  ...coverage.map(
    (c) =>
      `| \`${c.id}\` | ${c.status.toUpperCase()} | ${c.reason ? c.reason.replace(/\|/g, '\\|') : ''} |`,
  ),
].join('\n');

const md = [
  '# Dokima — screenshot tour',
  '',
  'A scribe-style walkthrough of the shipped product, captured against the',
  'real server + real event log with zero mocks (Law 9 local-first: no',
  'network, throwaway `.dokima` home). Two independent passes — light theme',
  '(the main walkthrough below) and dark theme (`img/dark/`, a second fresh',
  'app instance) — plus every Settings tab in both themes. Regenerate any',
  'time with:',
  '',
  '```sh',
  'node apps/web/scripts/capture-tour.mjs   # always rebuilds dist/ first',
  '```',
  '',
  ...lightSteps.flatMap((s, i) => [
    `## Step ${i + 1} — ${s.title}`,
    '',
    s.caption,
    '',
    `![${s.title}](img/${s.file})`,
    '',
  ]),
  '## Dark theme & Settings sweep',
  '',
  'Independently verified in dark theme against a fresh app instance: the',
  'two states above whose emptiness matters (Fleet home, unseeded',
  'workspace) plus every Settings tab.',
  '',
  ...darkSteps.flatMap((s) => [
    `### ${s.title}`,
    '',
    s.caption,
    '',
    `![${s.title}](img/${s.file})`,
    '',
  ]),
  '## Coverage',
  '',
  'Every state this sweep declared it would cover, and what happened to it',
  '(W10-37 AC4 — a sweep that cannot report its own coverage cannot sign off',
  'UX_SPEC §2b). `WAIVED` states are real, tested components with no route',
  'that reaches them yet; see the reason column.',
  '',
  coverageTable,
  '',
].join('\n');
writeFileSync(path.join(OUT_DIR, 'TOUR.md'), md);
console.log(
  `\nwrote ${lightSteps.length} light + ${darkSteps.length} dark steps to docs/tour/TOUR.md (${coverage.length} declared states, ${coverage.filter((c) => c.status === 'waived').length} waived)`,
);
