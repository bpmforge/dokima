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
 * KNOWN LIMITATION (documented, not fixed here — out of a wiring ticket's
 * scope): `verifyPlan` re-checks every accepted/in_progress/done item
 * against whatever snapshot it is given, regardless of which fields that
 * item's own `verifyCriterion` actually depends on. An item proposed via
 * the `/plan/evaluate` HTTP route with a caller-supplied non-zero
 * coverage/findings snapshot could later be re-verified — and flipped to
 * `done` — by this scheduler's zero-filled nightly snapshot, since e.g.
 * `coverage.requiredSkipped == 0` reads as satisfied. Distinguishing
 * "genuinely zero" from "no live producer yet" needs an unknown/null
 * variant threaded through `PlanEvaluationSnapshot` itself
 * (`packages/pipeline/src/plans/types.ts`, outside this write_scope).
 */

import type { PlanEvaluationSnapshot } from '@shipwright/pipeline';
import { listPlanItems } from '../api/plans-store.js';
import { listRuleStates } from '../api/server/rule-state-store.js';

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
