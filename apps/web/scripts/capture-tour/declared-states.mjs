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
 * mis-slug bug was found in and every Settings tab again in dark. Decisions
 * and Lessons are real, tested components (`decisions/DecisionsBoard.tsx`,
 * `lessons/TriageQueue.tsx`) that no ticket has ever mounted into
 * `App.tsx` — W5-14 and W7-05 both left this as an explicit HANDOFF, and
 * `apps/web/src/**` sits outside this ticket's write_scope, so they're
 * declared WAIVED rather than faked or silently dropped.
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
  {
    id: 'decisions',
    waiver:
      "DecisionsBoard.tsx is built and unit-tested but never mounted in App.tsx (plan.json W5-14 HANDOFF) — wiring it is out of this write_scope (apps/web/src/** is not in W10-37's write_scope).",
  },
  {
    id: 'lessons',
    waiver:
      'TriageQueue.tsx is built and unit-tested but never mounted in App.tsx (plan.json W7-05 HANDOFF, "TriageQueue.tsx mount remains the one open HONEST GAP") — same out-of-scope constraint as Decisions.',
  },
];
