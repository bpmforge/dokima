import type { FindingRecord } from './findings.js';
import {
  classifyIteration,
  type IterationClass,
  type TargetedFindingOutcome,
} from './loop-policy-classify.js';
import {
  createFindingBudgetTracker,
  type FindingBudgetTracker,
  type StallDecision,
} from './loop-policy-budget.js';
import {
  checkConvergence,
  checkProgressCeiling,
  type EconomicTier,
  type PassOpenCount,
} from './loop-policy-convergence.js';

/**
 * Combined per-pass policy decision (CODE_BOOK_PROTOCOL chapter of loop-policy.ts): ties
 * classification (loop-policy-classify.ts) + per-finding budgets (loop-policy-budget.ts) +
 * convergence/ceiling (loop-policy-convergence.ts) into one CONTINUE/CLEARED/ESCALATE/BLOCK/
 * PARK/STOP_DIVERGED decision per pass.
 */

export interface RecordPassInput {
  readonly pass: number;
  /** From `FindingLedger.reportPass()`. */
  readonly newFindingsOpened: number;
  readonly regressedFindings: readonly FindingRecord[];
  /** Findings this pass explicitly rechecked with a RECORDED (non-INCOMPLETE) verdict. */
  readonly recheckedFindings: readonly {
    readonly finding: FindingRecord;
    readonly outcome: 'RESOLVED' | 'STILL_PRESENT';
  }[];
  /** Total OPEN/FIX_ATTEMPTED/REGRESSED findings after this pass — the convergence window's `open_findings`. */
  readonly openFindingsCount: number;
  readonly ticketPoints: number;
  readonly tier: EconomicTier;
}

export type LoopPolicyActionKind =
  'CONTINUE' | 'CLEARED' | 'ESCALATE' | 'BLOCK' | 'PARK' | 'STOP_DIVERGED';

export interface LoopPolicyActionBase {
  readonly kind: LoopPolicyActionKind;
  readonly pass: number;
  readonly iterationClass: IterationClass;
}

export interface LoopPolicyContinue extends LoopPolicyActionBase {
  readonly kind: 'CONTINUE';
}

export interface LoopPolicyCleared extends LoopPolicyActionBase {
  readonly kind: 'CLEARED';
}

export interface LoopPolicyEscalate extends LoopPolicyActionBase {
  readonly kind: 'ESCALATE';
  readonly reason: 'stall' | 'regression';
  readonly findings: readonly FindingRecord[];
}

export interface LoopPolicyBlock extends LoopPolicyActionBase {
  readonly kind: 'BLOCK';
  readonly reason: 'post_escalation_stall' | 'second_oscillation';
  /** The ledger evidence a BLOCK must carry (policy §4 row 2/row 5). */
  readonly findings: readonly FindingRecord[];
}

export interface LoopPolicyPark extends LoopPolicyActionBase {
  readonly kind: 'PARK';
  readonly reason: 'decomposition_signal';
  readonly ceiling: number;
}

export interface LoopPolicyDiverged extends LoopPolicyActionBase {
  readonly kind: 'STOP_DIVERGED';
  readonly reason: 'flat_open_count';
}

export type LoopPolicyAction =
  | LoopPolicyContinue
  | LoopPolicyCleared
  | LoopPolicyEscalate
  | LoopPolicyBlock
  | LoopPolicyPark
  | LoopPolicyDiverged;

export interface LoopConvergenceTracker {
  readonly passesUsed: number;
  readonly openCountHistory: readonly PassOpenCount[];
  recordPass(input: RecordPassInput): LoopPolicyAction;
}

/**
 * Ties classification + per-finding budgets + convergence/ceiling into one per-pass decision.
 * BLOCK/ESCALATE from a specific finding's budget always wins over the pass-level convergence
 * check — a single finding oscillating or exhausting its post-escalation budget is reason
 * enough regardless of how the rest of the pass looks.
 */
export function createLoopConvergenceTracker(
  budgetTracker: FindingBudgetTracker = createFindingBudgetTracker(),
): LoopConvergenceTracker {
  const openCountHistory: PassOpenCount[] = [];
  let passesUsed = 0;

  return {
    get passesUsed() {
      return passesUsed;
    },
    get openCountHistory() {
      return openCountHistory.slice();
    },
    recordPass(input) {
      const targeted: TargetedFindingOutcome[] = input.recheckedFindings.map((r) => ({
        fingerprint: r.finding.fingerprint,
        outcome: r.outcome,
      }));
      const iterationClass = classifyIteration({
        targeted,
        newFindingsOpened: input.newFindingsOpened,
        regressedCount: input.regressedFindings.length,
      });

      // Per-finding budgets: every regressed and every still-present finding is folded into
      // the budget tracker unconditionally first — no early return before all of them have
      // been evaluated, or a later finding's oscillation/tier-attempt count would silently
      // never advance. Only once every decision is collected do we pick the most severe one
      // to report for this pass.
      const regressionOutcomes: { finding: FindingRecord; decision: StallDecision }[] =
        [];
      for (const finding of input.regressedFindings) {
        regressionOutcomes.push({
          finding,
          decision: budgetTracker.evaluate(finding.fingerprint, 'REGRESSED'),
        });
      }
      const stallOutcomes: { finding: FindingRecord; decision: StallDecision }[] = [];
      for (const r of input.recheckedFindings) {
        if (r.outcome !== 'STILL_PRESENT') {
          continue;
        }
        stallOutcomes.push({
          finding: r.finding,
          decision: budgetTracker.evaluate(r.finding.fingerprint, 'STILL_PRESENT'),
        });
      }
      for (const r of input.recheckedFindings) {
        if (r.outcome === 'RESOLVED') {
          budgetTracker.evaluate(r.finding.fingerprint, 'RESOLVED');
        }
      }

      // Severity order: a second oscillation (zero-tolerance, worst signal) outranks a
      // post-escalation stall block, which outranks a fresh regression escalation, which
      // outranks a same-tier stall escalation.
      const secondOscillation = regressionOutcomes.filter(
        (o) => o.decision.action === 'BLOCK',
      );
      if (secondOscillation.length > 0) {
        return {
          kind: 'BLOCK',
          pass: input.pass,
          iterationClass,
          reason: 'second_oscillation',
          findings: secondOscillation.map((o) => o.finding),
        };
      }
      const postEscalationBlock = stallOutcomes.filter(
        (o) => o.decision.action === 'BLOCK',
      );
      if (postEscalationBlock.length > 0) {
        return {
          kind: 'BLOCK',
          pass: input.pass,
          iterationClass,
          reason: 'post_escalation_stall',
          findings: postEscalationBlock.map((o) => o.finding),
        };
      }
      const regressionEscalate = regressionOutcomes.filter(
        (o) => o.decision.action === 'ESCALATE',
      );
      if (regressionEscalate.length > 0) {
        return {
          kind: 'ESCALATE',
          pass: input.pass,
          iterationClass,
          reason: 'regression',
          findings: regressionEscalate.map((o) => o.finding),
        };
      }
      const stallEscalate = stallOutcomes.filter((o) => o.decision.action === 'ESCALATE');
      if (stallEscalate.length > 0) {
        return {
          kind: 'ESCALATE',
          pass: input.pass,
          iterationClass,
          reason: 'stall',
          findings: stallEscalate.map((o) => o.finding),
        };
      }

      passesUsed += 1;
      openCountHistory.push({
        pass: input.pass,
        openCount: input.openFindingsCount,
        iterationClass,
      });

      if (iterationClass === 'CLEARED') {
        return { kind: 'CLEARED', pass: input.pass, iterationClass };
      }
      if (iterationClass === 'PROGRESSED') {
        const ceilingCheck = checkProgressCeiling(
          passesUsed,
          input.ticketPoints,
          input.tier,
        );
        if (ceilingCheck.action === 'PARK') {
          return {
            kind: 'PARK',
            pass: input.pass,
            iterationClass,
            reason: 'decomposition_signal',
            ceiling: ceilingCheck.ceiling,
          };
        }
        return { kind: 'CONTINUE', pass: input.pass, iterationClass };
      }

      // STALLED or MIXED, and no per-finding budget fired yet (e.g. the first strike on each
      // finding) — governed by the pass-level convergence window instead.
      if (checkConvergence(openCountHistory) === 'DIVERGED') {
        return {
          kind: 'STOP_DIVERGED',
          pass: input.pass,
          iterationClass,
          reason: 'flat_open_count',
        };
      }
      return { kind: 'CONTINUE', pass: input.pass, iterationClass };
    },
  };
}
