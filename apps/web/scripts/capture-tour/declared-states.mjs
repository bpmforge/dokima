/**
 * The declared coverage denominator for the screenshot tour (W10-37 AC3/
 * AC4): every Settings tab (`SettingsPage.tsx`'s `PROJECT_TABS`) plus the
 * full state list `capture-tour/index.mjs` walks. `createCoverageTracker`
 * (`../lib/state-coverage.mjs`) throws in `finish()` if anything declared
 * here is neither captured nor waived.
 */

/** Every Settings tab — walked in both themes. */
export const SETTINGS_TABS = [
  { label: 'Models', testId: 'model-matrix-panel', slug: 'settings-model-matrix' },
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
  {
    label: 'Validator Packs',
    testId: 'validator-packs-panel',
    slug: 'settings-validators',
  },
  {
    label: 'Expert Overrides',
    testId: 'expert-overrides-panel',
    slug: 'settings-experts',
  },
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
 * mis-slug bug was found in and every Settings tab again in dark, plus
 * Decisions and Lessons (W22-25 — both reachable and captured; see the note
 * beside them below for what their waivers used to claim).
 */
export const DECLARED_STATES = [
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
  ...SETTINGS_TABS.map((t, i) => ({
    id: `${String(14 + i).padStart(2, '0')}-${t.slug}`,
  })),
  ...['25-shortcuts', '26-theme-toggle'].map((id) => ({ id })),
  ...['dark/01-fleet-empty', 'dark/02-workspace-empty'].map((id) => ({ id })),
  ...SETTINGS_TABS.map((t, i) => ({
    id: `dark/${String(3 + i).padStart(2, '0')}-${t.slug}`,
  })),
  // W22-25: both were WAIVED here as "built and never mounted", and by
  // 2026-08-31 neither waiver was true in the same way. Decisions had been
  // mounted since W10-72 and this table never caught up — a reachability
  // instrument asserting a live surface was unreachable. Lessons genuinely had
  // no route, and nothing but this waiver knew. Both are captured now, so the
  // table states what the product does rather than what it did.
  { id: 'decisions' },
  { id: 'lessons' },
];
