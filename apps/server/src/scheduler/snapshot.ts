/**
 * Assembles a live `PlanEvaluationSnapshot` (FR-PLAN1) from whatever real
 * producers already exist in `apps/server` — the piece `packages/pipeline/
 * src/plans/types.ts`'s header names as this ticket's job ("the wiring
 * ticket, W5-15, assembles the real one").
 *
 * Only two of the eleven sub-objects have a real live source today:
 *   - `rules.fpHeavyCount`: the project's own `rule_state` table (D-014's
 *     demotion flag — same source `rules-routes.ts` already serves).
 *   - `planItems.regressedCount`: the project's own `plan_items` table,
 *     self-referential per the design doc's state diagram (a prior
 *     evaluation's regressed items feed the next one).
 *
 * Every other field reports 0 rather than a fabricated number (C-1 local-
 * first honesty — same precedent `apps/server/src/api/projects.ts`'s
 * `ProjectCard` already sets for berths/Decide-queue/spend). Concretely:
 * `packages/loop`'s coverage tracker and finding ledger
 * (`createCoverageTracker`/`createFindingLedger`) are in-memory, per-run-
 * session objects with no persisted store anywhere in this repo yet
 * (confirmed: zero callers of `toCoverageReportJson`/`createFindingLedger`
 * outside `packages/loop` itself) — importing `@shipwright/loop` here would
 * add a dependency with nothing real to read, so it isn't added. A
 * project-level spend ledger, gate-fixture inventory, provider ToS
 * registry, oscillating-ticket detector, and `global_playbook` staleness
 * tracker likewise have no producer yet.
 *
 * This is safe, not just honest: every catalog condition in
 * `content/plan-catalog/catalog.v1.json` is a strict `> 0` (or, for
 * PC-007, `> 3`) test, so a 0-filled field can never satisfy a condition —
 * it only ever suppresses a proposal that isn't real, never fabricates
 * one. HANDOFF: each zero-filled field becomes real the moment its owning
 * subsystem persists something queryable here; no change needed beyond
 * replacing the literal `0`.
 *
 * GUARDED (was a known limitation): `verifyPlan` re-checks every
 * accepted/in_progress/done item against whatever snapshot it is given,
 * regardless of which fields that item's own `verifyCriterion` actually
 * depends on. An item proposed via the `/plan/evaluate` HTTP route with a
 * caller-supplied non-zero coverage/findings snapshot could otherwise be
 * re-verified — and wrongly flipped to `done` — by this scheduler's
 * zero-filled nightly snapshot, since e.g. `coverage.requiredSkipped == 0`
 * always reads as satisfied.
 *
 * The principled fix (an unknown/null variant threaded through
 * `PlanEvaluationSnapshot` itself, `packages/pipeline/src/plans/types.ts`)
 * is outside this ticket's write_scope (`apps/server/src/scheduler/**`,
 * `server.ts`, `package.json` only) — HANDOFF: a follow-up ticket should add
 * that plus an optional per-item filter on `verifyPlan`
 * (`apps/server/src/api/plans-store.ts`) for true per-item granularity.
 * Until then, `LIVE_SNAPSHOT_PATHS`/`unresolvedSnapshotPaths` below let
 * `runNightlyVerify` (`plan-scheduler.ts`) detect, per project, whether any
 * verifiable-state item's criterion depends on a field with no live
 * producer — and if so, skip that project's nightly `verifyPlan` pass
 * entirely rather than let a fabricated zero satisfy it. This is coarser
 * than true per-item skip (a genuinely-live item sharing a project with a
 * non-live one also waits), but it never fabricates a `done`/`regressed`
 * verdict, which is what C-1 local-first honesty requires.
 */

import type { PlanEvaluationSnapshot } from '@shipwright/pipeline';
import { listPlanItems } from '../api/plans-store.js';
import { listRuleStates } from '../api/server/rule-state-store.js';

/** Snapshot dot-paths `buildPlanEvaluationSnapshot` derives from a real, live source today. */
export const LIVE_SNAPSHOT_PATHS: ReadonlySet<string> = new Set([
  'rules.fpHeavyCount',
  'planItems.regressedCount',
]);

const DOTTED_PATH_RE = /[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)+/g;

/** Strips quoted string literals so their contents can't masquerade as dotted paths. */
function stripStringLiterals(criterion: string): string {
  return criterion.replace(/'[^']*'|"[^"]*"/g, '');
}

/** Every `a.b`-style `PlanEvaluationSnapshot` path a criterion (`expr.ts` grammar) references. */
export function referencedSnapshotPaths(criterion: string): readonly string[] {
  return stripStringLiterals(criterion).match(DOTTED_PATH_RE) ?? [];
}

/** Paths `criterion` references that have no live producer yet (see `LIVE_SNAPSHOT_PATHS`). */
export function unresolvedSnapshotPaths(criterion: string): readonly string[] {
  return referencedSnapshotPaths(criterion).filter((p) => !LIVE_SNAPSHOT_PATHS.has(p));
}

export async function buildPlanEvaluationSnapshot(
  projectPath: string,
): Promise<PlanEvaluationSnapshot> {
  const [ruleStates, { funnel }] = await Promise.all([
    listRuleStates(projectPath),
    listPlanItems(projectPath),
  ]);
  const fpHeavyCount = ruleStates.filter(
    (rule) => rule.state === 'gate' && rule.demotionFlagged,
  ).length;

  return {
    phase: null,
    receipts: { staleCount: 0 },
    coverage: { requiredSkipped: 0 },
    findings: { openCriticalUnwaived: 0 },
    rules: { fpHeavyCount },
    tickets: { oscillatingCount: 0, blockedWithEvidenceMaxAgeDays: 0 },
    spend: { thresholdBreachRepeatCount: 0 },
    gates: { missingRedFixtureCount: 0 },
    providers: { unverifiedTosCount: 0 },
    deliverables: { orphanedCount: 0 },
    planItems: { regressedCount: funnel.regressed },
    playbook: { staleEntryCount: 0 },
  };
}
